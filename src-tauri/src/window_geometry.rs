use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow,
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Geometry {
    monitor: Option<String>,
    origin: (i32, i32),
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
impl Geometry {
    fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|n| n.is_finite())
            && self.width >= 1.0
            && self.height >= 1.0
    }
}
#[derive(Default)]
struct Store {
    saved: BTreeMap<String, Geometry>,
    baseline: BTreeMap<String, Geometry>,
    changed: Option<Instant>,
    scheduled: bool,
    topology: BTreeMap<String, Vec<Screen>>,
    settling: BTreeMap<String, Instant>,
    opening: BTreeMap<String, String>,
}
#[derive(Clone, Debug, PartialEq)]
struct Screen {
    name: Option<String>,
    origin: (i32, i32),
    size: (u32, u32),
    scale: f64,
}
fn screens(window: &WebviewWindow) -> Result<Vec<Screen>, String> {
    Ok(window
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|m| Screen {
            name: m.name().cloned(),
            origin: (m.work_area().position.x, m.work_area().position.y),
            size: (m.work_area().size.width, m.work_area().size.height),
            scale: m.scale_factor(),
        })
        .collect())
}
#[derive(Default)]
pub struct WindowGeometry(Mutex<Store>);
impl WindowGeometry {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = app
            .state::<crate::data_paths::DataPaths>()
            .host
            .join("windows.json");
        let saved: BTreeMap<String, Geometry> = match fs::read(path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("Geometria finestre: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(format!("Lettura geometria finestre: {e}")),
        };
        if saved.values().any(|g| !g.valid()) {
            return Err("Geometria finestre non valida.".into());
        }
        Ok(Self(Mutex::new(Store {
            saved,
            ..Store::default()
        })))
    }
}
fn snapshot(window: &WebviewWindow) -> Result<Geometry, String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Monitor non disponibile.")?;
    let area = monitor.work_area();
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    Ok(Geometry {
        monitor: monitor.name().cloned(),
        origin: (area.position.x, area.position.y),
        x: (f64::from(position.x) - f64::from(area.position.x)) / scale,
        y: (f64::from(position.y) - f64::from(area.position.y)) / scale,
        width: size.width,
        height: size.height,
    })
}
fn fit(
    saved: &Geometry,
    origin: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let logical = size.to_logical::<f64>(scale);
    let width = saved.width.clamp(1.0, logical.width.max(1.0));
    let height = saved.height.clamp(1.0, logical.height.max(1.0));
    let x = saved.x.clamp(0.0, (logical.width - width).max(0.0));
    let y = saved.y.clamp(0.0, (logical.height - height).max(0.0));
    (
        PhysicalPosition::new(
            origin.x + (x * scale).round() as i32,
            origin.y + (y * scale).round() as i32,
        ),
        LogicalSize::new(width, height).to_physical(scale),
    )
}
fn matching<'a>(saved: &Geometry, monitors: &'a [Monitor]) -> Option<&'a Monitor> {
    monitors
        .iter()
        .find(|m| {
            m.name() == saved.monitor.as_ref()
                && (m.work_area().position.x, m.work_area().position.y) == saved.origin
        })
        .or_else(|| {
            monitors
                .iter()
                .find(|m| saved.monitor.is_some() && m.name() == saved.monitor.as_ref())
        })
}

pub fn restore(window: &WebviewWindow, key: &str) -> Result<(), String> {
    let app = window.app_handle();
    let saved = app
        .state::<WindowGeometry>()
        .0
        .lock()
        .map_err(|_| "Geometria occupata.")?
        .saved
        .get(key)
        .cloned();
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let primary = window.primary_monitor().map_err(|e| e.to_string())?;
    let current = window.current_monitor().map_err(|e| e.to_string())?;
    let monitor = saved
        .as_ref()
        .and_then(|s| matching(s, &monitors))
        .or(primary.as_ref())
        .or(current.as_ref());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        let desired = window
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
        let available = area.size.to_logical::<f64>(scale);
        let fallback = Geometry {
            monitor: monitor.name().cloned(),
            origin: (area.position.x, area.position.y),
            x: ((available.width - desired.width) / 2.0).max(0.0),
            y: ((available.height - desired.height) / 2.0).max(0.0),
            width: desired.width,
            height: desired.height,
        };
        let (position, size) = fit(
            saved.as_ref().unwrap_or(&fallback),
            area.position,
            area.size,
            scale,
        );
        apply(window, position, size)?;
    }
    fn apply(
        window: &WebviewWindow,
        position: PhysicalPosition<i32>,
        size: PhysicalSize<u32>,
    ) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::{
                Foundation::{HWND, RECT},
                UI::WindowsAndMessaging::{
                    GetClientRect, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
                },
            };
            let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())?.0);
            let mut outer = RECT::default();
            let mut client = RECT::default();
            // Borderless resizable Windows windows retain a non-client frame. Measuring it
            // avoids AdjustWindowRect adding a caption that our windows do not actually draw.
            unsafe {
                GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
                GetClientRect(hwnd, &mut client).map_err(|e| e.to_string())?;
                let width =
                    i64::from(size.width) + i64::from(outer.right - outer.left - client.right);
                let height =
                    i64::from(size.height) + i64::from(outer.bottom - outer.top - client.bottom);
                SetWindowPos(
                    hwnd,
                    None,
                    position.x,
                    position.y,
                    width.clamp(1, i64::from(i32::MAX)) as i32,
                    height.clamp(1, i64::from(i32::MAX)) as i32,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            window.set_position(position).map_err(|e| e.to_string())?;
            window.set_size(size).map_err(|e| e.to_string())
        }
    }
    let initial = snapshot(window)?;
    let topology = screens(window)?;
    let state = app.state::<WindowGeometry>();
    let mut store = state.0.lock().map_err(|_| "Geometria occupata.")?;
    store.baseline.insert(window.label().into(), initial);
    store.topology.insert(window.label().into(), topology);
    Ok(())
}
// Attach only to app/interactive windows, never the fullscreen host/capture surface.
pub fn attach(window: &WebviewWindow, key: String) -> Result<(), String> {
    restore(window, &key)?;
    let app = window.app_handle();
    app.state::<WindowGeometry>()
        .0
        .lock()
        .map_err(|_| "Geometria occupata.")?
        .opening
        .insert(window.label().into(), key.clone());
    let handle = app.clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
        ) {
            if let Some(window) = handle.get_webview_window(&label) {
                if let Err(error) = remember(&window, &key) {
                    crate::overlay::report(&handle, error);
                }
            }
        } else if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Ok(mut store) = handle.state::<WindowGeometry>().0.lock() {
                store.baseline.remove(&label);
                store.topology.remove(&label);
                store.settling.remove(&label);
                store.opening.remove(&label);
            }
            if let Err(error) = flush(&handle) {
                crate::overlay::report(&handle, error);
            }
        }
    });
    Ok(())
}
pub fn show(window: &WebviewWindow) -> Result<(), String> {
    let state = window.state::<WindowGeometry>();
    let key = state
        .0
        .lock()
        .map_err(|_| "Geometria occupata.")?
        .opening
        .get(window.label())
        .cloned();
    window.show().map_err(|e| e.to_string())?;
    if let Some(key) = key {
        // Windows finishes its borderless non-client layout when first shown.
        // Restore against that final client frame before allowing persistence.
        restore(window, &key)?;
        state
            .0
            .lock()
            .map_err(|_| "Geometria occupata.")?
            .opening
            .remove(window.label());
    }
    Ok(())
}
fn remember(window: &WebviewWindow, key: &str) -> Result<(), String> {
    // Hidden services, minimization and startup/restore events cannot replace user geometry.
    if !window.is_visible().map_err(|e| e.to_string())?
        || window.is_minimized().map_err(|e| e.to_string())?
        || window.is_maximized().map_err(|e| e.to_string())?
    {
        return Ok(());
    }
    let next = snapshot(window)?;
    let topology = screens(window)?;
    if !next.valid() {
        return Ok(());
    }
    let app = window.app_handle();
    let state = app.state::<WindowGeometry>();
    let mut store = state.0.lock().map_err(|_| "Geometria occupata.")?;
    if store.opening.contains_key(window.label()) {
        return Ok(());
    }
    if store.topology.get(window.label()) != Some(&topology) {
        store.topology.insert(window.label().into(), topology);
        store.settling.insert(
            window.label().into(),
            Instant::now() + Duration::from_millis(600),
        );
        let handle = app.clone();
        let label = window.label().to_string();
        let key = key.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(250)).await;
            if let Some(window) = handle.get_webview_window(&label) {
                if let Err(error) = restore(&window, &key) {
                    crate::overlay::report(&handle, error);
                }
            }
        });
    }
    if store
        .settling
        .get(window.label())
        .is_some_and(|until| *until > Instant::now())
    {
        store.baseline.insert(window.label().into(), next);
        return Ok(());
    }
    if store.baseline.get(window.label()) == Some(&next) {
        return Ok(());
    }
    store.baseline.insert(window.label().into(), next.clone());
    // Concurrent feature instances share an identity: last actual user move/resize wins.
    store.saved.insert(key.into(), next);
    store.changed = Some(Instant::now());
    if !store.scheduled {
        store.scheduled = true;
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(250)).await;
                let ready = handle
                    .state::<WindowGeometry>()
                    .0
                    .lock()
                    .map(|store| {
                        store
                            .changed
                            .is_none_or(|at| at.elapsed() >= Duration::from_millis(200))
                    })
                    .unwrap_or(true);
                if ready {
                    if let Ok(mut store) = handle.state::<WindowGeometry>().0.lock() {
                        store.scheduled = false;
                    }
                    if let Err(error) = flush(&handle) {
                        crate::overlay::report(&handle, error);
                    }
                    break;
                }
            }
        });
    }
    Ok(())
}
pub fn reset(app: &AppHandle, id: &str) -> Result<(), String> {
    {
        let state = app.state::<WindowGeometry>();
        let mut store = state.0.lock().map_err(|_| "Geometria occupata.")?;
        store.saved.retain(|key, _| {
            key != &format!("app:{id}") && !key.starts_with(&format!("feature:{id}:"))
        });
        store.changed = Some(Instant::now());
    }
    flush(app)
}
pub fn flush(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<WindowGeometry>();
    let mut store = state.0.lock().map_err(|_| "Geometria occupata.")?;
    if store.changed.is_none() {
        return Ok(());
    }
    let directory = app.state::<crate::data_paths::DataPaths>().host.clone();
    let path = directory.join("windows.pending.json");
    let result = (|| {
        fs::write(
            &path,
            serde_json::to_vec_pretty(&store.saved).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&path, directory.join("windows.json")).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result.map_err(|e| format!("Salvataggio geometria finestre: {e}"))?;
    store.changed = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect() -> Geometry {
        Geometry {
            monitor: None,
            origin: (0, 0),
            x: 40.0,
            y: 50.0,
            width: 600.0,
            height: 400.0,
        }
    }
    #[test]
    fn logical_geometry_survives_dpi_and_negative_monitor_origins() {
        let (p, s) = fit(
            &rect(),
            PhysicalPosition::new(-1920, -1080),
            PhysicalSize::new(1920, 1080),
            2.0,
        );
        assert_eq!(p, PhysicalPosition::new(-1840, -980));
        assert_eq!(s, PhysicalSize::new(1200, 800));
    }
    #[test]
    fn disconnected_monitor_fit_is_reachable_and_does_not_mutate_saved_size() {
        let saved = rect();
        let (p, s) = fit(
            &saved,
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(320, 240),
            1.0,
        );
        assert_eq!(p, PhysicalPosition::new(0, 0));
        assert_eq!(s, PhysicalSize::new(320, 240));
        assert_eq!(saved.width, 600.0);
    }
    #[test]
    fn one_pixel_is_valid_but_nonfinite_and_zero_are_not() {
        let mut saved = rect();
        saved.width = 1.0;
        saved.height = 1.0;
        assert!(saved.valid());
        assert_eq!(
            fit(
                &saved,
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(1000, 800),
                1.0
            )
            .1,
            PhysicalSize::new(1, 1)
        );
        saved.width = f64::NAN;
        assert!(!saved.valid());
        saved.width = 0.0;
        assert!(!saved.valid());
    }
}

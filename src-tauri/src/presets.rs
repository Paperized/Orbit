use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    sync::Mutex,
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    id: String,
    name: String,
    layout: Value,
    builtins: Vec<String>,
    click_through: Vec<String>,
    monitor: Screen,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Screen {
    name: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Document {
    version: u32,
    presets: Vec<Preset>,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            presets: Vec::new(),
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    app_id: String,
    widget_id: String,
    name: String,
}
#[derive(Clone, Serialize)]
pub struct View {
    preset: Preset,
    component: String,
    image: Option<Preview>,
    #[serde(skip)]
    generation: u64,
    #[serde(skip)]
    prepared: bool,
    #[serde(skip)]
    loaded: bool,
}
struct State {
    active: Option<String>,
    suspended: bool,
    generation: u64,
    views: HashMap<String, View>,
}
pub struct Runtime(Mutex<State>, Mutex<()>);
impl Default for Runtime {
    fn default() -> Self {
        Self(
            Mutex::new(State {
                active: None,
                suspended: true,
                generation: 0,
                views: HashMap::new(),
            }),
            Mutex::new(()),
        )
    }
}
fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn strings(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .is_some_and(|list| list.iter().all(Value::is_string))
}
fn package_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn rect(value: &Value) -> Result<[f64; 4], String> {
    let mut result = [0.0; 4];
    for (i, key) in ["x", "y", "width", "height"].iter().enumerate() {
        result[i] = value[key].as_f64().ok_or("Geometria preset non valida.")?;
        if !result[i].is_finite()
            || result[i] < if i < 2 { 0.0 } else { 1.0 }
            || result[i] > 131072.0
        {
            return Err("Geometria preset fuori limite.".into());
        }
    }
    Ok(result)
}
fn components(p: &Preset) -> Vec<(String, Value)> {
    let mut result: Vec<_> = p
        .builtins
        .iter()
        .map(|name| (name.clone(), p.layout["rects"][name].clone()))
        .collect();
    if let Some(widgets) = p.layout["widgets"].as_array() {
        result.extend(
            widgets
                .iter()
                .map(|w| (w["id"].as_str().unwrap_or_default().to_owned(), w.clone())),
        );
    }
    result
}
fn validate(document: &Document) -> Result<(), String> {
    if document.version != 1 || document.presets.len() > 12 {
        return Err("Elenco preset non valido (massimo 12).".into());
    }
    let mut ids = HashSet::new();
    for p in &document.presets {
        if !id(&p.id)
            || !ids.insert(&p.id)
            || p.name.trim().is_empty()
            || p.name.chars().count() > 80
            || p.builtins
                .iter()
                .any(|b| !["logo", "search", "favorites", "dock"].contains(&b.as_str()))
            || p.builtins.iter().collect::<HashSet<_>>().len() != p.builtins.len()
            || p.click_through.iter().any(|v| !id(v))
            || p.click_through.iter().collect::<HashSet<_>>().len() != p.click_through.len()
            || p.click_through.len() > 20
            || ![p.monitor.x, p.monitor.y, p.monitor.width, p.monitor.height]
                .iter()
                .all(|v| v.is_finite())
            || p.monitor.x.abs() > 131072.0
            || p.monitor.y.abs() > 131072.0
            || !(1.0..=32768.0).contains(&p.monitor.width)
            || !(1.0..=32768.0).contains(&p.monitor.height)
            || p.layout["version"] != 3
            || !strings(p.layout.get("favorites"))
            || !p.layout["rects"].is_object()
            || !p.layout["editing"].is_boolean()
            || !p.layout["grid"].is_boolean()
            || !p.layout["clock"].is_boolean()
            || !p.layout["ai"].is_boolean()
            || ["favoritesVisible", "dockVisible"]
                .iter()
                .any(|key| p.layout.get(key).is_some_and(|v| !v.is_boolean()))
            || p.layout["gridSize"].as_u64().unwrap_or(0) == 0
            || p.layout["gridSize"]
                .as_u64()
                .is_some_and(|v| v > 9007199254740991)
        {
            return Err("Preset non valido.".into());
        }
        let widgets = p.layout["widgets"]
            .as_array()
            .ok_or("Widget preset non validi.")?;
        if widgets.len() > 16 {
            return Err("Troppi widget nel preset.".into());
        }
        let mut component_ids = HashSet::new();
        for (name, r) in components(p) {
            if !id(&name) || !component_ids.insert(name) {
                return Err("Identita widget non valida.".into());
            }
            rect(&r)?;
        }
        for (key, value) in p.layout["rects"]
            .as_object()
            .ok_or("Geometria preset non valida.")?
        {
            if !["logo", "search", "favorites", "dock", "ai"].contains(&key.as_str()) {
                return Err("Componente preset non valido.".into());
            }
            rect(value)?;
        }
        let mut sources = HashSet::new();
        for widget in widgets {
            for key in ["appId", "widgetId"] {
                if !widget[key].as_str().is_some_and(package_id) {
                    return Err("Sorgente widget non valida.".into());
                }
            }
            if !widget["title"]
                .as_str()
                .is_some_and(|v| !v.trim().is_empty() && v.encode_utf16().count() <= 160)
            {
                return Err("Titolo widget non valido.".into());
            }
            if widget["id"]
                .as_str()
                .is_some_and(|v| ["logo", "search", "favorites", "dock", "ai"].contains(&v))
                || !sources.insert((widget["appId"].as_str(), widget["widgetId"].as_str()))
            {
                return Err("Identita widget duplicata.".into());
            }
            if let Some(settings) = widget.get("settings") {
                if settings.as_object().is_none_or(|v| v.len() != 2)
                    || ["rows", "columns"]
                        .iter()
                        .any(|key| !settings[key].as_u64().is_some_and(|v| (1..=6).contains(&v)))
                {
                    return Err("Griglia widget non valida.".into());
                }
            }
        }
    }
    Ok(())
}
#[tauri::command]
pub fn get_overlay_presets(app: AppHandle) -> Result<Document, String> {
    let path = app
        .state::<crate::data_paths::DataPaths>()
        .host
        .join("presets.json");
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Document::default())
        }
        Err(error) => return Err(format!("Lettura preset: {error}")),
    };
    if bytes.len() > 512 * 1024 {
        return Err("File preset troppo grande.".into());
    }
    let document =
        serde_json::from_slice(&bytes).map_err(|e| format!("Preset salvati non validi: {e}"))?;
    validate(&document)?;
    Ok(document)
}
#[tauri::command]
pub fn save_overlay_presets(app: AppHandle, document: Document) -> Result<(), String> {
    validate(&document)?;
    let bytes = serde_json::to_vec(&document).map_err(|e| e.to_string())?;
    if bytes.len() > 512 * 1024 {
        return Err("File preset troppo grande.".into());
    }
    let paths = app.state::<crate::data_paths::DataPaths>();
    // Serialize writers so the temporary file cannot be replaced by another save.
    let runtime = app.state::<Runtime>();
    let mut state = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
    let temp = paths.host.join("presets.tmp");
    fs::write(&temp, bytes).map_err(|e| format!("Salvataggio preset: {e}"))?;
    fs::rename(temp, paths.host.join("presets.json"))
        .map_err(|e| format!("Conferma preset: {e}"))?;
    if state
        .active
        .as_ref()
        .is_some_and(|id| !document.presets.iter().any(|p| &p.id == id))
    {
        state.active = None;
    }
    let refresh = !state.suspended;
    drop(state);
    if refresh {
        resume(&app)?;
    }
    Ok(())
}
#[tauri::command]
pub fn overlay_preset_status(app: AppHandle) -> Result<Value, String> {
    Ok(
        json!({ "activeId": app.state::<Runtime>().0.lock().map_err(|_| "Stato preset occupato.")?.active }),
    )
}
#[tauri::command]
pub fn overlay_monitor(app: AppHandle) -> Result<Screen, String> {
    let window = app
        .get_webview_window("overlay")
        .ok_or("Overlay non disponibile.")?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Monitor non disponibile.")?;
    let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
    Ok(Screen {
        name: monitor.name().cloned(),
        x: monitor.position().x as f64,
        y: monitor.position().y as f64,
        width: size.width,
        height: size.height,
    })
}
#[tauri::command]
pub fn apply_overlay_preset(app: AppHandle, id: Option<String>) -> Result<(), String> {
    if let Some(id) = &id {
        let doc = get_overlay_presets(app.clone())?;
        let preset = doc
            .presets
            .iter()
            .find(|p| &p.id == id)
            .ok_or("Preset non disponibile.")?;
        if components(preset).is_empty() {
            return Err("Aggiungi almeno un componente prima di APPLY.".into());
        }
    }
    app.state::<Runtime>()
        .0
        .lock()
        .map_err(|_| "Stato preset occupato.")?
        .active = id;
    suspend(&app)?;
    let visible = app
        .get_webview_window("overlay")
        .ok_or("Overlay non disponibile.")?
        .is_visible()
        .map_err(|e| e.to_string())?;
    if !visible {
        resume(&app)?;
    }
    Ok(())
}
pub fn suspend(app: &AppHandle) -> Result<(), String> {
    {
        let runtime = app.state::<Runtime>();
        let mut s = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
        s.suspended = true;
        s.generation += 1;
    }
    for window in app
        .webview_windows()
        .values()
        .filter(|w| w.label().starts_with("persistent-"))
    {
        window
            .hide()
            .map_err(|e| format!("Nascondi widget persistente: {e}"))?;
    }
    Ok(())
}
pub fn resume(app: &AppHandle) -> Result<(), String> {
    let generation = {
        let runtime = app.state::<Runtime>();
        let mut s = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
        s.suspended = false;
        s.generation += 1;
        s.generation
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = render(&app, generation) {
            crate::overlay::report(&app, error);
        }
    });
    Ok(())
}
fn current(app: &AppHandle, generation: u64) -> Result<bool, String> {
    let runtime = app.state::<Runtime>();
    let s = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
    Ok(!s.suspended && s.generation == generation)
}
fn render(app: &AppHandle, generation: u64) -> Result<(), String> {
    let runtime = app.state::<Runtime>();
    let _render = runtime.1.lock().map_err(|_| "Creazione preset occupata.")?;
    let result = render_windows(app, generation);
    if result.is_err() {
        for window in app
            .webview_windows()
            .values()
            .filter(|w| w.label().starts_with(&format!("persistent-{generation}-")))
        {
            if let Err(error) = window.destroy() {
                eprintln!("Pulizia widget persistente: {error}");
            }
        }
        runtime
            .0
            .lock()
            .map_err(|_| "Stato preset occupato.")?
            .views
            .retain(|_, view| view.generation != generation);
    }
    result
}
fn render_windows(app: &AppHandle, generation: u64) -> Result<(), String> {
    if !current(app, generation)? {
        return Ok(());
    }
    for window in app
        .webview_windows()
        .values()
        .filter(|w| w.label().starts_with("persistent-"))
    {
        window.destroy().map_err(|e| e.to_string())?;
    }
    let active = {
        let runtime = app.state::<Runtime>();
        let mut s = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
        s.views.clear();
        s.active.clone()
    };
    let Some(active) = active else {
        return Ok(());
    };
    let document = get_overlay_presets(app.clone())?;
    let preset = document
        .presets
        .into_iter()
        .find(|p| p.id == active)
        .ok_or("Preset attivo non disponibile.")?;
    let host = app
        .get_webview_window("overlay")
        .ok_or("Overlay non disponibile.")?;
    let monitors = host.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| {
            m.name() == preset.monitor.name.as_ref()
                && m.position().x as f64 == preset.monitor.x
                && m.position().y as f64 == preset.monitor.y
        })
        .or_else(|| {
            monitors
                .iter()
                .find(|m| preset.monitor.name.is_some() && m.name() == preset.monitor.name.as_ref())
        })
        .cloned()
        .or(host.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("Monitor non disponibile.")?;
    let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
    let origin = monitor.position().to_logical::<f64>(monitor.scale_factor());
    for (index, (component, geometry)) in components(&preset).into_iter().enumerate() {
        if !current(app, generation)? {
            return Ok(());
        }
        let [x, y, width, height] = rect(&geometry)?;
        let width = width.min(size.width);
        let height = height.min(size.height);
        let label = format!("persistent-{generation}-{index}");
        let view = View {
            preset: preset.clone(),
            component: component.clone(),
            image: None,
            generation,
            prepared: false,
            loaded: false,
        };
        app.state::<Runtime>()
            .0
            .lock()
            .map_err(|_| "Stato preset occupato.")?
            .views
            .insert(label.clone(), view);
        let window = tauri::WebviewWindowBuilder::new(
            app,
            &label,
            WebviewUrl::App("index.html?persistent=1".into()),
        )
        .data_directory(app.state::<crate::data_paths::DataPaths>().webview.clone())
        .devtools(false)
        .title(format!("Orbit / {}", preset.name))
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .resizable(false)
        .visible(false)
        .focused(false)
        .inner_size(width, height)
        .min_inner_size(1.0, 1.0)
        .position(
            origin.x + x.min(size.width - width),
            origin.y + y.min(size.height - height),
        )
        .initialization_script(crate::appearance::initialization(
            crate::appearance::get_theme(app.clone())?,
        )?)
        .initialization_script(crate::locale::initialization(crate::locale::get_locale(
            app.clone(),
        )?)?)
        .build()
        .map_err(|e| format!("Creazione widget persistente: {e}"))?;
        crate::platform::configure(&window)?;
        window
            .set_ignore_cursor_events(preset.click_through.contains(&component))
            .map_err(|e| e.to_string())?;
        if current(app, generation)? {
            prepare(&window)?;
        } else {
            window.destroy().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn persistent_view(window: WebviewWindow) -> Result<View, String> {
    window
        .state::<Runtime>()
        .0
        .lock()
        .map_err(|_| "Stato preset occupato.")?
        .views
        .get(window.label())
        .cloned()
        .ok_or("Widget persistente non disponibile.".into())
}
#[tauri::command]
pub fn persistent_ready(window: WebviewWindow) -> Result<(), String> {
    {
        let runtime = window.state::<Runtime>();
        let mut s = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
        if let Some(view) = s.views.get_mut(window.label()) {
            view.loaded = true;
        }
    }
    show_ready(&window)
}
fn prepare(window: &WebviewWindow) -> Result<(), String> {
    {
        let runtime = window.state::<Runtime>();
        let mut s = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
        if let Some(view) = s.views.get_mut(window.label()) {
            view.prepared = true;
        }
    }
    show_ready(window)
}
fn show_ready(window: &WebviewWindow) -> Result<(), String> {
    let native = window.clone();
    // Serialize visibility decisions on the window event loop, not under a lock
    // held by an IPC thread waiting for that same loop.
    window
        .run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let runtime = native.state::<Runtime>();
                let s = runtime.0.lock().map_err(|_| "Stato preset occupato.")?;
                if s.views.get(native.label()).is_some_and(|v| {
                    !s.suspended && v.generation == s.generation && v.loaded && v.prepared
                }) {
                    native.show().map_err(|e| e.to_string())?;
                    if native.label().starts_with("persistent-preview-") {
                        native.set_focus().map_err(|e| e.to_string())?;
                    }
                }
                Ok(())
            })();
            if let Err(error) = result {
                crate::overlay::report(native.app_handle(), error);
            }
        })
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn preview_persistent_image(window: WebviewWindow, name: String) -> Result<(), String> {
    let mut view = persistent_view(window.clone())?;
    let widget = view.preset.layout["widgets"]
        .as_array()
        .and_then(|ws| ws.iter().find(|w| w["id"] == view.component))
        .ok_or("Widget immagine non disponibile.")?;
    let app_id = widget["appId"]
        .as_str()
        .ok_or("App non valida.")?
        .to_owned();
    let widget_id = widget["widgetId"]
        .as_str()
        .ok_or("Widget non valido.")?
        .to_owned();
    // Use the same native source authorization and bounded PNG validation as the host.
    crate::widgets::get_widget_image(
        window.app_handle().clone(),
        app_id.clone(),
        widget_id.clone(),
        name.clone(),
    )
    .await?;
    if !current(window.app_handle(), view.generation)? {
        return Err("Il preset non e piu visibile.".into());
    }
    view.image = Some(Preview {
        app_id,
        widget_id,
        name,
    });
    view.prepared = false;
    view.loaded = false;
    let generation = view.generation;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Monitor non disponibile.")?;
    let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
    let origin = monitor.position().to_logical::<f64>(monitor.scale_factor());
    let width = 1000.0_f64.min(size.width);
    let height = 700.0_f64.min(size.height);
    let label = format!("persistent-preview-{}", uuid::Uuid::new_v4());
    window
        .state::<Runtime>()
        .0
        .lock()
        .map_err(|_| "Stato preset occupato.")?
        .views
        .insert(label.clone(), view);
    let preview = tauri::WebviewWindowBuilder::new(
        window.app_handle(),
        &label,
        WebviewUrl::App("index.html?persistent=1".into()),
    )
    .data_directory(
        window
            .state::<crate::data_paths::DataPaths>()
            .webview
            .clone(),
    )
    .devtools(false)
    .title("Orbit / Screenshot")
    .inner_size(width, height)
    .position(
        origin.x + (size.width - width) / 2.0,
        origin.y + (size.height - height) / 2.0,
    )
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible(false)
    .build()
    .map_err(|e| {
        if let Ok(mut state) = window.state::<Runtime>().0.lock() {
            state.views.remove(&label);
        }
        e.to_string()
    })?;
    crate::platform::configure(&preview)?;
    if current(window.app_handle(), generation)? {
        prepare(&preview)?;
    } else {
        close_persistent_preview(preview)?;
    }
    Ok(())
}
#[tauri::command]
pub fn close_persistent_preview(window: WebviewWindow) -> Result<(), String> {
    if !window.label().starts_with("persistent-preview-") {
        return Err("Operazione disponibile solo nelle anteprime.".into());
    }
    window
        .state::<Runtime>()
        .0
        .lock()
        .map_err(|_| "Stato preset occupato.")?
        .views
        .remove(window.label());
    window.destroy().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn document() -> Document {
        serde_json::from_value(json!({"version":1,"presets":[{
            "id":"work","name":"Work","builtins":["logo"],"clickThrough":["logo"],
            "monitor":{"name":null,"x":-1920,"y":0,"width":1920,"height":1080},
            "layout":{"version":3,"favorites":[],"widgets":[],"clock":false,"ai":false,"editing":true,"grid":false,"gridSize":20,
            "rects":{"logo":{"x":5,"y":5,"width":200,"height":80}}}
        }]})).unwrap()
    }
    #[test]
    fn validates_presets_and_geometry() {
        let mut doc = document();
        assert!(validate(&doc).is_ok());
        doc.presets[0].layout["rects"]["logo"]["width"] = json!(0);
        assert!(validate(&doc).is_err());
        let mut doc = document();
        doc.presets.push(doc.presets[0].clone());
        assert!(validate(&doc).is_err());
        let mut doc = document();
        doc.presets[0].builtins.push("ai".into());
        assert!(validate(&doc).is_err());
    }
    #[test]
    fn active_state_is_never_restored_from_disk() {
        assert!(Runtime::default().0.lock().unwrap().active.is_none());
        assert!(Runtime::default().0.lock().unwrap().suspended);
    }
}

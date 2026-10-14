use crate::AppState;
use tauri::{LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy)]
pub struct PanelBounds {
    position: PhysicalPosition<i32>,
    size: LogicalSize<f64>,
}

#[derive(Default)]
pub struct PanelState {
    active: bool,
    bounds: Option<PanelBounds>,
}

pub fn remember(window: &WebviewWindow) -> Result<(), String> {
    let state = window.state::<AppState>();
    let active = state
        .panel
        .lock()
        .map_err(|_| "Stato pannello non disponibile.")?
        .active;
    if active {
        let bounds = PanelBounds {
            position: window.outer_position().map_err(|e| e.to_string())?,
            size: window
                .inner_size()
                .map_err(|e| e.to_string())?
                .to_logical(window.scale_factor().map_err(|e| e.to_string())?),
        };
        state
            .panel
            .lock()
            .map_err(|_| "Stato pannello non disponibile.")?
            .bounds = Some(bounds);
    }
    Ok(())
}

fn fit_panel(
    origin: PhysicalPosition<i32>,
    screen: PhysicalSize<u32>,
    scale: f64,
    saved: Option<PanelBounds>,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let available = screen.to_logical::<f64>(scale);
    let desired = saved.map_or(LogicalSize::new(440.0, 520.0), |bounds| bounds.size);
    let size = LogicalSize::new(
        desired.width.max(340.0).min(available.width),
        desired.height.max(300.0).min(available.height),
    )
    .to_physical::<u32>(scale);
    let max_x = origin.x + screen.width.saturating_sub(size.width) as i32;
    let max_y = origin.y + screen.height.saturating_sub(size.height) as i32;
    let desired_position = saved.map_or(
        PhysicalPosition::new(
            max_x - (24.0 * scale) as i32,
            origin.y + (64.0 * scale) as i32,
        ),
        |bounds| bounds.position,
    );
    (
        PhysicalPosition::new(
            desired_position.x.clamp(origin.x, max_x),
            desired_position.y.clamp(origin.y, max_y),
        ),
        size,
    )
}

pub fn set(window: &WebviewWindow, floating: bool, monitor: &Monitor) -> Result<(), String> {
    remember(window)?;
    let state = window.state::<AppState>();
    let saved = {
        let mut panel = state
            .panel
            .lock()
            .map_err(|_| "Stato pannello non disponibile.")?;
        panel.active = false;
        panel.bounds
    };
    let scale = monitor.scale_factor();
    let (position, size) = if floating {
        fit_panel(*monitor.position(), *monitor.size(), scale, saved)
    } else {
        (*monitor.position(), *monitor.size())
    };
    window
        .set_min_size(None::<LogicalSize<f64>>)
        .map_err(|e| e.to_string())?;
    window.set_resizable(floating).map_err(|e| e.to_string())?;
    window.set_shadow(floating).map_err(|e| e.to_string())?;
    // Input belongs to the window. Outside a floating panel there is no Orbit window.
    window
        .set_ignore_cursor_events(false)
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        window
            .set_position(position.to_logical::<f64>(scale))
            .map_err(|e| e.to_string())?;
        window
            .set_size(size.to_logical::<f64>(scale))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.set_position(position).map_err(|e| e.to_string())?;
        window.set_size(size).map_err(|e| e.to_string())?;
    }
    if floating {
        let available = monitor.size().to_logical::<f64>(scale);
        window
            .set_min_size(Some(LogicalSize::new(
                340.0_f64.min(available.width),
                300.0_f64.min(available.height),
            )))
            .map_err(|e| e.to_string())?;
    }
    state
        .panel
        .lock()
        .map_err(|_| "Stato pannello non disponibile.")?
        .active = floating;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_uses_compact_logical_dimensions_at_high_dpi() {
        let (position, size) = fit_panel(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(3840, 2160),
            2.0,
            None,
        );
        assert_eq!(size, PhysicalSize::new(880, 1040));
        assert_eq!(position, PhysicalPosition::new(2912, 128));
    }

    #[test]
    fn panel_preserves_user_size_and_position() {
        let saved = PanelBounds {
            position: PhysicalPosition::new(80, 120),
            size: LogicalSize::new(620.0, 480.0),
        };
        let (position, size) = fit_panel(
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(1920, 1080),
            1.0,
            Some(saved),
        );
        assert_eq!(position, saved.position);
        assert_eq!(size, PhysicalSize::new(620, 480));
    }

    #[test]
    fn offscreen_panel_is_clamped_to_a_small_negative_origin_monitor() {
        let (position, size) = fit_panel(
            PhysicalPosition::new(-320, -240),
            PhysicalSize::new(320, 240),
            1.0,
            Some(PanelBounds {
                position: PhysicalPosition::new(2000, 1200),
                size: LogicalSize::new(900.0, 700.0),
            }),
        );
        assert_eq!(position, PhysicalPosition::new(-320, -240));
        assert_eq!(size, PhysicalSize::new(320, 240));
    }
}

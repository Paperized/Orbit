use crate::{apps, capture, platform, presentation, AppState};
use serde::{Deserialize, Serialize};
use std::{sync::atomic::Ordering, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Deserialize)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub shortcut: Option<String>,
    pub category: String,
}

pub fn tools() -> Result<Vec<Tool>, String> {
    serde_json::from_str(include_str!("../../shared/tools.json")).map_err(|e| e.to_string())
}

#[derive(Clone, Serialize)]
pub struct OpenPayload {
    pub tool: String,
    pub capture: Option<capture::Capture>,
}

pub fn report(app: &AppHandle, message: String) {
    eprintln!("{message}");
    if let Some(window) = app.get_webview_window("overlay") {
        if let Err(error) = window.show() {
            eprintln!("Impossibile mostrare l'errore: {error}");
        }
    }
    if let Err(error) = app.emit("app-error", message) {
        eprintln!("Notifica errore non riuscita: {error}");
    }
}

pub async fn toggle(app: AppHandle, tool: String) {
    let state = app.state::<AppState>();
    let outcome = async {
        if state.opening.load(Ordering::Acquire) {
            return hide_overlay(app.clone());
        }
        let window = app
            .get_webview_window("overlay")
            .ok_or("Finestra non disponibile.")?;
        let same = *state
            .active_tool
            .lock()
            .map_err(|_| "Stato overlay non disponibile.")?
            == tool;
        if window.is_visible().map_err(|e| e.to_string())? && same {
            hide_overlay(app.clone())
        } else {
            open_tool(app.clone(), tool).await
        }
    }
    .await;
    if let Err(error) = outcome {
        report(&app, error);
    }
}

#[tauri::command]
pub async fn open_tool(app: AppHandle, tool: String) -> Result<(), String> {
    if tool == "chat" {
        return apps::launch_app(app, "orbit-chat".into()).await;
    }
    if tool == "capture" {
        return apps::launch_app(app, "orbit-capture".into()).await;
    }
    if tool == "notes" {
        return apps::launch_app(app, "orbit-notes".into()).await;
    }
    open_host_tool(app, tool).await
}

pub async fn open_capture(app: AppHandle) -> Result<(), String> {
    open_host_tool(app, "capture".into()).await
}

async fn open_host_tool(app: AppHandle, tool: String) -> Result<(), String> {
    if !tools()?.iter().any(|entry| entry.id == tool) {
        return Err("Strumento non registrato.".into());
    }
    let state = app.state::<AppState>();
    if state.opening.swap(true, Ordering::AcqRel) {
        return Err("Apertura overlay gia in corso.".into());
    }
    if tool != "capture" {
        if let Err(error) = apps::cancel_capture(&app, "Selezione annullata dalla navigazione.") {
            state.opening.store(false, Ordering::Release);
            return Err(error);
        }
    }
    state.dismissed.store(false, Ordering::Release);
    let result = show(&app, &tool).await;
    state.opening.store(false, Ordering::Release);
    result
}

async fn show(app: &AppHandle, tool: &str) -> Result<(), String> {
    crate::presets::suspend(app)?;
    let state = app.state::<AppState>();
    let window = app
        .get_webview_window("overlay")
        .ok_or("Finestra non disponibile.")?;
    if !window.is_visible().map_err(|e| e.to_string())? {
        platform::remember_focus();
    }
    let cursor = platform::cursor_position(&window)?;
    let monitor = window
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(|e| e.to_string())?
        .ok_or("Nessun monitor sotto il cursore.")?;
    let floating = tool != "capture"
        && tools()?
            .iter()
            .any(|entry| entry.id == tool && entry.category == "tool");
    let mut captured = None;
    state
        .capture
        .lock()
        .map_err(|_| "Stato cattura non disponibile.")?
        .take();
    if tool == "capture" {
        apps::hide_for_capture(app)?;
        window.hide().map_err(|e| e.to_string())?;
        tokio::time::sleep(Duration::from_millis(160)).await;
        let (x, y) = (cursor.x as i32, cursor.y as i32);
        let result = tauri::async_runtime::spawn_blocking(move || {
            let image = capture::take(x, y)?;
            let preview = capture::encode(&image)?;
            Ok::<_, String>((image, preview))
        })
        .await
        .map_err(|e| e.to_string())?;
        match result {
            Ok((image, preview)) => {
                if state.dismissed.load(Ordering::Acquire) {
                    return Ok(());
                }
                *state
                    .capture
                    .lock()
                    .map_err(|_| "Stato cattura non disponibile.")? = Some(image);
                captured = Some(preview);
            }
            Err(error) => {
                window.show().map_err(|e| e.to_string())?;
                return Err(error);
            }
        }
    }
    if state.dismissed.load(Ordering::Acquire) {
        state
            .capture
            .lock()
            .map_err(|_| "Stato cattura non disponibile.")?
            .take();
        return Ok(());
    }
    presentation::set(&window, floating, &monitor)?;
    #[cfg(target_os = "macos")]
    {
        app.show().map_err(|e| e.to_string())?;
    }
    *state
        .active_tool
        .lock()
        .map_err(|_| "Stato overlay non disponibile.")? = tool.to_owned();
    app.emit(
        "overlay-open",
        OpenPayload {
            tool: tool.to_owned(),
            capture: captured,
        },
    )
    .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn finish_capture(app: AppHandle, capture: capture::Capture) -> Result<bool, String> {
    let state = app.state::<AppState>();
    if state.dismissed.load(Ordering::Acquire) {
        return Ok(false);
    }
    if *state
        .active_tool
        .lock()
        .map_err(|_| "Stato overlay non disponibile.")?
        != "capture"
    {
        return Err("La cattura non e piu attiva.".into());
    }
    let pending = app
        .state::<apps::Runtime>()
        .capture
        .lock()
        .map_err(|_| "Cattura occupata.")?
        .take();
    if let Some(pending) = pending {
        hide_overlay(app.clone())?;
        if let Some(window) = app.get_webview_window(&pending.owner) {
            if window.is_visible().map_err(|e| e.to_string())? {
                window.set_focus().map_err(|e| e.to_string())?;
            }
        }
        let _ = pending.sender.send(Ok(capture));
        return Ok(false);
    }
    let window = app
        .get_webview_window("overlay")
        .ok_or("Finestra non disponibile.")?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Monitor non disponibile.")?;
    presentation::set(&window, true, &monitor)?;
    // Keep the capture hotkey as owner of the resulting chat.
    Ok(!state.dismissed.load(Ordering::Acquire))
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.dismissed.store(true, Ordering::Release);
    state
        .capture
        .lock()
        .map_err(|_| "Stato cattura non disponibile.")?
        .take();
    let mut overlay_was_focused = false;
    if let Some(window) = app.get_webview_window("overlay") {
        presentation::remember(&window)?;
        // Check before hiding: Windows may activate another app as a result of hide().
        overlay_was_focused = platform::has_foreground_focus(&window)?;
        window.hide().map_err(|e| e.to_string())?;
    }
    platform::restore_focus(overlay_was_focused);
    apps::cancel_capture(&app, "Selezione annullata.")?;
    crate::presets::resume(&app)?;
    app.emit("overlay-hidden", ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn frontend_ready(app: AppHandle) -> Result<(), String> {
    apps::resume_shortcuts(&app)?;
    open_tool(app.clone(), "home".into()).await?;
    let errors = std::mem::take(
        &mut *app
            .state::<AppState>()
            .startup_errors
            .lock()
            .map_err(|_| "Stato avvio non disponibile.")?,
    );
    if !errors.is_empty() {
        app.emit("app-error", errors.join("\n"))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

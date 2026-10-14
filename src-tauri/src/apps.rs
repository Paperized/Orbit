use crate::{
    ai,
    capture::Capture,
    overlay,
    packages::{self, Installed, Permission, ShortcutBinding, ShortcutOwner, Store},
    platform, AppState,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tokio_util::sync::CancellationToken;

pub const STARTERS: [&str; 4] = [
    include_str!("../../apps/dist/orbit-capture.orbit"),
    include_str!("../../apps/dist/orbit-notes.orbit"),
    include_str!("../../apps/dist/orbit-timer.orbit"),
    include_str!("../../apps/dist/orbit-chat.orbit"),
];
pub struct CaptureRequest {
    pub owner: String,
    pub sender: tokio::sync::oneshot::Sender<Result<Capture, String>>,
}
pub struct Runtime {
    pub recording_shortcut: AtomicBool,
    pub store: Mutex<Store>,
    pub interop: Mutex<crate::interop::Hub>,
    pub features: Mutex<BTreeMap<String, FeatureSession>>,
    shortcuts: Mutex<BTreeMap<(String, String), Shortcut>>,
    configuration: Mutex<()>,
    launching: tokio::sync::Mutex<()>,
    actions: Mutex<BTreeMap<String, ActionSession>>,
    pinned: Mutex<BTreeSet<String>>,
    sessions: Mutex<BTreeMap<String, CancellationToken>>,
    timers: Mutex<BTreeMap<String, Arc<CancellationToken>>>,
    pub capture: Mutex<Option<CaptureRequest>>,
    pub hidden: Mutex<Vec<String>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureSession {
    pub app_id: String,
    pub action_id: String,
    pub request_id: String,
}
pub fn package_id(runtime: &Runtime, owner: &str) -> Result<String, String> {
    Ok(runtime
        .features
        .lock()
        .map_err(|_| "Sessioni occupate.")?
        .get(owner)
        .map_or_else(|| owner.to_string(), |s| s.app_id.clone()))
}
fn resource_owner(window: &WebviewWindow) -> Result<String, String> {
    window
        .label()
        .strip_prefix("app-")
        .map(str::to_string)
        .ok_or("Finestra non autorizzata.".into())
}
fn app_windows(app: &AppHandle, id: &str) -> Vec<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .filter(|w| {
            resource_owner(w)
                .and_then(|owner| package_id(&app.state::<Runtime>(), &owner))
                .is_ok_and(|p| p == id)
        })
        .collect()
}
#[derive(Default)]
struct ActionSession {
    ready: bool,
    pending: Vec<String>,
}
impl Runtime {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let root = app.state::<crate::data_paths::DataPaths>().apps.clone();
        let first = !root.join("initialized").exists();
        let mut store = Store::load(root.clone())?;
        if first {
            for source in STARTERS {
                let (package, digest) = packages::decode(source)?;
                if !store.installed.contains_key(&package.manifest.id) {
                    let warnings = store.install(source, &digest)?;
                    app.state::<AppState>()
                        .startup_errors
                        .lock()
                        .map_err(|_| "Stato avvio occupato.")?
                        .extend(warnings);
                }
            }
            std::fs::write(root.join("initialized"), b"1").map_err(|e| e.to_string())?;
        }
        Ok(Self {
            recording_shortcut: AtomicBool::new(false),
            store: Mutex::new(store),
            interop: Mutex::new(crate::interop::Hub::default()),
            features: Mutex::new(BTreeMap::new()),
            shortcuts: Mutex::new(BTreeMap::new()),
            configuration: Mutex::new(()),
            launching: tokio::sync::Mutex::new(()),
            actions: Mutex::new(BTreeMap::new()),
            pinned: Mutex::new(BTreeSet::new()),
            sessions: Mutex::new(BTreeMap::new()),
            timers: Mutex::new(BTreeMap::new()),
            capture: Mutex::new(None),
            hidden: Mutex::new(Vec::new()),
        })
    }
}

pub fn ipc_allowed(label: &str, command: &str) -> bool {
    label == "overlay"
        || (label.starts_with("persistent-")
            && matches!(
                command,
                "persistent_view"
                    | "persistent_ready"
                    | "preview_persistent_image"
                    | "close_persistent_preview"
                    | "get_widget_data"
                    | "get_widget_image"
                    | "list_apps"
                    | "dependency_status"
                    | "get_theme"
                    | "get_locale"
                    | "launch_app"
                    | "launch_app_action"
                    | "open_tool"
            ))
        || (label.starts_with("app-") && matches!(command, "app_request" | "app_chat"))
}

fn authorize(window: &WebviewWindow, permission: Option<Permission>) -> Result<String, String> {
    let runtime = window.state::<Runtime>();
    let id = package_id(&runtime, &resource_owner(window)?)?;
    let result = runtime
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .authorize(&format!("app-{id}"), permission);
    result
}

#[tauri::command]
pub fn list_apps(app: AppHandle) -> Result<Vec<Installed>, String> {
    Ok(app
        .state::<Runtime>()
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .installed
        .values()
        .cloned()
        .collect())
}

#[tauri::command]
pub fn runtime_info(app: AppHandle) -> Value {
    json!({"identifier":app.config().identifier,"sdk":1})
}

#[tauri::command]
pub fn set_app_hidden(app: AppHandle, id: String, hidden: bool) -> Result<(), String> {
    app.state::<Runtime>()
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .hide(&id, hidden)
}

#[tauri::command]
pub fn dependency_status(app: AppHandle) -> Result<Value, String> {
    let runtime = app.state::<Runtime>();
    let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
    Ok(json!(store.installed.values().map(|app|{
        let dependencies:Vec<_>=app.manifest.dependencies.iter().map(|dep|json!({
            "contract":dep.contract,"version":dep.version,"required":dep.required,
            "providers":crate::contracts::destinations(&store.installed,&dep.contract,dep.version,dep.provider.as_deref(),None)
        })).collect();
        json!({"id":app.manifest.id,"ready":crate::contracts::ready(&app.manifest.id,&store.installed),"dependencies":dependencies})
    }).collect::<Vec<_>>()))
}

#[tauri::command]
pub fn preview_package(source: String) -> Result<Value, String> {
    let (package, digest) = packages::decode(&source)?;
    Ok(json!({"manifest":package.manifest,"digest":digest}))
}

#[tauri::command]
pub fn starter_packages() -> Vec<&'static str> {
    STARTERS.to_vec()
}

pub fn synchronize(app: &AppHandle) -> Result<Vec<String>, String> {
    let runtime = app.state::<Runtime>();
    if runtime.recording_shortcut.load(Ordering::Acquire) {
        crate::tray::refresh(app)?;
        return Ok(Vec::new());
    }
    let (bindings, unavailable) = {
        let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        let unavailable: Vec<_> = store
            .installed
            .keys()
            .filter(|id| !crate::contracts::ready(id, &store.installed))
            .cloned()
            .collect();
        (store.bindings(), unavailable)
    };
    let mut registered = runtime.shortcuts.lock().map_err(|_| "Hotkey occupate.")?;
    for (owner, shortcut) in registered.clone() {
        app.global_shortcut()
            .unregister(shortcut)
            .map_err(|e| e.to_string())?;
        registered.remove(&owner);
    }
    let mut errors = Vec::new();
    let mut assigned = Vec::new();
    for tool in overlay::tools()?
        .into_iter()
        .filter(|tool| tool.id != "capture")
    {
        if let Some(shortcut) = tool.shortcut {
            assigned.push(
                shortcut
                    .parse::<Shortcut>()
                    .map_err(|_| "Hotkey host non valida.")?,
            );
        }
    }
    for entry in bindings.into_iter().filter(|e| {
        e.enabled
            && !e
                .owner
                .app_id
                .as_ref()
                .is_some_and(|id| unavailable.contains(id))
    }) {
        if let Some(shortcut) = entry.shortcut.as_deref() {
            let parsed: Shortcut = shortcut.parse().map_err(|_| "Hotkey non valida.")?;
            if assigned.contains(&parsed) {
                errors.push(format!(
                    "Hotkey {shortcut} gia assegnata. Modificala dal catalogo per {}.",
                    entry.app_name
                ));
                continue;
            }
            let id = entry
                .owner
                .app_id
                .clone()
                .ok_or("Proprietario hotkey assente.")?;
            let action_id = entry.owner.action_id.clone();
            let target = id.clone();
            let target_action = action_id.clone();
            match app
                .global_shortcut()
                .on_shortcut(parsed, move |app, _, event| {
                    if event.state == ShortcutState::Pressed
                        && !app
                            .state::<Runtime>()
                            .recording_shortcut
                            .load(Ordering::Acquire)
                    {
                        let app = app.clone();
                        let id = target.clone();
                        let action_id = target_action.clone();
                        tauri::async_runtime::spawn(async move {
                            let result = if action_id == "open" {
                                toggle_app(app.clone(), id).await
                            } else {
                                launch_app_action(app.clone(), id, action_id).await
                            };
                            if let Err(error) = result {
                                overlay::report(&app, error);
                            }
                        });
                    }
                }) {
                Ok(()) => {
                    assigned.push(parsed);
                    registered.insert((id, action_id), parsed);
                }
                Err(e) => errors.push(format!(
                    "Hotkey {shortcut} non disponibile: {e}. Apri l'app dal catalogo."
                )),
            }
        }
    }
    drop(registered);
    crate::tray::refresh(app)?;
    Ok(errors)
}

pub fn register_host_shortcuts(app: &AppHandle) -> Result<Vec<String>, String> {
    let mut warnings = Vec::new();
    for tool in overlay::tools()?
        .into_iter()
        .filter(|tool| tool.id != "capture")
    {
        if let Some(shortcut) = tool.shortcut {
            let parsed: Shortcut = shortcut.parse().map_err(|_| "Hotkey host non valida.")?;
            if app.global_shortcut().is_registered(parsed) {
                continue;
            }
            let id = tool.id;
            if let Err(error) = app
                .global_shortcut()
                .on_shortcut(parsed, move |app, _, event| {
                    if event.state == ShortcutState::Pressed
                        && !app
                            .state::<Runtime>()
                            .recording_shortcut
                            .load(Ordering::Acquire)
                    {
                        let app = app.clone();
                        let tool = id.clone();
                        tauri::async_runtime::spawn(async move {
                            overlay::toggle(app, tool).await;
                        });
                    }
                })
            {
                warnings.push(format!(
                    "Hotkey {shortcut} non disponibile: {error}. Usa il menu tray."
                ));
            }
        }
    }
    Ok(warnings)
}

fn recording_shortcut(app: &AppHandle, active: bool) -> Result<Vec<String>, String> {
    let runtime = app.state::<Runtime>();
    let _configuration = runtime
        .configuration
        .lock()
        .map_err(|_| "Configurazione occupata.")?;
    if runtime.recording_shortcut.load(Ordering::Acquire) == active {
        return Ok(Vec::new());
    }
    runtime.recording_shortcut.store(active, Ordering::Release);
    if active {
        if let Err(error) = app.global_shortcut().unregister_all() {
            runtime.recording_shortcut.store(false, Ordering::Release);
            let mut warnings = register_host_shortcuts(app)?;
            warnings.extend(synchronize(app)?);
            return Err(format!(
                "Impossibile sospendere le hotkey: {error}. {}",
                warnings.join(" ")
            ));
        }
        runtime
            .shortcuts
            .lock()
            .map_err(|_| "Hotkey occupate.")?
            .clear();
        Ok(Vec::new())
    } else {
        let mut warnings = register_host_shortcuts(app)?;
        warnings.extend(synchronize(app)?);
        Ok(warnings)
    }
}

#[tauri::command]
pub async fn set_shortcut_recording(
    window: WebviewWindow,
    active: bool,
) -> Result<Vec<String>, String> {
    if window.label() != "overlay" {
        return Err("Operazione riservata all'host.".into());
    }
    if active && !window.is_focused().map_err(|e| e.to_string())? {
        return Err("Porta Orbit in primo piano per registrare una hotkey.".into());
    }
    recording_shortcut(window.app_handle(), active)
}

pub fn resume_shortcuts(app: &AppHandle) -> Result<(), String> {
    let warnings = recording_shortcut(app, false)?;
    if !warnings.is_empty() {
        overlay::report(app, warnings.join(" "));
    }
    Ok(())
}

#[tauri::command]
pub fn set_app_shortcut(
    app: AppHandle,
    id: String,
    shortcut: String,
) -> Result<Vec<String>, String> {
    set_action_shortcut(app, id, "open".into(), shortcut, None)
}

fn host_bindings() -> Result<Vec<ShortcutBinding>, String> {
    Ok(overlay::tools()?
        .into_iter()
        .filter(|tool| tool.id != "capture" && tool.shortcut.is_some())
        .map(|tool| ShortcutBinding {
            owner: ShortcutOwner {
                app_id: None,
                action_id: tool.id,
            },
            app_name: "Orbit".into(),
            label: tool.name,
            shortcut: tool.shortcut,
            enabled: true,
            registered: false,
        })
        .collect())
}

#[tauri::command]
pub fn list_shortcuts(app: AppHandle) -> Result<Vec<ShortcutBinding>, String> {
    let runtime = app.state::<Runtime>();
    let mut bindings = host_bindings()?;
    bindings.extend(
        runtime
            .store
            .lock()
            .map_err(|_| "Catalogo occupato.")?
            .bindings(),
    );
    let registered = runtime.shortcuts.lock().map_err(|_| "Hotkey occupate.")?;
    for binding in &mut bindings {
        if let Some(shortcut) = binding
            .shortcut
            .as_deref()
            .and_then(|s| packages::parse_shortcut(s).ok().flatten())
        {
            binding.registered = if let Some(id) = &binding.owner.app_id {
                registered.get(&(id.clone(), binding.owner.action_id.clone())) == Some(&shortcut)
            } else {
                app.global_shortcut().is_registered(shortcut)
            };
        }
    }
    Ok(bindings)
}

#[tauri::command]
pub fn check_app_shortcut(
    app: AppHandle,
    id: String,
    action_id: String,
    shortcut: String,
) -> Result<Vec<ShortcutBinding>, String> {
    let shortcut = shortcut.trim();
    let parsed = packages::parse_shortcut(shortcut)?;
    let mut conflicts = app
        .state::<Runtime>()
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .shortcut_conflicts(&id, &action_id, shortcut)?;
    if let Some(parsed) = parsed {
        conflicts.extend(host_bindings()?.into_iter().filter(|binding| {
            binding
                .shortcut
                .as_deref()
                .and_then(|s| packages::parse_shortcut(s).ok().flatten())
                == Some(parsed)
        }));
    }
    Ok(conflicts)
}

#[tauri::command]
pub fn set_action_shortcut(
    app: AppHandle,
    id: String,
    action_id: String,
    shortcut: String,
    replace: Option<Vec<ShortcutOwner>>,
) -> Result<Vec<String>, String> {
    let runtime = app.state::<Runtime>();
    let _configuration = runtime
        .configuration
        .lock()
        .map_err(|_| "Configurazione occupata.")?;
    let shortcut = shortcut.trim();
    if check_app_shortcut(app.clone(), id.clone(), action_id.clone(), shortcut.into())?
        .iter()
        .any(|c| c.owner.app_id.is_none())
    {
        return Err("Hotkey riservata all'host Orbit: non puo essere sostituita.".into());
    }
    let previous = {
        let mut store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        let previous = store.installed.clone();
        if action_id == "open" && replace.is_none() {
            store.set_shortcut(&id, shortcut)?;
        } else {
            store.assign_shortcut(&id, &action_id, shortcut, replace.as_deref())?;
        }
        previous
    };
    let warnings = match synchronize(&app) {
        Ok(warnings) => warnings,
        Err(error) => {
            runtime
                .store
                .lock()
                .map_err(|_| "Catalogo occupato.")?
                .commit(previous)?;
            let restored = synchronize(&app)
                .map_err(|restore| format!("{error}. Ripristino hotkey non riuscito: {restore}"))?;
            return Err(format!(
                "Hotkey non salvata: {error}. {}",
                restored.join(" ")
            ));
        }
    };
    if !shortcut.is_empty()
        && previous.get(&id).is_some_and(|entry| entry.enabled)
        && !runtime
            .shortcuts
            .lock()
            .map_err(|_| "Hotkey occupate.")?
            .contains_key(&(id, action_id))
    {
        runtime
            .store
            .lock()
            .map_err(|_| "Catalogo occupato.")?
            .commit(previous)?;
        let restored = synchronize(&app)?;
        return Err(format!(
            "Hotkey non disponibile nel sistema; assegnazioni precedenti ripristinate. {} {}",
            warnings.join(" "),
            restored.join(" ")
        ));
    }
    Ok(warnings)
}

#[tauri::command]
pub fn get_app_preferences(app: AppHandle, id: String) -> Result<Value, String> {
    app.state::<Runtime>()
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .preferences(&id)
}

#[tauri::command]
pub fn set_app_preferences(
    app: AppHandle,
    id: String,
    values: Value,
    reset: bool,
) -> Result<Value, String> {
    let values = app
        .state::<Runtime>()
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .save_preferences(&id, &values, reset)?;
    for window in app_windows(&app, &id) {
        if let Err(error) = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('orbit:preferences',{{detail:{values}}}))"
        )) {
            return Err(format!(
                "Preferenze salvate, ma l'app aperta non e stata aggiornata: {error}"
            ));
        }
    }
    Ok(values)
}

fn stop(app: &AppHandle, id: &str, cancel_timers: bool) -> Result<(), String> {
    let runtime = app.state::<Runtime>();
    if let Some(token) = runtime
        .sessions
        .lock()
        .map_err(|_| "Sessioni occupate.")?
        .remove(id)
    {
        token.cancel();
    }
    for window in app_windows(app, id) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    if cancel_timers {
        let mut timers = runtime.timers.lock().map_err(|_| "Timer occupati.")?;
        let prefix = format!("{id}:");
        timers.retain(|key, token| {
            if key.starts_with(&prefix) {
                token.cancel();
                false
            } else {
                true
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn install_package(
    app: AppHandle,
    source: String,
    digest: String,
) -> Result<Vec<String>, String> {
    let runtime = app.state::<Runtime>();
    let _configuration = runtime
        .configuration
        .lock()
        .map_err(|_| "Configurazione occupata.")?;
    let (package, _) = packages::decode(&source)?;
    let id = &package.manifest.id;
    if !app_windows(&app, id).is_empty() {
        return Err(
            "Termina la sotto-app dal catalogo prima di aggiornarla, per non perdere lavoro."
                .into(),
        );
    }
    let mut warnings = app
        .state::<Runtime>()
        .store
        .lock()
        .map_err(|_| "Catalogo occupato.")?
        .install(&source, &digest)?;
    stop(&app, id, true)?;
    warnings.extend(synchronize(&app)?);
    restore_timers(&app, id)?;
    Ok(warnings)
}

#[tauri::command]
pub fn change_app(
    app: AppHandle,
    id: String,
    action: String,
    delete_data: bool,
) -> Result<Vec<String>, String> {
    let runtime = app.state::<Runtime>();
    let _configuration = runtime
        .configuration
        .lock()
        .map_err(|_| "Configurazione occupata.")?;
    if !packages::identifier(&id) {
        return Err("ID app non valido.".into());
    }
    if action == "close" {
        for window in app_windows(&app, &id) {
            window
                .eval("window.dispatchEvent(new Event('orbit:close'))")
                .map_err(|e| e.to_string())?;
        }
        return Ok(Vec::new());
    }
    if action == "reset-geometry" {
        let manifest = runtime
            .store
            .lock()
            .map_err(|_| "Catalogo occupato.")?
            .installed
            .get(&id)
            .ok_or("App non disponibile.")?
            .manifest
            .clone();
        crate::window_geometry::reset(&app, &id)?;
        for window in app_windows(&app, &id) {
            window
                .set_size(tauri::LogicalSize::new(
                    manifest
                        .window
                        .as_ref()
                        .map_or(440.0, |s| f64::from(s.width)),
                    manifest
                        .window
                        .as_ref()
                        .map_or(520.0, |s| f64::from(s.height)),
                ))
                .map_err(|e| e.to_string())?;
            let owner = resource_owner(&window)?;
            let feature = runtime
                .features
                .lock()
                .map_err(|_| "Sessioni occupate.")?
                .get(&owner)
                .cloned();
            let key = feature.map_or_else(
                || format!("app:{id}"),
                |s| format!("feature:{id}:{}", s.action_id),
            );
            crate::window_geometry::restore(&window, &key)?;
        }
        return Ok(Vec::new());
    }
    if !matches!(
        action.as_str(),
        "enable" | "disable" | "uninstall" | "rollback"
    ) {
        return Err("Operazione non valida.".into());
    }
    if !app_windows(&app, &id).is_empty() {
        return Err(
            "Termina la sotto-app dal catalogo prima di modificarla, per non perdere lavoro."
                .into(),
        );
    }
    let mut warnings = Vec::new();
    {
        let runtime = app.state::<Runtime>();
        let mut store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        if action == "disable" || action == "uninstall" {
            let mut next = store.installed.clone();
            if action == "uninstall" {
                next.remove(&id);
            } else if let Some(entry) = next.get_mut(&id) {
                entry.enabled = false;
            }
            let affected = crate::contracts::breaking(&store.installed, &next);
            if !affected.is_empty() {
                return Err(format!("Dipendenze richieste da: {}. Installa un fornitore alternativo o disabilita prima le app dipendenti.",affected.join(", ")));
            }
        }
        match action.as_str() {
            "enable" => store.enable(&id, true)?,
            "disable" => store.enable(&id, false)?,
            "rollback" => warnings.extend(store.rollback(&id)?),
            "uninstall" => {
                store.write_data(&id, "timers", &json!([]))?;
                store.uninstall(&id, delete_data)?;
            }
            _ => unreachable!(),
        }
    }
    stop(&app, &id, true)?;
    warnings.extend(synchronize(&app)?);
    if action == "enable" || action == "rollback" {
        restore_timers(&app, &id)?;
    }
    Ok(warnings)
}

fn app_url(id: &str, entry: &str) -> Result<url::Url, String> {
    url::Url::parse(&format!("orbitapp://{id}/{entry}")).map_err(|e| e.to_string())
}
fn permitted_url(id: &str, url: &url::Url) -> bool {
    (url.scheme() == "orbitapp" && url.host_str() == Some(id))
        || (matches!(url.scheme(), "http" | "https")
            && url.host_str() == Some(format!("orbitapp.{id}").as_str()))
}

#[tauri::command]
pub async fn launch_app(app: AppHandle, id: String) -> Result<(), String> {
    open_app(app, id, None, false, None).await
}

#[tauri::command]
pub async fn launch_app_action(
    app: AppHandle,
    id: String,
    action_id: String,
) -> Result<(), String> {
    open_app(app, id, Some(action_id), false, None).await
}

pub(crate) async fn launch_service(
    app: AppHandle,
    id: String,
    transient: bool,
) -> Result<(), String> {
    open_app(app, id, None, transient, None).await
}
pub(crate) async fn launch_feature(
    app: AppHandle,
    owner: String,
    session: FeatureSession,
) -> Result<(), String> {
    open_app(
        app,
        session.app_id.clone(),
        None,
        true,
        Some((owner, session)),
    )
    .await
}

async fn open_app(
    app: AppHandle,
    id: String,
    action: Option<String>,
    transient: bool,
    feature: Option<(String, FeatureSession)>,
) -> Result<(), String> {
    if !packages::identifier(&id) {
        return Err("ID app non valido.".into());
    }
    let runtime = app.state::<Runtime>();
    let _launching = runtime.launching.lock().await;
    let _configuration = runtime
        .configuration
        .lock()
        .map_err(|_| "Configurazione occupata.")?;
    let manifest = {
        let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        store.authorize(&format!("app-{id}"), None)?;
        if !crate::contracts::ready(&id, &store.installed) {
            return Err(
                "Dipendenze obbligatorie mancanti. Controlla le impostazioni dell'app.".into(),
            );
        }
        store.installed[&id].manifest.clone()
    };
    if action
        .as_ref()
        .is_some_and(|id| !manifest.actions.iter().any(|a| &a.id == id))
    {
        return Err("Azione non dichiarata dall'app.".into());
    }
    let scoped = feature.is_some();
    let geometry_key = feature.as_ref().map_or_else(
        || format!("app:{id}"),
        |(_, session)| format!("feature:{}:{}", session.app_id, session.action_id),
    );
    let entry = if let Some((_, session)) = &feature {
        manifest
            .exports
            .iter()
            .find(|e| e.id == session.action_id)
            .and_then(|e| e.interactive_entry.clone())
            .ok_or("UI dedicata non dichiarata.")?
    } else {
        manifest.entry.clone()
    };
    let id = feature.as_ref().map_or(id, |(owner, _)| owner.clone());
    if let Some((owner, session)) = &feature {
        let mut features = runtime.features.lock().map_err(|_| "Sessioni occupate.")?;
        if features.len() >= 32 {
            return Err("Limite finestre di funzione raggiunto.".into());
        }
        features.insert(owner.clone(), session.clone());
    }
    if !scoped {
        let mut hub = runtime.interop.lock().map_err(|_| "Chiamate occupate.")?;
        if !transient {
            hub.transient.remove(&id);
        } else if app.get_webview_window(&format!("app-{id}")).is_none() {
            hub.transient.insert(id.clone());
        }
    }
    if !transient {
        overlay::hide_overlay(app.clone())?;
    }
    if let Some(window) = app.get_webview_window(&format!("app-{id}")) {
        if let Some(action) = action {
            let mut sessions = runtime.actions.lock().map_err(|_| "Azioni occupate.")?;
            let session = sessions.entry(id.clone()).or_default();
            if session.ready {
                window
                    .eval(format!(
                        "window.dispatchEvent(new CustomEvent('orbit:action',{{detail:{}}}))",
                        json!(action)
                    ))
                    .map_err(|e| format!("Invio azione non riuscito: {e}"))?;
            } else {
                if session.pending.len() >= 16 {
                    return Err("L'app non e pronta: troppe azioni in attesa.".into());
                }
                session.pending.push(action);
            }
        }
        if !transient {
            crate::window_geometry::show(&window)?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    runtime
        .actions
        .lock()
        .map_err(|_| "Azioni occupate.")?
        .insert(
            id.clone(),
            ActionSession {
                ready: false,
                pending: action.into_iter().collect(),
            },
        );
    let target = id.clone();
    let navigation_entry = entry.clone();
    let theme = crate::appearance::get_theme(app.clone())?;
    let window = WebviewWindowBuilder::new(
        &app,
        format!("app-{id}"),
        WebviewUrl::External(app_url(&id, &entry)?),
    )
    .initialization_script(include_str!("../../shared/webview.js"))
    .data_directory(app.state::<crate::data_paths::DataPaths>().webview.clone())
    .initialization_script(include_str!("../../shared/window-controls.js"))
    .initialization_script(crate::appearance::initialization(theme)?)
    .initialization_script(crate::locale::initialization(crate::locale::get_locale(
        app.clone(),
    )?)?)
    .devtools(false)
    .title(&manifest.name)
    .inner_size(
        manifest
            .window
            .as_ref()
            .map_or(440.0, |size| f64::from(size.width)),
        manifest
            .window
            .as_ref()
            .map_or(520.0, |size| f64::from(size.height)),
    )
    .min_inner_size(1.0, 1.0)
    .decorations(false)
    .resizable(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .use_https_scheme(true)
    .visible(false)
    .on_navigation(move |url| {
        permitted_url(&target, url) && (!scoped || url.path() == format!("/{navigation_entry}"))
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .build()
    .map_err(|e| format!("Avvio sotto-app non riuscito: {e}"))?;
    let token = CancellationToken::new();
    runtime
        .sessions
        .lock()
        .map_err(|_| "Sessioni occupate.")?
        .insert(id.clone(), token.clone());
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            token.cancel();
            crate::interop::closed(&handle, &id);
            if let Ok(mut features) = handle.state::<Runtime>().features.lock() {
                features.remove(&id);
            }
            if let Ok(mut sessions) = handle.state::<Runtime>().sessions.lock() {
                sessions.remove(&id);
            }
            match handle.state::<Runtime>().pinned.lock() {
                Ok(mut pinned) => {
                    pinned.remove(&id);
                }
                Err(_) => overlay::report(&handle, "Chiusura pin app non riuscita.".into()),
            }
            match handle.state::<Runtime>().actions.lock() {
                Ok(mut actions) => {
                    actions.remove(&id);
                }
                Err(_) => overlay::report(&handle, "Chiusura azioni app non riuscita.".into()),
            }
        }
    });
    platform::configure(&window)?;
    crate::window_geometry::attach(&window, geometry_key)?;
    if !transient {
        crate::window_geometry::show(&window)?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn toggle_app(app: AppHandle, id: String) -> Result<(), String> {
    let capturing = app
        .state::<Runtime>()
        .capture
        .lock()
        .map_err(|_| "Cattura occupata.")?
        .as_ref()
        .is_some_and(|pending| pending.owner == format!("app-{id}"));
    if capturing {
        return overlay::hide_overlay(app);
    }
    if let Some(window) = app.get_webview_window(&format!("app-{id}")) {
        if window.is_visible().map_err(|e| e.to_string())? {
            return dismiss_window(&window, &id);
        }
    }
    launch_app(app, id).await
}

fn dismiss_window(window: &WebviewWindow, id: &str) -> Result<(), String> {
    let runtime = window.state::<Runtime>();
    let pinned = runtime.pinned.lock().map_err(|_| "Pin app occupato.")?;
    if !pinned.contains(id) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn serve(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let mut policy = crate::network::policy(&crate::network::Network::default())
        .expect("valid default network policy");
    let result = (|| -> Result<(Vec<u8>, &'static str), String> {
        let runtime = context.app_handle().state::<Runtime>();
        let owner = context
            .webview_label()
            .strip_prefix("app-")
            .ok_or("Finestra non autorizzata.")?;
        let id = package_id(&runtime, owner)?;
        let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        store.authorize(&format!("app-{id}"), None)?;
        let uri = url::Url::parse(&request.uri().to_string()).map_err(|e| e.to_string())?;
        if !permitted_url(owner, &uri) {
            return Err("Origine app non autorizzata.".into());
        }
        policy = crate::network::policy(&store.installed[&id].manifest.network)?;
        let path = uri.path().trim_start_matches('/');
        if path == "favicon.ico" {
            return Ok((Vec::new(), "image/x-icon"));
        }
        if path == "orbit-sdk.js" {
            return Ok((
                include_bytes!("../../sdk/dist/orbit-sdk.js").to_vec(),
                "text/javascript",
            ));
        }
        if path == "orbit-theme.css" {
            return Ok((
                include_bytes!("../../shared/app-theme.css").to_vec(),
                "text/css",
            ));
        }
        if !packages::asset_path(path) {
            return Err("Asset non valido.".into());
        }
        let package = store.package(&id)?;
        let data = package.files.get(path).ok_or("Asset non presente.")?;
        let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
        let mime = if path.ends_with(".html") {
            "text/html"
        } else if path.ends_with(".js") {
            "text/javascript"
        } else if path.ends_with(".css") {
            "text/css"
        } else if path.ends_with(".svg") {
            "image/svg+xml"
        } else if path.ends_with(".png") {
            "image/png"
        } else if path.ends_with(".jpg") {
            "image/jpeg"
        } else {
            "application/octet-stream"
        };
        Ok((bytes, mime))
    })();
    let (status, body, mime) = match result {
        Ok((bytes, mime)) => (200, bytes, mime),
        Err(error) => {
            eprintln!("Asset sotto-app negato: {error}");
            (403, b"Asset non disponibile".to_vec(), "text/plain")
        }
    };
    tauri::http::Response::builder().status(status)
        .header("Content-Type",mime).header("X-Content-Type-Options","nosniff")
        .header("Cache-Control","no-store")
        .header("Content-Security-Policy",policy)
        .header("Permissions-Policy","camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), display-capture=(), usb=(), serial=(), hid=()")
        .body(body).expect("static response headers")
}

fn argument<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|e| format!("Argomenti SDK non validi: {e}"))
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Timer {
    id: String,
    label: String,
    deadline: u64,
    fired: bool,
}
fn now() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs())
}
fn read_timers(store: &Store, id: &str) -> Result<Vec<Timer>, String> {
    let value = store.read_data(id, "timers")?;
    if value == json!({}) {
        Ok(Vec::new())
    } else {
        argument(&value)
    }
}
fn schedule(app: &AppHandle, id: &str, timer: Timer) -> Result<(), String> {
    if timer.fired {
        return Ok(());
    }
    let token = Arc::new(CancellationToken::new());
    let key = format!("{id}:{}", timer.id);
    let runtime = app.state::<Runtime>();
    if let Some(old) = runtime
        .timers
        .lock()
        .map_err(|_| "Timer occupati.")?
        .insert(key.clone(), token.clone())
    {
        old.cancel();
    }
    let app = app.clone();
    let id = id.to_owned();
    tauri::async_runtime::spawn(async move {
        let result = async {
            let delay = timer.deadline.saturating_sub(now()?);
            tokio::select! { _ = token.cancelled() => return Ok::<_,String>(()), _ = tokio::time::sleep(Duration::from_secs(delay)) => {} }
            let runtime = app.state::<Runtime>();
            let notify = {
                let store = runtime.store.lock().map_err(|_|"Catalogo occupato.")?;
                let mut scheduled = runtime.timers.lock().map_err(|_|"Timer occupati.")?;
                if token.is_cancelled() || !scheduled.get(&key).is_some_and(|current| Arc::ptr_eq(current, &token)) {
                    return Ok(());
                }
                scheduled.remove(&key);
                if store.authorize(&format!("app-{id}"),Some(Permission::Timers)).is_err() { return Ok(()); }
                let mut timers = read_timers(&store,&id)?;
                let item = timers.iter_mut().find(|t|t.id==timer.id && t.deadline==timer.deadline && !t.fired);
                if let Some(item) = item { item.fired=true; store.write_data(&id,"timers",&json!(timers))?; true } else { false }
            };
            if notify {
                app.notification().builder().title("Orbit Timer").body(&timer.label).show().map_err(|e|format!("Notifica timer non riuscita: {e}"))?;
            }
            Ok(())
        }.await;
        if let Err(error) = result {
            overlay::report(&app, error);
        }
    });
    Ok(())
}
pub fn restore_timers(app: &AppHandle, id: &str) -> Result<(), String> {
    let runtime = app.state::<Runtime>();
    let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
    if store
        .authorize(&format!("app-{id}"), Some(Permission::Timers))
        .is_err()
    {
        return Ok(());
    }
    for timer in read_timers(&store, id)? {
        schedule(app, id, timer)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn app_request(
    window: WebviewWindow,
    action: String,
    args: Value,
) -> Result<Value, String> {
    let permission = match action.as_str() {
        "storage.read" | "storage.write" => Some(Permission::Storage),
        "timer.list" | "timer.start" | "timer.cancel" => Some(Permission::Timers),
        "capture.select" | "capture.cancel" | "attachments.create" => {
            Some(Permission::ScreenCapture)
        }
        "attachments.save" => Some(Permission::FileSave),
        "files.read" | "files.list" | "widgets.read" => Some(Permission::FilesRead),
        "files.write" | "files.remove" => Some(Permission::FilesWrite),
        "services.call" | "services.list" | "services.cancel" => Some(Permission::AppActions),
        "ai.cancel" => Some(Permission::AiChat),
        "context"
        | "window.close"
        | "window.hide"
        | "window.dismiss"
        | "window.state"
        | "window.pin"
        | "window.drag"
        | "window.resize"
        | "preferences.read"
        | "preferences.update"
        | "shortcuts.list"
        | "shortcuts.check"
        | "actions.register"
        | "appearance.get"
        | "locale.get"
        | "services.register"
        | "services.respond"
        | "attachments.read"
        | "attachments.retain"
        | "attachments.release" => None,
        _ => return Err("Metodo SDK sconosciuto.".into()),
    };
    let id = authorize(&window, permission)?;
    let owner = resource_owner(&window)?;
    let feature = window
        .state::<Runtime>()
        .features
        .lock()
        .map_err(|_| "Sessioni occupate.")?
        .get(&owner)
        .cloned();
    if feature.is_some()
        && (action.starts_with("storage.")
            || action.starts_with("files.")
            || action.starts_with("widgets.")
            || action.starts_with("timer.")
            || action.starts_with("shortcuts.")
            || matches!(
                action.as_str(),
                "preferences.update" | "actions.register" | "attachments.save"
            ))
    {
        return Err("Operazione riservata all'app completa, non alla sessione di funzione.".into());
    }
    if action == "widgets.read" {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Input {
            widget_id: String,
        }
        let input: Input =
            serde_json::from_value(args).map_err(|_| "Argomenti widget non validi.")?;
        return Ok(json!(
            crate::widgets::get_widget_data(window.app_handle().clone(), id, input.widget_id, None)
                .await?
        ));
    }
    if action.starts_with("files.") {
        let runtime = window.state::<Runtime>();
        let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        return crate::files::request(
            &store.root.join("data").join(id).join("files"),
            &action,
            args,
        );
    }
    if action.starts_with("services.") || action.starts_with("attachments.") {
        return crate::interop::request(window, owner, &action, args).await;
    }
    let app = window.app_handle();
    let runtime = app.state::<Runtime>();
    match action.as_str() {
        "capture.cancel" => {
            let owned = runtime
                .capture
                .lock()
                .map_err(|_| "Cattura occupata.")?
                .as_ref()
                .is_some_and(|p| p.owner == window.label());
            if owned {
                overlay::hide_overlay(app.clone())?;
            }
            Ok(Value::Null)
        }
        "appearance.get" => Ok(json!(crate::appearance::get_theme(app.clone())?)),
        "locale.get" => Ok(json!(crate::locale::get_locale(app.clone())?)),
        "context" => {
            let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
            let manifest = &store.installed[&id].manifest;
            Ok(json!({"id":id,"sdk":1,"platform":std::env::consts::OS,
                "name":manifest.name,"version":manifest.version,"permissions":manifest.permissions,
                "invocation":feature,"mode":if feature.is_some() {"interactive"} else {"app"}}))
        }
        "preferences.read" => get_app_preferences(app.clone(), id),
        "preferences.update" => set_app_preferences(app.clone(), id, args, false),
        "shortcuts.list" => Ok(json!(list_shortcuts(app.clone())?)),
        "shortcuts.check" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Input {
                action_id: String,
                shortcut: String,
            }
            let input: Input = argument(&args)?;
            Ok(json!(check_app_shortcut(
                app.clone(),
                id,
                input.action_id,
                input.shortcut
            )?))
        }
        "actions.register" => {
            let ids: Vec<String> = argument(&args)?;
            let declared: Vec<String> = runtime
                .store
                .lock()
                .map_err(|_| "Catalogo occupato.")?
                .installed[&id]
                .manifest
                .actions
                .iter()
                .map(|a| a.id.clone())
                .collect();
            if ids.len() != declared.len() || !declared.iter().all(|id| ids.contains(id)) {
                return Err("Registra esattamente le azioni dichiarate nel manifest.".into());
            }
            let mut sessions = runtime.actions.lock().map_err(|_| "Azioni occupate.")?;
            let session = sessions.entry(id).or_default();
            session.ready = true;
            Ok(json!(std::mem::take(&mut session.pending)))
        }
        "window.close" => {
            window.destroy().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window.hide" => {
            if feature.is_some() {
                window.destroy()
            } else {
                window.hide()
            }
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window.dismiss" => {
            if feature.is_some() {
                if !runtime
                    .pinned
                    .lock()
                    .map_err(|_| "Pin app occupato.")?
                    .contains(&owner)
                {
                    window.destroy().map_err(|e| e.to_string())?;
                }
            } else {
                dismiss_window(&window, &owner)?;
            }
            Ok(Value::Null)
        }
        "window.state" => {
            let pinned = runtime.pinned.lock().map_err(|_| "Pin app occupato.")?;
            Ok(json!({
                "pinned": pinned.contains(&owner),
                "visible": window.is_visible().map_err(|e| e.to_string())?
            }))
        }
        "window.pin" => {
            let active: bool = argument(&args["pinned"])?;
            let mut pinned = runtime.pinned.lock().map_err(|_| "Pin app occupato.")?;
            if active {
                runtime
                    .interop
                    .lock()
                    .map_err(|_| "Chiamate occupate.")?
                    .transient
                    .remove(&owner);
                pinned.insert(owner);
            } else {
                pinned.remove(&owner);
            }
            window
                .eval(format!(
                    "window.dispatchEvent(new CustomEvent('orbit:pin',{{detail:{active}}}))"
                ))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window.drag" => {
            window.start_dragging().map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "window.resize" => {
            let direction = argument(&args["direction"])?;
            window
                .as_ref()
                .window()
                .start_resize_dragging(direction)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "storage.read" => runtime
            .store
            .lock()
            .map_err(|_| "Catalogo occupato.")?
            .read_data(&id, "storage"),
        "storage.write" => {
            runtime
                .store
                .lock()
                .map_err(|_| "Catalogo occupato.")?
                .write_data(&id, "storage", &args)?;
            Ok(Value::Null)
        }
        "timer.list" => {
            let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
            Ok(json!(read_timers(&store, &id)?))
        }
        "timer.start" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Input {
                id: String,
                label: String,
                seconds: u64,
            }
            let input: Input = argument(&args)?;
            if !packages::identifier(&input.id)
                || input.label.is_empty()
                || input.label.len() > 120
                || input.seconds == 0
                || input.seconds > 86400
            {
                return Err("Timer non valido (da 1 secondo a 24 ore).".into());
            }
            let timer = Timer {
                id: input.id,
                label: input.label,
                deadline: now()? + input.seconds,
                fired: false,
            };
            {
                let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
                let mut timers = read_timers(&store, &id)?;
                timers.retain(|t| t.id != timer.id);
                if timers.len() >= 32 {
                    return Err("Limite di 32 timer raggiunto.".into());
                }
                timers.push(timer.clone());
                store.write_data(&id, "timers", &json!(timers))?;
                schedule(app, &id, timer.clone())?;
            }
            Ok(json!(timer))
        }
        "timer.cancel" => {
            let timer_id = args["id"].as_str().ok_or("ID timer assente.")?;
            let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
            let mut timers = read_timers(&store, &id)?;
            timers.retain(|t| t.id != timer_id);
            store.write_data(&id, "timers", &json!(timers))?;
            if let Some(token) = runtime
                .timers
                .lock()
                .map_err(|_| "Timer occupati.")?
                .remove(&format!("{id}:{timer_id}"))
            {
                token.cancel();
            }
            Ok(Value::Null)
        }
        "ai.cancel" => {
            let request_id = args["requestId"].as_str().ok_or("ID richiesta assente.")?;
            ai::cancel_chat(app.state::<AppState>(), format!("{owner}:{request_id}"))?;
            Ok(Value::Null)
        }
        "capture.select" => {
            let (sender, receiver) = tokio::sync::oneshot::channel();
            {
                let mut pending = runtime.capture.lock().map_err(|_| "Cattura occupata.")?;
                if pending.is_some() {
                    return Err("Una selezione e gia in corso.".into());
                }
                *pending = Some(CaptureRequest {
                    owner: window.label().into(),
                    sender,
                });
            }
            if let Err(error) = overlay::open_capture(app.clone()).await {
                cancel_capture(app, "Cattura non riuscita.")?;
                return Err(error);
            }
            let token = runtime
                .sessions
                .lock()
                .map_err(|_| "Sessioni occupate.")?
                .get(&owner)
                .cloned()
                .ok_or("Sessione chiusa.")?;
            tokio::select! {
                result=receiver => Ok(json!(result.map_err(|_|"Cattura annullata.")??)),
                _=token.cancelled() => { overlay::hide_overlay(app.clone())?; Err("App chiusa durante la cattura.".into()) }
            }
        }
        _ => unreachable!(),
    }
}

#[tauri::command]
pub async fn app_chat(
    window: WebviewWindow,
    request_id: String,
    messages: Vec<crate::protocol::Message>,
    channel: Channel<ai::StreamEvent>,
) -> Result<(), String> {
    authorize(&window, Some(Permission::AiChat))?;
    let id = resource_owner(&window)?;
    if request_id.len() > 80 || request_id.is_empty() {
        return Err("ID richiesta non valido.".into());
    }
    let runtime = window.state::<Runtime>();
    let token = runtime
        .sessions
        .lock()
        .map_err(|_| "Sessioni occupate.")?
        .get(&id)
        .cloned()
        .ok_or("Sessione chiusa.")?
        .child_token();
    ai::run_chat(
        &window.state::<AppState>(),
        format!("{id}:{request_id}"),
        messages,
        channel,
        token,
    )
    .await
}

pub fn hide_for_capture(app: &AppHandle) -> Result<(), String> {
    let runtime = app.state::<Runtime>();
    let mut hidden = runtime.hidden.lock().map_err(|_| "Finestre occupate.")?;
    for (label, window) in app.webview_windows() {
        if label.starts_with("app-") && window.is_visible().map_err(|e| e.to_string())? {
            window.hide().map_err(|e| e.to_string())?;
            hidden.push(label);
        }
    }
    Ok(())
}
pub fn restore_windows(app: &AppHandle) -> Result<(), String> {
    let labels = std::mem::take(
        &mut *app
            .state::<Runtime>()
            .hidden
            .lock()
            .map_err(|_| "Finestre occupate.")?,
    );
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            crate::window_geometry::show(&window)?;
        }
    }
    Ok(())
}
pub fn cancel_capture(app: &AppHandle, reason: &str) -> Result<(), String> {
    if let Some(pending) = app
        .state::<Runtime>()
        .capture
        .lock()
        .map_err(|_| "Cattura occupata.")?
        .take()
    {
        let _ = pending.sender.send(Err(reason.into()));
    }
    restore_windows(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_packages_are_valid_and_have_distinct_ids() {
        let ids: std::collections::BTreeSet<_> = STARTERS
            .iter()
            .map(|source| packages::decode(source).unwrap().0.manifest.id)
            .collect();
        assert_eq!(ids.len(), 4);
        assert!(ids.contains("orbit-chat"));
        assert!(ids.contains("orbit-capture"));
    }
    #[test]
    fn app_windows_cannot_invoke_host_commands() {
        assert!(ipc_allowed("app-demo", "app_request"));
        for method in [
            "get_settings",
            "save_settings",
            "quit_app",
            "check_agent",
            "stream_chat",
            "install_package",
            "get_widget_data",
        ] {
            assert!(!ipc_allowed("app-demo", method));
        }
        assert!(!ipc_allowed("unknown", "app_request"));
    }
    #[test]
    fn navigation_is_scoped_to_package_origin() {
        assert!(permitted_url(
            "demo",
            &url::Url::parse("orbitapp://demo/index.html").unwrap()
        ));
        assert!(!permitted_url(
            "demo",
            &url::Url::parse("https://example.com").unwrap()
        ));
        assert!(!permitted_url(
            "demo",
            &url::Url::parse("orbitapp://other/index.html").unwrap()
        ));
    }
}

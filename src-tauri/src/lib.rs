mod ai;
mod appearance;
mod apps;
mod capture;
mod contracts;
mod data_paths;
mod files;
mod interop;
mod locale;
mod network;
mod overlay;
mod packages;
mod platform;
mod presentation;
mod presets;
mod protocol;
mod settings;
mod tray;
mod widgets;
mod window_geometry;

use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Mutex},
    time::Duration,
};
use tauri::{tray::TrayIconBuilder, Manager};
use tokio_util::sync::CancellationToken;

pub struct AppState {
    settings: Mutex<protocol::Settings>,
    capture: Mutex<Option<image::RgbaImage>>,
    active_tool: Mutex<String>,
    panel: Mutex<presentation::PanelState>,
    opening: AtomicBool,
    dismissed: AtomicBool,
    requests: Mutex<HashMap<String, CancellationToken>>,
    startup_errors: Mutex<Vec<String>>,
    client: reqwest::Client,
}

#[tauri::command]
async fn check_agent(executable: String) -> Result<String, String> {
    let executable = executable.trim();
    if executable.is_empty() || executable.contains(['\n', '\r', '\0']) {
        return Err("Indica un eseguibile OpenCode valido.".into());
    }
    let output = tokio::time::timeout(Duration::from_secs(10),
        tokio::process::Command::new(executable).arg("--version").kill_on_drop(true).output()
    ).await.map_err(|_| "OpenCode non ha risposto entro 10 secondi.")?
        .map_err(|e| format!("OpenCode non disponibile: {e}. Installa OpenCode o indica il percorso completo dell'eseguibile."))?;
    if !output.status.success() {
        return Err(format!(
            "OpenCode ha terminato con stato {}.",
            output.status
        ));
    }
    let version = String::from_utf8(output.stdout).map_err(|_| "Versione OpenCode non valida.")?;
    let version = version.trim();
    if version.is_empty() {
        return Err("OpenCode non ha restituito una versione.".into());
    }
    Ok(format!(
        "OpenCode disponibile: {}",
        version.chars().take(120).collect::<String>()
    ))
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(requests) = state.requests.lock() {
        for token in requests.values() {
            token.cancel();
        }
    }
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("orbitapp", apps::serve)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let paths = data_paths::initialize(app.handle())?;
            let config_path = paths.host.join("settings.json");
            let mut startup_errors = Vec::new();
            let config = match settings::read(&config_path) {
                Ok(config) => config,
                Err(error) => {
                    startup_errors.push(error);
                    protocol::Settings::default()
                }
            };
            let theme = match appearance::read(&paths.host.join("appearance.json")) {
                Ok(theme) => theme,
                Err(error) => {
                    startup_errors.push(error);
                    appearance::ThemeMode::System
                }
            };
            app.manage(appearance::Appearance(Mutex::new(theme)));
            let language = match locale::read(&paths.host.join("language.json")) {
                Ok(locale) => locale,
                Err(error) => {
                    startup_errors.push(error);
                    locale::Locale::Italian
                }
            };
            app.manage(locale::Language(Mutex::new(language)));
            app.manage(paths);
            app.manage(presets::Runtime::default());
            let geometry =
                window_geometry::WindowGeometry::load(app.handle()).unwrap_or_else(|error| {
                    startup_errors.push(error);
                    window_geometry::WindowGeometry::default()
                });
            app.manage(geometry);
            app.manage(AppState {
                settings: Mutex::new(config),
                capture: Mutex::new(None),
                active_tool: Mutex::new("home".into()),
                panel: Mutex::new(presentation::PanelState::default()),
                opening: AtomicBool::new(false),
                dismissed: AtomicBool::new(false),
                requests: Mutex::new(HashMap::new()),
                startup_errors: Mutex::new(startup_errors),
                client: reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .connect_timeout(Duration::from_secs(15))
                    .timeout(Duration::from_secs(180))
                    .build()?,
            });
            app.manage(apps::Runtime::new(app.handle())?);
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "overlay")
                .ok_or("Configurazione overlay assente.")?
                .clone();
            let window = tauri::WebviewWindowBuilder::from_config(app, &config)?
                .data_directory(app.state::<data_paths::DataPaths>().webview.clone())
                .build()?;
            platform::configure(&window)?;
            let mut app_warnings = apps::register_host_shortcuts(app.handle())?;
            app_warnings.extend(apps::synchronize(app.handle())?);
            app.state::<AppState>()
                .startup_errors
                .lock()
                .map_err(|_| "Stato avvio occupato.")?
                .extend(app_warnings);
            for installed in apps::list_apps(app.handle().clone())? {
                apps::restore_timers(app.handle(), &installed.manifest.id)?;
            }
            let menu = tray::menu(app.handle())?;
            let icon = tauri::image::Image::new_owned(tray_pixels(), 32, 32);
            TrayIconBuilder::with_id(tray::ID)
                .icon(icon)
                .tooltip("Orbit - AI overlay")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| tray::activate(app, event.id.as_ref()))
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label().starts_with("app-") {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        overlay::report(
                            window.app_handle(),
                            format!("Nascondi sotto-app: {error}"),
                        );
                    }
                }
                return;
            }
            if window.label() != "overlay" {
                return;
            }
            if matches!(event, tauri::WindowEvent::Focused(false)) {
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    let result =
                        window
                            .is_focused()
                            .map_err(|e| e.to_string())
                            .and_then(|focused| {
                                if focused {
                                    Ok(())
                                } else {
                                    apps::resume_shortcuts(window.app_handle())
                                }
                            });
                    if let Err(error) = result {
                        overlay::report(window.app_handle(), error);
                    }
                });
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = overlay::hide_overlay(window.app_handle().clone()) {
                    overlay::report(window.app_handle(), error);
                }
            }
        })
        .invoke_handler(|invoke| {
            if !apps::ipc_allowed(
                invoke.message.webview_ref().label(),
                invoke.message.command(),
            ) {
                invoke
                    .resolver
                    .reject("Comando non autorizzato per questa finestra.");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                overlay::open_tool,
                overlay::hide_overlay,
                overlay::frontend_ready,
                overlay::finish_capture,
                capture::crop_capture,
                capture::discard_capture,
                settings::get_settings,
                appearance::get_theme,
                appearance::set_theme,
                locale::get_locale,
                locale::set_locale,
                settings::save_settings,
                data_paths::data_location,
                data_paths::get_home_layout,
                widgets::get_widget_data,
                widgets::get_widget_image,
                presets::get_overlay_presets,
                presets::save_overlay_presets,
                presets::overlay_preset_status,
                presets::overlay_monitor,
                presets::apply_overlay_preset,
                presets::persistent_view,
                presets::persistent_ready,
                presets::preview_persistent_image,
                presets::close_persistent_preview,
                data_paths::save_home_layout,
                ai::stream_chat,
                ai::cancel_chat,
                ai::test_provider,
                check_agent,
                quit_app,
                apps::list_apps,
                apps::set_app_hidden,
                apps::dependency_status,
                apps::runtime_info,
                apps::preview_package,
                apps::starter_packages,
                apps::install_package,
                apps::change_app,
                apps::set_app_shortcut,
                apps::list_shortcuts,
                apps::check_app_shortcut,
                apps::set_action_shortcut,
                apps::set_shortcut_recording,
                apps::get_app_preferences,
                apps::set_app_preferences,
                apps::launch_app,
                apps::launch_app_action,
                apps::app_request,
                apps::app_chat,
            ];
            handler(invoke)
        })
        .build(tauri::generate_context!())
        .expect("Avvio Orbit non riuscito")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Err(error) = window_geometry::flush(app) {
                    eprintln!("{error}");
                }
            }
        });
}

fn tray_pixels() -> Vec<u8> {
    let mut pixels = vec![0; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let dx = x as f32 - 15.5;
            let dy = y as f32 - 15.5;
            let radius = (dx * dx + dy * dy).sqrt();
            if (9.0..12.0).contains(&radius)
                || (dx * dx / 210.0 + dy * dy / 30.0 - 1.0).abs() < 0.23
            {
                let offset = (y * 32 + x) * 4;
                pixels[offset..offset + 4].copy_from_slice(&[199, 174, 250, 255]);
            }
        }
    }
    pixels
}

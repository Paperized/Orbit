use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Light,
    Dark,
    #[default]
    System,
}

pub struct Appearance(pub Mutex<ThemeMode>);

pub fn read(path: &Path) -> Result<ThemeMode, String> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("Tema salvato non valido: {e}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ThemeMode::System),
        Err(error) => Err(format!("Impossibile leggere il tema: {error}")),
    }
}

#[tauri::command]
pub fn get_theme(app: AppHandle) -> Result<ThemeMode, String> {
    Ok(*app
        .state::<Appearance>()
        .0
        .lock()
        .map_err(|_| "Tema non disponibile.")?)
}

pub fn initialization(mode: ThemeMode) -> Result<String, String> {
    Ok(format!(
        "window.__ORBIT_THEME_MODE__={};{}",
        serde_json::to_string(&mode).map_err(|e| e.to_string())?,
        include_str!("../../shared/appearance.js")
    ))
}

#[tauri::command]
pub fn set_theme(app: AppHandle, mode: ThemeMode) -> Result<(), String> {
    let appearance = app.state::<Appearance>();
    let mut current = appearance.0.lock().map_err(|_| "Tema non disponibile.")?;
    let directory = app.state::<crate::data_paths::DataPaths>().host.clone();
    fs::create_dir_all(&directory).map_err(|e| format!("Salvataggio tema: {e}"))?;
    let temp = directory.join("appearance.tmp");
    fs::write(&temp, serde_json::to_vec(&mode).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Salvataggio tema: {e}"))?;
    fs::rename(temp, directory.join("appearance.json"))
        .map_err(|e| format!("Conferma tema: {e}"))?;
    *current = mode;
    let script = format!(
        "window.dispatchEvent(new CustomEvent('orbit:theme',{{detail:{}}}))",
        serde_json::to_string(&mode).map_err(|e| e.to_string())?
    );
    let mut errors = Vec::new();
    for window in app.webview_windows().values() {
        if let Err(error) = window.eval(&script) {
            errors.push(format!("{}: {error}", window.label()));
        }
    }
    if !errors.is_empty() {
        return Err(format!(
            "Tema salvato, ma alcune finestre non sono state aggiornate: {}",
            errors.join("; ")
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_defaults_and_validates_persisted_modes() {
        let path = std::env::temp_dir().join(format!("orbit-theme-{}.json", std::process::id()));
        assert_eq!(read(&path).unwrap(), ThemeMode::System);
        for mode in [ThemeMode::Light, ThemeMode::Dark, ThemeMode::System] {
            fs::write(&path, serde_json::to_vec(&mode).unwrap()).unwrap();
            assert_eq!(read(&path).unwrap(), mode);
        }
        fs::write(&path, b"\"unsupported\"").unwrap();
        assert!(read(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}

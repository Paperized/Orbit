use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum Locale {
    #[default]
    #[serde(rename = "it")]
    Italian,
    #[serde(rename = "en")]
    English,
}
pub struct Language(pub Mutex<Locale>);

pub fn read(path: &Path) -> Result<Locale, String> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("Lingua salvata non valida: {e}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Locale::Italian),
        Err(error) => Err(format!("Lettura lingua: {error}")),
    }
}
#[tauri::command]
pub fn get_locale(app: AppHandle) -> Result<Locale, String> {
    Ok(*app
        .state::<Language>()
        .0
        .lock()
        .map_err(|_| "Lingua non disponibile.")?)
}
pub fn initialization(locale: Locale) -> Result<String, String> {
    Ok(format!(
        "window.__ORBIT_LOCALE__={};{}",
        serde_json::to_string(&locale).map_err(|e| e.to_string())?,
        include_str!("../../shared/locale.js")
    ))
}
#[tauri::command]
pub fn set_locale(app: AppHandle, locale: Locale) -> Result<(), String> {
    let state = app.state::<Language>();
    let mut current = state.0.lock().map_err(|_| "Lingua non disponibile.")?;
    let directory = &app.state::<crate::data_paths::DataPaths>().host;
    let temp = directory.join("language.tmp");
    fs::write(
        &temp,
        serde_json::to_vec(&locale).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Salvataggio lingua: {e}"))?;
    fs::rename(temp, directory.join("language.json"))
        .map_err(|e| format!("Conferma lingua: {e}"))?;
    *current = locale;
    let script = format!(
        "window.dispatchEvent(new CustomEvent('orbit:locale',{{detail:{}}}))",
        serde_json::to_string(&locale).map_err(|e| e.to_string())?
    );
    let mut errors = Vec::new();
    for window in app.webview_windows().values() {
        if let Err(error) = window.eval(&script) {
            errors.push(format!("{}: {error}", window.label()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Lingua salvata, ma alcune finestre non sono state aggiornate: {}",
            errors.join("; ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn language_defaults_and_validates_saved_values() {
        let path = std::env::temp_dir().join(format!("orbit-locale-{}.json", uuid::Uuid::new_v4()));
        assert_eq!(read(&path).unwrap(), Locale::Italian);
        for locale in [Locale::Italian, Locale::English] {
            fs::write(&path, serde_json::to_vec(&locale).unwrap()).unwrap();
            assert_eq!(read(&path).unwrap(), locale);
        }
        fs::write(&path, b"\"unsupported\"").unwrap();
        assert!(read(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}

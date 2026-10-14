use crate::{protocol::Settings, AppState};
use serde::Serialize;
#[cfg(any(target_os = "windows", target_os = "macos", test))]
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tauri::{AppHandle, Manager, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsStatus {
    settings: Settings,
    has_key: bool,
}

pub fn read(path: &Path) -> Result<Settings, String> {
    match fs::read(path) {
        Ok(data) => serde_json::from_slice::<Settings>(&data)
            .map_err(|e| format!("Impostazioni non leggibili: {e}"))?
            .normalize(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(format!("Impossibile leggere le impostazioni: {error}")),
    }
}

#[cfg(any(target_os = "windows", target_os = "macos", test))]
pub fn account(settings: &Settings) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{:?}|{}", settings.provider, settings.base_url))
    )
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn entry(settings: &Settings) -> Result<keyring::Entry, String> {
    keyring::Entry::new("dev.orbit.overlay", &account(settings))
        .map_err(|e| format!("Portachiavi non disponibile: {e}"))
}

pub fn get_key(settings: &Settings) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        match entry(settings)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("Impossibile leggere il portachiavi: {error}")),
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = settings;
        Ok(None)
    }
}

fn set_key(settings: &Settings, key: Option<&str>, delete: bool) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        if delete {
            match entry(settings)?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(error) => return Err(format!("Impossibile eliminare la chiave: {error}")),
            }
        } else if let Some(key) = key {
            entry(settings)?
                .set_password(key)
                .map_err(|e| format!("Impossibile salvare la chiave: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = (settings, key, delete);
        Err("Il salvataggio credenziali e supportato solo su Windows e macOS.".into())
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<SettingsStatus, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Stato impostazioni non disponibile.")?
        .clone();
    Ok(SettingsStatus {
        has_key: get_key(&settings)?.is_some(),
        settings,
    })
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
    api_key: Option<String>,
    delete_key: bool,
) -> Result<SettingsStatus, String> {
    let settings = settings.normalize()?;
    let mut stored = state
        .settings
        .lock()
        .map_err(|_| "Stato impostazioni non disponibile.")?;
    let key = api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty());
    if delete_key && key.is_some() {
        return Err(
            "Scegli se eliminare o sostituire la chiave, non entrambe le operazioni.".into(),
        );
    }
    if key.is_some_and(|key| key.len() > 4096 || key.contains(['\n', '\r'])) {
        return Err("API key non valida.".into());
    }
    let directory = app.state::<crate::data_paths::DataPaths>().host.clone();
    fs::create_dir_all(&directory)
        .map_err(|e| format!("Creazione directory impostazioni non riuscita: {e}"))?;
    let path = directory.join("settings.json");
    let temp = directory.join("settings.tmp");
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&temp, bytes).map_err(|e| format!("Salvataggio impostazioni non riuscito: {e}"))?;
    if key.is_some() || delete_key {
        set_key(&settings, key, delete_key)?;
    }
    fs::rename(&temp, &path).map_err(|e| format!("Conferma impostazioni non riuscita: {e}"))?;
    *stored = settings.clone();
    Ok(SettingsStatus {
        has_key: get_key(&settings)?.is_some(),
        settings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Provider;

    #[test]
    fn keys_are_scoped_to_provider_and_endpoint() {
        let a = Settings::default();
        let b = Settings {
            provider: Provider::Compatible,
            ..a.clone()
        };
        let c = Settings {
            base_url: "https://different.example/v1".into(),
            ..b.clone()
        };
        assert_ne!(account(&a), account(&b));
        assert_ne!(account(&b), account(&c));
        assert_eq!(account(&a).len(), 64);
    }
}

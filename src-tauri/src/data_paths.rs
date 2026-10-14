use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub struct DataPaths {
    pub root: PathBuf,
    pub host: PathBuf,
    pub apps: PathBuf,
    pub webview: PathBuf,
}

pub fn reject_link(path: &Path) -> Result<fs::Metadata, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("Accesso {}: {e}", path.display()))?;
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let linked = metadata.file_type().is_symlink();
    if linked {
        return Err(format!(
            "Collegamenti filesystem non consentiti: {}",
            path.display()
        ));
    }
    Ok(metadata)
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = reject_link(source)?;
    if destination.exists() {
        return Err(format!(
            "Migrazione: destinazione gia presente: {}",
            destination.display()
        ));
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|e| format!("Migrazione: {e}"))?;
        for entry in fs::read_dir(source).map_err(|e| format!("Migrazione: {e}"))? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_tree(&entry.path(), &destination.join(entry.file_name()))?;
        }
    } else if metadata.is_file() {
        fs::copy(source, destination)
            .map_err(|e| format!("Migrazione {}: {e}", source.display()))?;
        if fs::metadata(destination).map_err(|e| e.to_string())?.len() != metadata.len() {
            return Err("Migrazione incompleta: dimensione del file diversa.".into());
        }
    } else {
        return Err(format!("Tipo di file non migrabile: {}", source.display()));
    }
    Ok(())
}

impl DataPaths {
    pub fn initialize(root: PathBuf, legacy: &Path, legacy_webview: &Path) -> Result<Self, String> {
        let host = root.join("host");
        let apps = root.join("apps");
        let webview = root.join("runtime").join("webview");
        fs::create_dir_all(&root)
            .map_err(|e| format!("Cartella dati Orbit non disponibile: {e}"))?;
        reject_link(&root)?;
        let complete = root.join(".migration-complete");
        if !complete.exists() {
            let stage = root.join(".migration");
            let ready = stage.join(".ready");
            if stage.exists() && !ready.exists() {
                reject_link(&stage)?;
                fs::rename(
                    &stage,
                    root.join(format!(".migration-interrupted-{}", uuid::Uuid::new_v4())),
                )
                .map_err(|e| format!("Conservazione migrazione interrotta: {e}"))?;
            }
            if !ready.exists() {
                for name in ["host", "apps", "runtime"] {
                    if root.join(name).exists() {
                        return Err(format!(
                            "Migrazione: {} esiste gia; nessun dato sovrascritto.",
                            root.join(name).display()
                        ));
                    }
                }
                fs::create_dir(&stage).map_err(|e| e.to_string())?;
                let staged_host = stage.join("host");
                fs::create_dir(&staged_host).map_err(|e| e.to_string())?;
                for file in ["settings.json", "appearance.json"] {
                    let source = legacy.join(file);
                    if source.exists() {
                        copy_tree(&source, &staged_host.join(file))?;
                    }
                }
                if legacy.join("apps").exists() {
                    copy_tree(&legacy.join("apps"), &stage.join("apps"))?;
                } else {
                    fs::create_dir(stage.join("apps")).map_err(|e| e.to_string())?;
                }
                fs::create_dir(stage.join("runtime")).map_err(|e| e.to_string())?;
                if legacy_webview.exists() {
                    copy_tree(legacy_webview, &stage.join("runtime/webview"))?;
                } else {
                    fs::create_dir(stage.join("runtime/webview")).map_err(|e| e.to_string())?;
                }
                fs::write(&ready, b"1").map_err(|e| format!("Preparazione migrazione: {e}"))?;
            }
            for name in ["host", "apps", "runtime"] {
                if !stage.join(name).exists() && root.join(name).is_dir() {
                    reject_link(&root.join(name))?;
                    continue;
                }
                if root.join(name).exists() {
                    return Err(format!(
                        "Migrazione: {} esiste gia.",
                        root.join(name).display()
                    ));
                }
                reject_link(&stage.join(name))?;
                fs::rename(stage.join(name), root.join(name))
                    .map_err(|e| format!("Conferma migrazione: {e}"))?;
            }
            fs::write(&complete, b"1").map_err(|e| format!("Conferma migrazione: {e}"))?;
            fs::remove_file(ready).map_err(|e| format!("Pulizia migrazione: {e}"))?;
            fs::remove_dir(stage).map_err(|e| format!("Pulizia migrazione: {e}"))?;
        }
        for directory in [&host, &apps, &webview] {
            fs::create_dir_all(directory).map_err(|e| e.to_string())?;
            reject_link(directory)?;
        }
        Ok(Self {
            root,
            host,
            apps,
            webview,
        })
    }
}

pub fn initialize(app: &AppHandle) -> Result<DataPaths, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|e| format!("Cartella Documenti non disponibile: {e}"))?;
    let folder = if app.config().identifier == "dev.orbit.overlay" {
        "Orbit".to_string()
    } else {
        format!("Orbit-{}", app.config().identifier)
    };
    DataPaths::initialize(
        documents.join(folder),
        &app.path().app_config_dir().map_err(|e| e.to_string())?,
        &app.path().app_local_data_dir().map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
pub fn data_location(app: AppHandle) -> String {
    app.state::<DataPaths>().root.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn get_home_layout(app: AppHandle) -> Result<Option<String>, String> {
    let path = app.state::<DataPaths>().host.join("home.json");
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Lettura layout: {error}")),
    }
}

#[tauri::command]
pub fn save_home_layout(app: AppHandle, source: String) -> Result<(), String> {
    if source.len() > 128 * 1024 {
        return Err("Layout troppo grande.".into());
    }
    let _: serde_json::Value =
        serde_json::from_str(&source).map_err(|e| format!("Layout non valido: {e}"))?;
    let directory = app.state::<DataPaths>().host.clone();
    let temp = directory.join(format!("home-{}.tmp", uuid::Uuid::new_v4()));
    fs::write(&temp, source).map_err(|e| format!("Salvataggio layout: {e}"))?;
    fs::rename(temp, directory.join("home.json")).map_err(|e| format!("Conferma layout: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_retries_partial_copy_and_resumes_partial_commit() {
        let base = std::env::temp_dir().join(format!("orbit-migration-{}", uuid::Uuid::new_v4()));
        let root = base.join("new");
        let stage = root.join(".migration");
        fs::create_dir_all(stage.join("host")).unwrap();
        fs::write(stage.join("host/incomplete"), b"partial").unwrap();
        let old = base.join("old");
        fs::create_dir_all(old.join("EBWebView")).unwrap();
        fs::write(old.join("EBWebView/profile"), b"saved").unwrap();
        let paths = DataPaths::initialize(root.clone(), &old, &old).unwrap();
        assert_eq!(
            fs::read(paths.webview.join("EBWebView/profile")).unwrap(),
            b"saved"
        );
        assert!(fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".migration-interrupted-")));
        fs::remove_file(root.join(".migration-complete")).unwrap();
        fs::create_dir(&stage).unwrap();
        fs::rename(root.join("apps"), stage.join("apps")).unwrap();
        fs::rename(root.join("runtime"), stage.join("runtime")).unwrap();
        fs::write(stage.join(".ready"), b"1").unwrap();
        DataPaths::initialize(root.clone(), &old, &old).unwrap();
        assert!(!stage.exists());
        assert_eq!(
            fs::read(paths.webview.join("EBWebView/profile")).unwrap(),
            b"saved"
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn migration_preserves_legacy_and_does_not_overwrite_new_data() {
        let base = std::env::temp_dir().join(format!("orbit-migration-{}", uuid::Uuid::new_v4()));
        let old = base.join("old");
        fs::create_dir_all(old.join("apps/data/example")).unwrap();
        fs::write(
            old.join("apps/data/example/storage.json"),
            b"{\"note\":\"kept\"}",
        )
        .unwrap();
        fs::write(old.join("settings.json"), b"{}").unwrap();
        let paths = DataPaths::initialize(base.join("new"), &old, &base.join("absent")).unwrap();
        assert_eq!(
            fs::read(paths.apps.join("data/example/storage.json")).unwrap(),
            b"{\"note\":\"kept\"}"
        );
        assert!(old.join("settings.json").exists());
        fs::write(paths.host.join("settings.json"), b"{\"new\":true}").unwrap();
        DataPaths::initialize(paths.root.clone(), &old, &base.join("absent")).unwrap();
        assert_eq!(
            fs::read(paths.host.join("settings.json")).unwrap(),
            b"{\"new\":true}"
        );
        fs::remove_dir_all(base).unwrap();
    }
}

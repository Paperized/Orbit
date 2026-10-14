use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_FILE: u64 = 16 * 1024 * 1024;
const MAX_APP: u64 = 256 * 1024 * 1024;

pub(crate) fn components(path: &str, allow_empty: bool) -> Result<Vec<&str>, String> {
    if path.is_empty() && allow_empty {
        return Ok(Vec::new());
    }
    if path.len() > 1024 {
        return Err("Percorso troppo lungo.".into());
    }
    let parts: Vec<_> = path.split('/').collect();
    for part in &parts {
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || *part == "."
            || *part == ".."
            || part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
            || ["CON", "PRN", "AUX", "NUL"].contains(&base.as_str())
            || (base.len() == 4
                && (base.starts_with("COM") || base.starts_with("LPT"))
                && matches!(base.as_bytes()[3], b'1'..=b'9'))
        {
            return Err("Usa un percorso relativo nella cartella dell'app, senza '..', volumi o nomi riservati.".into());
        }
    }
    Ok(parts)
}

fn directory(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            directory(parent)?;
        }
    }
    match fs::symlink_metadata(path) {
        Ok(_) => {
            if !crate::data_paths::reject_link(path)?.is_dir() {
                return Err("Il percorso non e una cartella.".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|e| format!("Creazione cartella: {e}"))?;
        }
        Err(error) => return Err(format!("Accesso cartella: {error}")),
    }
    Ok(())
}

pub(crate) fn own_path(
    root: &Path,
    path: &str,
    create: bool,
    allow_empty: bool,
) -> Result<PathBuf, String> {
    let parts = components(path, allow_empty)?;
    if create {
        directory(root)?;
    } else {
        for parent in root.ancestors() {
            crate::data_paths::reject_link(parent)?;
        }
    }
    let mut target = root.to_path_buf();
    for (index, part) in parts.iter().enumerate() {
        target.push(part);
        if create && index + 1 < parts.len() {
            directory(&target)?;
        }
        match fs::symlink_metadata(&target) {
            Ok(_) => {
                crate::data_paths::reject_link(&target)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Accesso file: {error}")),
        }
    }
    Ok(target)
}

fn usage(path: &Path) -> Result<u64, String> {
    let metadata = crate::data_paths::reject_link(path)?;
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Err("Tipo di file non supportato.".into());
    }
    let mut total = 0u64;
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        total = total.saturating_add(usage(&entry.map_err(|e| e.to_string())?.path())?);
    }
    Ok(total)
}

pub fn write(root: &Path, path: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_FILE {
        return Err("File troppo grande (massimo 16 MiB).".into());
    }
    let target = own_path(root, path, true, false)?;
    let previous = match fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_file() => metadata.len(),
        Ok(_) => return Err("La destinazione non e un file.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.to_string()),
    };
    if usage(root)?
        .saturating_sub(previous)
        .saturating_add(bytes.len() as u64)
        > MAX_APP
    {
        return Err("Quota file della sotto-app superata (256 MiB).".into());
    }
    let temp = target.with_file_name(format!(".orbit-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, &target).map_err(|e| e.to_string())
    })();
    if result.is_err() && temp.exists() {
        fs::remove_file(&temp)
            .map_err(|e| format!("Salvataggio fallito; pulizia temporaneo: {e}"))?;
    }
    result.map_err(|e| format!("Scrittura file: {e}"))
}

fn read_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    if Path::new(path).is_absolute() {
        Ok(PathBuf::from(path))
    } else {
        Ok(root.join(components(path, true)?.join("/")))
    }
}

pub fn request(root: &Path, action: &str, args: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Input {
        path: String,
        #[serde(default)]
        base64: Option<String>,
    }
    let input: Input =
        serde_json::from_value(args).map_err(|e| format!("Argomenti file non validi: {e}"))?;
    match action {
        "files.write" => {
            let encoded = input.base64.ok_or("Contenuto base64 richiesto.")?;
            if encoded.len() as u64 > MAX_FILE.div_ceil(3) * 4 {
                return Err("File troppo grande.".into());
            }
            let bytes = STANDARD.decode(encoded).map_err(|_| "Base64 non valido.")?;
            write(root, &input.path, &bytes)?;
            Ok(json!({"path":input.path,"bytes":bytes.len()}))
        }
        "files.read" => {
            let path = read_path(root, &input.path)?;
            if !fs::metadata(&path)
                .map_err(|e| format!("Lettura file: {e}"))?
                .is_file()
            {
                return Err("Serve un file regolare.".into());
            }
            let file = fs::File::open(path).map_err(|e| format!("Lettura file: {e}"))?;
            let metadata = file.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() || metadata.len() > MAX_FILE {
                return Err("Serve un file regolare di massimo 16 MiB.".into());
            }
            let mut bytes = Vec::new();
            file.take(MAX_FILE + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| format!("Lettura file: {e}"))?;
            if bytes.len() as u64 > MAX_FILE {
                return Err("File troppo grande.".into());
            }
            Ok(json!({"base64":STANDARD.encode(bytes)}))
        }
        "files.list" => {
            let path = read_path(root, &input.path)?;
            if input.path.is_empty() && !path.exists() {
                return Ok(json!([]));
            }
            let mut entries = Vec::new();
            for entry in fs::read_dir(path).map_err(|e| format!("Lettura cartella: {e}"))? {
                if entries.len() >= 2000 {
                    return Err("Cartella troppo grande (massimo 2000 elementi).".into());
                }
                let entry = entry.map_err(|e| e.to_string())?;
                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_| "Nome file non Unicode.")?;
                let modified_ms = metadata
                    .modified()
                    .map_err(|e| e.to_string())?
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_millis();
                entries.push(
                    json!({"name":name,"directory":metadata.is_dir(),"bytes":metadata.len(),"modifiedMs":modified_ms}),
                );
            }
            entries.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
            Ok(json!(entries))
        }
        "files.remove" => {
            let target = own_path(root, &input.path, false, false)?;
            if !crate::data_paths::reject_link(&target)?.is_file() {
                return Err("Si possono eliminare solo file, non cartelle.".into());
            }
            fs::remove_file(target).map_err(|e| format!("Eliminazione file: {e}"))?;
            Ok(Value::Null)
        }
        _ => Err("Operazione file sconosciuta.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_external_files_but_only_writes_and_removes_inside_own_directory() {
        let base = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("orbit-files-{}", uuid::Uuid::new_v4()));
        let root = base.join("app/files");
        write(&root, "screenshots/hello.txt", b"hello").unwrap();
        assert_eq!(
            request(&root, "files.read", json!({"path":"screenshots/hello.txt"})).unwrap()
                ["base64"],
            STANDARD.encode(b"hello")
        );
        fs::write(base.join("external.txt"), b"outside").unwrap();
        assert_eq!(
            request(
                &root,
                "files.read",
                json!({"path":base.join("external.txt")})
            )
            .unwrap()["base64"],
            STANDARD.encode(b"outside")
        );
        for path in [
            "../other.txt",
            "/outside",
            "C:\\outside",
            "C:outside",
            "a/../../b",
            "NUL.txt",
            "x:stream",
            "a//b",
            "a/.",
            "a\\b",
        ] {
            assert!(write(&root, path, b"no").is_err(), "{path}");
            assert!(
                request(&root, "files.remove", json!({"path":path})).is_err(),
                "{path}"
            );
        }
        assert_eq!(
            request(&root, "files.list", json!({"path":"screenshots"})).unwrap()[0]["name"],
            "hello.txt"
        );
        assert!(
            request(&root, "files.list", json!({"path":"screenshots"})).unwrap()[0]["modifiedMs"]
                .as_u64()
                .unwrap()
                > 0
        );
        write(&root, "screenshots/hello.txt", b"updated").unwrap();
        assert_eq!(
            fs::read(root.join("screenshots/hello.txt")).unwrap(),
            b"updated"
        );
        assert!(request(
            &root,
            "files.write",
            json!({"path":"invalid.txt","base64":"not base64"})
        )
        .is_err());
        assert!(!root.join("invalid.txt").exists());
        request(
            &root,
            "files.remove",
            json!({"path":"screenshots/hello.txt"}),
        )
        .unwrap();
        assert!(base.join("external.txt").exists());
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn writes_reject_symlink_ancestors_and_leaf_files() {
        let base = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("orbit-links-{}", uuid::Uuid::new_v4()));
        let root = base.join("app");
        fs::create_dir_all(&root).unwrap();
        write(&root, "safe.txt", b"safe").unwrap();
        fs::create_dir(base.join("outside")).unwrap();
        std::os::unix::fs::symlink(base.join("outside"), root.join("link")).unwrap();
        assert!(write(&root, "link/no.txt", b"no").is_err());
        assert!(!base.join("outside/no.txt").exists());
        let external = base.join("outside/protected.txt");
        fs::write(&external, b"outside").unwrap();
        std::os::unix::fs::symlink(&external, root.join("leaf.txt")).unwrap();
        assert!(write(&root, "leaf.txt", b"no").is_err());
        assert!(request(&root, "files.remove", json!({"path":"leaf.txt"})).is_err());
        assert_eq!(fs::read(&external).unwrap(), b"outside");
        fs::remove_dir_all(base).unwrap();
    }
}

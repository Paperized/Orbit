use crate::{
    apps::Runtime,
    files,
    packages::{identifier, Manifest, Permission, Store},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Declaration {
    pub id: String,
    pub title: String,
    pub description: String,
    pub width: u8,
    pub height: u8,
    pub source: Source,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<Grid>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Grid {
    pub rows: usize,
    pub columns: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Source {
    RecentImages { path: String, limit: usize },
}

pub fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    let mut ids = BTreeSet::new();
    if manifest.widgets.len() > 8 {
        return Err("Massimo 8 widget per app.".into());
    }
    for widget in &manifest.widgets {
        let Source::RecentImages { path, limit } = &widget.source;
        if !identifier(&widget.id)
            || !ids.insert(&widget.id)
            || widget.title.trim().is_empty()
            || widget.title.len() > 80
            || widget.description.len() > 400
            || !(1..=2).contains(&widget.width)
            || !(1..=2).contains(&widget.height)
            || !(1..=36).contains(limit)
            || widget.grid.as_ref().is_some_and(|grid| {
                !(1..=6).contains(&grid.rows)
                    || !(1..=6).contains(&grid.columns)
                    || grid.rows * grid.columns > *limit
            })
            || files::components(path, true).is_err()
            || std::path::Path::new(path).is_absolute()
            || !manifest.permissions.contains(&Permission::FilesRead)
            || widget.actions.len() > 3
            || widget.actions.iter().collect::<BTreeSet<_>>().len() != widget.actions.len()
            || widget
                .actions
                .iter()
                .any(|id| id != "open" && !manifest.actions.iter().any(|a| &a.id == id))
        {
            return Err(
                "Widget non valido: ID, dimensioni, sorgente locale, permesso files-read o azioni."
                    .into(),
            );
        }
    }
    Ok(())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    data_url: String,
}
#[derive(Serialize)]
pub struct Content {
    entries: Vec<Entry>,
    warning: Option<String>,
}

struct Cached {
    path: PathBuf,
    modified: SystemTime,
    bytes: u64,
    image: String,
}
static CACHE: OnceLock<Mutex<Vec<Cached>>> = OnceLock::new();

fn decode_png(path: &Path) -> Result<(Vec<u8>, image::DynamicImage), String> {
    let metadata = crate::data_paths::reject_link(path)?;
    if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
        return Err("PNG troppo grande.".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("PNG troppo grande.".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|e| e.to_string())?;
    Ok((bytes, decoded))
}

fn thumbnail(path: PathBuf) -> Result<String, String> {
    let metadata = crate::data_paths::reject_link(&path)?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
        return Err("PNG troppo grande.".into());
    }
    let cache = CACHE.get_or_init(|| Mutex::new(Vec::new()));
    if let Some(entry) = cache
        .lock()
        .map_err(|_| "Cache occupata.")?
        .iter()
        .find(|e| e.path == path && e.modified == modified && e.bytes == metadata.len())
    {
        return Ok(entry.image.clone());
    }
    let (_, decoded) = decode_png(&path)?;
    let image = decoded.thumbnail(240, 140);
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    if png.get_ref().len() > 160 * 1024 {
        return Err("Anteprima troppo grande.".into());
    }
    let image = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png.into_inner())
    );
    let mut cache = cache.lock().map_err(|_| "Cache occupata.")?;
    cache.retain(|entry| entry.path != path);
    if cache.len() >= 96 {
        cache.remove(0);
    }
    cache.push(Cached {
        path,
        modified,
        bytes: metadata.len(),
        image: image.clone(),
    });
    Ok(image)
}

pub fn read(store: &Store, app_id: &str, widget_id: &str) -> Result<Content, String> {
    read_with_limit(store, app_id, widget_id, None)
}

fn declaration<'a>(
    store: &'a Store,
    app_id: &str,
    widget_id: &str,
) -> Result<&'a Declaration, String> {
    store.authorize(&format!("app-{app_id}"), Some(Permission::FilesRead))?;
    if !crate::contracts::ready(app_id, &store.installed) {
        return Err("Dipendenze mancanti.".into());
    }
    let manifest = &store
        .installed
        .get(app_id)
        .ok_or("App non disponibile.")?
        .manifest;
    validate_manifest(manifest)?;
    manifest
        .widgets
        .iter()
        .find(|w| w.id == widget_id)
        .ok_or_else(|| "Widget non disponibile. Ripristina l'app o rimuovi il widget.".into())
}

fn preview_image(
    store: &Store,
    app_id: &str,
    widget_id: &str,
    name: &str,
) -> Result<String, String> {
    let declaration = declaration(store, app_id, widget_id)?;
    if files::components(name, false)?.len() != 1 || !name.to_ascii_lowercase().ends_with(".png") {
        return Err("Nome immagine widget non valido.".into());
    }
    let Source::RecentImages { path, .. } = &declaration.source;
    let root = store.root.join("data").join(app_id).join("files");
    let relative = if path.is_empty() {
        name.to_owned()
    } else {
        format!("{path}/{name}")
    };
    let target = files::own_path(&root, &relative, false, false)?;
    let (bytes, _) = decode_png(&target)?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

fn read_with_limit(
    store: &Store,
    app_id: &str,
    widget_id: &str,
    requested: Option<usize>,
) -> Result<Content, String> {
    if requested.is_some_and(|limit| !(1..=36).contains(&limit)) {
        return Err("Numero di anteprime non valido (1-36).".into());
    }
    let declaration = declaration(store, app_id, widget_id)?;
    let Source::RecentImages { path, limit } = &declaration.source;
    let limit = requested
        .or_else(|| {
            declaration
                .grid
                .as_ref()
                .map(|grid| grid.rows * grid.columns)
        })
        .unwrap_or(*limit)
        .min(*limit);
    let root = store.root.join("data").join(app_id).join("files");
    // Unlike general SDK file reads, widget sources are always confined to their own app.
    if !root.exists() {
        return Ok(Content {
            entries: Vec::new(),
            warning: None,
        });
    }
    let folder = files::own_path(&root, path, false, true)?;
    if !folder.exists() {
        return Ok(Content {
            entries: Vec::new(),
            warning: None,
        });
    }
    let mut candidates = Vec::new();
    let mut skipped = false;
    for (index, entry) in fs::read_dir(folder)
        .map_err(|e| format!("Lettura widget: {e}"))?
        .enumerate()
    {
        if index >= 2000 {
            return Err("Cartella widget troppo grande (2000 elementi).".into());
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Nome file non Unicode.")?;
        if !name.to_ascii_lowercase().ends_with(".png") {
            continue;
        }
        let metadata = crate::data_paths::reject_link(&entry.path())?;
        if !metadata.is_file() {
            continue;
        }
        if name.len() > 240 {
            skipped = true;
            continue;
        }
        candidates.push((
            metadata.modified().map_err(|e| e.to_string())?,
            name,
            entry.path(),
        ));
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    let mut entries = Vec::new();
    for (_, name, path) in candidates.into_iter().take(limit) {
        match thumbnail(path) {
            Ok(data_url) => entries.push(Entry { name, data_url }),
            Err(_) => skipped = true,
        }
    }
    Ok(Content {
        entries,
        warning: skipped.then(|| {
            "Alcune immagini non sono leggibili o superano i limiti delle anteprime.".into()
        }),
    })
}

#[tauri::command]
pub async fn get_widget_image(
    app: AppHandle,
    app_id: String,
    widget_id: String,
    name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        preview_image(&store, &app_id, &widget_id, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_widget_data(
    app: AppHandle,
    app_id: String,
    widget_id: String,
    limit: Option<usize>,
) -> Result<Content, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Runtime>();
        let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        match limit {
            Some(limit) => read_with_limit(&store, &app_id, &widget_id, Some(limit)),
            None => read(&store, &app_id, &widget_id),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn package() -> serde_json::Value {
        serde_json::from_str(crate::apps::STARTERS[0]).unwrap()
    }
    #[test]
    fn validates_widget_declarations_and_rejects_external_sources_and_actions() {
        let source = package();
        assert!(crate::packages::decode(&source.to_string()).is_ok());
        for (key, value) in [
            ("id", json!("../foreign")),
            ("width", json!(0)),
            ("height", json!(3)),
            ("actions", json!(["undeclared"])),
            ("actions", json!(["open", "open"])),
            (
                "source",
                json!({"type":"recent-images","path":"../other/files","limit":4}),
            ),
            (
                "source",
                json!({"type":"recent-images","path":"/etc","limit":4}),
            ),
            (
                "source",
                json!({"type":"recent-images","path":"C:\\Users","limit":4}),
            ),
            (
                "source",
                json!({"type":"recent-images","path":"screenshots","limit":37}),
            ),
            ("grid", json!({"rows":0,"columns":2})),
            ("grid", json!({"rows":2,"columns":7})),
            ("grid", json!({"rows":1.5,"columns":2})),
            ("grid", json!({"rows":2,"columns":2,"foreign":true})),
            ("source", json!({"type":"html","entry":"widget.html"})),
        ] {
            let mut invalid = source.clone();
            invalid["manifest"]["widgets"][0][key] = value;
            assert!(
                crate::packages::decode(&invalid.to_string()).is_err(),
                "{key}"
            );
        }
        let mut invalid = source.clone();
        invalid["manifest"]["permissions"] = json!([]);
        assert!(crate::packages::decode(&invalid.to_string()).is_err());
        let mut duplicate = source;
        let widget = duplicate["manifest"]["widgets"][0].clone();
        duplicate["manifest"]["widgets"]
            .as_array_mut()
            .unwrap()
            .push(widget);
        assert!(crate::packages::decode(&duplicate.to_string()).is_err());
    }
    #[test]
    fn requested_grid_counts_are_bounded_by_the_host_and_manifest() {
        let base = std::env::current_dir()
            .unwrap()
            .join(format!(".widget-grid-test-{}", uuid::Uuid::new_v4()));
        let mut store = Store::load(base.clone()).unwrap();
        let mut source = package();
        source["manifest"]["widgets"][0]["source"]["limit"] = json!(6);
        let source = source.to_string();
        let (_, digest) = crate::packages::decode(&source).unwrap();
        store.install(&source, &digest).unwrap();
        let root = base.join("data/orbit-capture/files");
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        for index in 0..8 {
            files::write(&root, &format!("screenshots/{index}.png"), png.get_ref()).unwrap();
        }
        assert_eq!(
            read(&store, "orbit-capture", "recent-captures")
                .unwrap()
                .entries
                .len(),
            4
        );
        for (requested, expected) in [(1, 1), (3, 3), (6, 6), (36, 6)] {
            assert_eq!(
                read_with_limit(&store, "orbit-capture", "recent-captures", Some(requested))
                    .unwrap()
                    .entries
                    .len(),
                expected
            );
        }
        for invalid in [0, 37, usize::MAX] {
            assert!(
                read_with_limit(&store, "orbit-capture", "recent-captures", Some(invalid)).is_err()
            );
        }
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn actual_pngs_are_bounded_sorted_cached_and_removed_without_app_sessions() {
        let base = std::env::current_dir()
            .unwrap()
            .join(format!(".widget-test-{}", uuid::Uuid::new_v4()));
        let mut store = Store::load(base.clone()).unwrap();
        let source = package().to_string();
        let (_, digest) = crate::packages::decode(&source).unwrap();
        store.install(&source, &digest).unwrap();
        let root = base.join("data/orbit-capture/files");
        assert!(read(&store, "orbit-capture", "recent-captures")
            .unwrap()
            .entries
            .is_empty());
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1800, 900)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        files::write(&root, "screenshots/first.png", png.get_ref()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        files::write(&root, "screenshots/second.png", png.get_ref()).unwrap();
        let content = read(&store, "orbit-capture", "recent-captures").unwrap();
        assert_eq!(
            content
                .entries
                .iter()
                .map(|e| e.name.as_str())
                .collect::<Vec<_>>(),
            ["second.png", "first.png"]
        );
        let bytes = STANDARD
            .decode(content.entries[0].data_url.split(',').nth(1).unwrap())
            .unwrap();
        let thumbnail = image::load_from_memory(&bytes).unwrap();
        assert_eq!((thumbnail.width(), thumbnail.height()), (240, 120));
        assert!(bytes.len() <= 160 * 1024);
        let original =
            preview_image(&store, "orbit-capture", "recent-captures", "second.png").unwrap();
        let full = STANDARD
            .decode(original.split(',').nth(1).unwrap())
            .unwrap();
        assert_eq!(full, *png.get_ref());
        for name in [
            "../second.png",
            "sub/second.png",
            "missing.png",
            "/second.png",
            "other.txt",
        ] {
            assert!(preview_image(&store, "orbit-capture", "recent-captures", name).is_err());
        }
        assert_eq!(
            read(&store, "orbit-capture", "recent-captures")
                .unwrap()
                .entries[0]
                .data_url,
            content.entries[0].data_url
        );
        files::request(
            &root,
            "files.remove",
            json!({"path":"screenshots/second.png"}),
        )
        .unwrap();
        assert_eq!(
            read(&store, "orbit-capture", "recent-captures")
                .unwrap()
                .entries
                .len(),
            1
        );
        files::write(&root, "screenshots/broken.png", b"not a PNG").unwrap();
        assert!(read(&store, "orbit-capture", "recent-captures")
            .unwrap()
            .warning
            .is_some());
        assert!(read(&store, "other", "recent-captures").is_err());
        assert!(read(&store, "orbit-capture", "../foreign").is_err());
        store.installed.get_mut("orbit-capture").unwrap().enabled = false;
        assert!(preview_image(&store, "orbit-capture", "recent-captures", "first.png").is_err());
        assert!(read(&store, "orbit-capture", "recent-captures").is_err());
        store.installed.get_mut("orbit-capture").unwrap().enabled = true;
        store
            .installed
            .get_mut("orbit-capture")
            .unwrap()
            .manifest
            .permissions
            .clear();
        assert!(read(&store, "orbit-capture", "recent-captures").is_err());
        fs::remove_dir_all(base).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn widget_sources_reject_symlink_files_and_ancestors() {
        let base = std::env::current_dir()
            .unwrap()
            .join(format!(".widget-links-{}", uuid::Uuid::new_v4()));
        let mut store = Store::load(base.clone()).unwrap();
        let source = package().to_string();
        let (_, digest) = crate::packages::decode(&source).unwrap();
        store.install(&source, &digest).unwrap();
        let root = base.join("data/orbit-capture/files");
        files::write(&root, "screenshots/inside.png", b"inside").unwrap();
        fs::write(base.join("foreign.png"), b"outside").unwrap();
        std::os::unix::fs::symlink(base.join("foreign.png"), root.join("screenshots/link.png"))
            .unwrap();
        assert!(read(&store, "orbit-capture", "recent-captures").is_err());
        fs::remove_file(root.join("screenshots/link.png")).unwrap();
        fs::remove_dir_all(root.join("screenshots")).unwrap();
        std::os::unix::fs::symlink(&base, root.join("screenshots")).unwrap();
        assert!(read(&store, "orbit-capture", "recent-captures").is_err());
        fs::remove_file(root.join("screenshots")).unwrap();
        fs::remove_dir_all(base).unwrap();
    }
}

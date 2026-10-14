use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    Storage,
    Timers,
    ScreenCapture,
    AiChat,
    AppActions,
    FileSave,
    FilesRead,
    FilesWrite,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub sdk: u32,
    pub entry: String,
    pub permissions: Vec<Permission>,
    pub shortcut: Option<String>,
    #[serde(default)]
    pub actions: Vec<AppAction>,
    #[serde(default)]
    pub preferences: Vec<Preference>,
    pub icon: Option<String>,
    #[serde(default)]
    pub contracts: Vec<crate::contracts::Contract>,
    #[serde(default)]
    pub exports: Vec<crate::contracts::Export>,
    #[serde(default)]
    pub dependencies: Vec<crate::contracts::Dependency>,
    #[serde(default)]
    pub window: Option<WindowSize>,
    #[serde(default)]
    pub network: crate::network::Network,
    #[serde(default)]
    pub widgets: Vec<crate::widgets::Declaration>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WindowSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppAction {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    pub shortcut: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preference {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(flatten)]
    pub kind: PreferenceKind,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PreferenceKind {
    Boolean {
        default: bool,
    },
    Text {
        default: String,
    },
    Number {
        default: f64,
        min: f64,
        max: f64,
    },
    Select {
        default: String,
        options: Vec<PreferenceOption>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PreferenceOption {
    pub value: String,
    pub label: String,
}

impl Preference {
    fn default_value(&self) -> Value {
        match &self.kind {
            PreferenceKind::Boolean { default } => Value::from(*default),
            PreferenceKind::Text { default } | PreferenceKind::Select { default, .. } => {
                Value::from(default.clone())
            }
            PreferenceKind::Number { default, .. } => Value::from(*default),
        }
    }

    fn accepts(&self, value: &Value) -> bool {
        match &self.kind {
            PreferenceKind::Boolean { .. } => value.is_boolean(),
            PreferenceKind::Text { .. } => value.as_str().is_some_and(|s| s.len() <= 2000),
            PreferenceKind::Number { min, max, .. } => value
                .as_f64()
                .is_some_and(|v| v.is_finite() && v >= *min && v <= *max),
            PreferenceKind::Select { options, .. } => value
                .as_str()
                .is_some_and(|s| options.iter().any(|o| o.value == s)),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Package {
    pub manifest: Manifest,
    pub files: BTreeMap<String, String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub manifest: Manifest,
    pub enabled: bool,
    pub previous_version: Option<String>,
    #[serde(default)]
    pub shortcut_override: Option<String>,
    #[serde(default)]
    pub action_shortcuts: BTreeMap<String, String>,
    #[serde(default)]
    pub hidden: bool,
}

impl Installed {
    pub fn shortcut(&self) -> Option<&str> {
        self.shortcut_override
            .as_deref()
            .or(self.manifest.shortcut.as_deref())
            .filter(|s| !s.is_empty())
    }

    pub fn action_shortcut(&self, action: &AppAction) -> Option<&str> {
        self.action_shortcuts
            .get(&action.id)
            .map(String::as_str)
            .or_else(|| {
                self.manifest
                    .actions
                    .iter()
                    .find(|a| a.id == action.id)
                    .and_then(|a| a.shortcut.as_deref())
            })
            .filter(|s| !s.is_empty())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutOwner {
    pub app_id: Option<String>,
    pub action_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    #[serde(flatten)]
    pub owner: ShortcutOwner,
    pub app_name: String,
    pub label: String,
    pub shortcut: Option<String>,
    pub enabled: bool,
    pub registered: bool,
}

pub fn parse_shortcut(
    value: &str,
) -> Result<Option<tauri_plugin_global_shortcut::Shortcut>, String> {
    if value.len() > 80 {
        return Err("Hotkey troppo lunga.".into());
    }
    if value.is_empty() {
        return Ok(None);
    }
    value
        .parse()
        .map(Some)
        .map_err(|_| "Hotkey non valida.".into())
}

pub struct Store {
    pub root: PathBuf,
    pub installed: BTreeMap<String, Installed>,
}

pub fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        && value.as_bytes()[0].is_ascii_lowercase()
}

fn version(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|c| c.is_ascii_digit()))
}

pub fn asset_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && !value.starts_with('/')
        && value.split('/').all(|p| {
            !p.is_empty()
                && p != "."
                && p != ".."
                && p.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
        })
}

pub fn decode(source: &str) -> Result<(Package, String), String> {
    if source.len() > 20 * 1024 * 1024 {
        return Err("Pacchetto troppo grande (20 MB).".into());
    }
    let package: Package =
        serde_json::from_str(source).map_err(|e| format!("Pacchetto non valido: {e}"))?;
    let m = &package.manifest;
    if !identifier(&m.id)
        || !version(&m.version)
        || m.sdk != 1
        || m.name.trim().is_empty()
        || m.name.len() > 80
        || m.description.len() > 400
        || !asset_path(&m.entry)
        || !m.entry.ends_with(".html")
        || !package.files.contains_key(&m.entry)
        || m.exports.iter().any(|e| {
            e.interactive_entry
                .as_ref()
                .is_some_and(|p| !package.files.contains_key(p))
        })
        || package.files.len() > 128
        || m.permissions.len() > 8
        || m.window.as_ref().is_some_and(|size| {
            !(340..=1920).contains(&size.width) || !(300..=1200).contains(&size.height)
        })
        || m.permissions
            .iter()
            .enumerate()
            .any(|(i, p)| m.permissions[..i].contains(p))
    {
        return Err("Manifest non valido o versione SDK non supportata.".into());
    }
    crate::contracts::validate_manifest(m)?;
    crate::widgets::validate_manifest(m)?;
    m.network.validate()?;
    if let Some(shortcut) = &m.shortcut {
        parse_shortcut(shortcut)?;
    }
    if m.actions.len() > 32
        || m.preferences.len() > 32
        || m.icon.as_ref().is_some_and(|icon| {
            ![
                "grid", "scan", "chat", "note", "clock", "spark", "terminal", "image",
            ]
            .contains(&icon.as_str())
        })
    {
        return Err("Troppe azioni/preferenze o icona non valida.".into());
    }
    for (i, action) in m.actions.iter().enumerate() {
        if !identifier(&action.id)
            || action.id == "open"
            || action.label.trim().is_empty()
            || action.label.len() > 80
            || action.description.len() > 400
            || m.actions[..i].iter().any(|other| other.id == action.id)
        {
            return Err("Azione app non valida o duplicata.".into());
        }
        if let Some(shortcut) = &action.shortcut {
            parse_shortcut(shortcut)?;
        }
    }
    for (i, preference) in m.preferences.iter().enumerate() {
        if !identifier(&preference.id)
            || preference.label.trim().is_empty()
            || preference.label.len() > 80
            || preference.description.len() > 400
            || m.preferences[..i]
                .iter()
                .any(|other| other.id == preference.id)
            || !preference.accepts(&preference.default_value())
        {
            return Err("Preferenza app non valida o duplicata.".into());
        }
        if let PreferenceKind::Select { options, .. } = &preference.kind {
            if options.is_empty()
                || options.len() > 32
                || options.iter().enumerate().any(|(i, option)| {
                    option.value.is_empty()
                        || option.value.len() > 120
                        || option.label.trim().is_empty()
                        || option.label.len() > 80
                        || options[..i].iter().any(|other| other.value == option.value)
                })
            {
                return Err("Opzioni preferenza non valide.".into());
            }
        }
    }
    let mut size = 0;
    for (path, data) in &package.files {
        if !asset_path(path) || matches!(path.as_str(), "orbit-sdk.js" | "orbit-theme.css") {
            return Err("Percorso asset non consentito.".into());
        }
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| "Asset base64 non valido.")?;
        size += bytes.len();
        if size > 12 * 1024 * 1024 {
            return Err("Asset troppo grandi (12 MB).".into());
        }
    }
    Ok((package, format!("{:x}", Sha256::digest(source.as_bytes()))))
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    write_atomic(path, &bytes)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let mut file =
        fs::File::create(&temporary).map_err(|e| format!("Scrittura non riuscita: {e}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Scrittura non riuscita: {e}"))?;
    drop(file);
    fs::rename(&temporary, path).map_err(|e| format!("Conferma salvataggio non riuscita: {e}"))
}

impl Store {
    pub fn load(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("packages")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("data")).map_err(|e| e.to_string())?;
        let installed: BTreeMap<String, Installed> = match fs::read(root.join("index.json")) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("Catalogo danneggiato: {e}"))?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(format!("Catalogo non leggibile: {e}")),
        };
        let store = Self { root, installed };
        for (id, app) in &store.installed {
            if id != &app.manifest.id || !identifier(id) || !version(&app.manifest.version) {
                return Err("Indice catalogo non valido.".into());
            }
            if let Some(shortcut) = app.shortcut() {
                if shortcut.len() > 80
                    || shortcut
                        .parse::<tauri_plugin_global_shortcut::Shortcut>()
                        .is_err()
                {
                    return Err("Hotkey del catalogo non valida.".into());
                }
            }
            for (action, shortcut) in &app.action_shortcuts {
                if !identifier(action) || action == "open" {
                    return Err("Azione del catalogo non valida.".into());
                }
                parse_shortcut(shortcut)?;
            }
            let package = store.package(id)?;
            if serde_json::to_value(&package.manifest).map_err(|e| e.to_string())?
                != serde_json::to_value(&app.manifest).map_err(|e| e.to_string())?
            {
                return Err("Manifest del pacchetto diverso dall'indice.".into());
            }
        }
        crate::contracts::validate_registry(&store.installed)?;
        Ok(store)
    }

    pub fn package(&self, id: &str) -> Result<Package, String> {
        let record = self.installed.get(id).ok_or("App non installata.")?;
        self.read_version(id, &record.manifest.version)
    }

    fn read_version(&self, id: &str, ver: &str) -> Result<Package, String> {
        if !identifier(id) || !version(ver) {
            return Err("Identita pacchetto non valida.".into());
        }
        let source = fs::read_to_string(
            self.root
                .join("packages")
                .join(id)
                .join(format!("{ver}.orbit")),
        )
        .map_err(|e| format!("Pacchetto non leggibile: {e}"))?;
        let (package, _) = decode(&source)?;
        if package.manifest.id != id || package.manifest.version != ver {
            return Err("Identita del pacchetto non corrispondente.".into());
        }
        Ok(package)
    }

    pub(crate) fn commit(&mut self, next: BTreeMap<String, Installed>) -> Result<(), String> {
        crate::contracts::validate_registry(&next)?;
        let affected = crate::contracts::breaking(&self.installed, &next);
        if !affected.is_empty() {
            return Err(format!("Operazione bloccata: dipendenze richieste da {}. Installa un fornitore alternativo o disabilita prima queste app.", affected.join(", ")));
        }
        write_json(&self.root.join("index.json"), &next)?;
        self.installed = next;
        Ok(())
    }

    pub fn install(&mut self, source: &str, approved_digest: &str) -> Result<Vec<String>, String> {
        let (package, digest) = decode(source)?;
        if digest != approved_digest {
            return Err("Il pacchetto e cambiato dopo la revisione.".into());
        }
        let m = package.manifest;
        if self
            .installed
            .get(&m.id)
            .is_some_and(|p| p.manifest.version == m.version)
        {
            return Err("Versione gia installata: incrementa la versione del pacchetto.".into());
        }
        let directory = self.root.join("packages").join(&m.id);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let file = directory.join(format!("{}.orbit", m.version));
        // Version files are immutable; the small index is the atomic activation point.
        if file.exists() {
            if fs::read_to_string(&file).map_err(|e| e.to_string())? != source {
                return Err("Questa versione esiste gia con contenuto diverso.".into());
            }
        } else {
            write_atomic(&file, source.as_bytes())?;
        }
        let previous_version = self
            .installed
            .get(&m.id)
            .map(|r| r.manifest.version.clone());
        let shortcut_override = self
            .installed
            .get(&m.id)
            .and_then(|r| r.shortcut_override.clone());
        let action_shortcuts = self
            .installed
            .get(&m.id)
            .map(|r| r.action_shortcuts.clone())
            .unwrap_or_default();
        let mut next = self.installed.clone();
        let id = m.id.clone();
        let hidden = self.installed.get(&id).is_some_and(|app| app.hidden);
        next.insert(
            id.clone(),
            Installed {
                manifest: m,
                enabled: self.installed.get(&id).is_none_or(|app| app.enabled),
                previous_version,
                shortcut_override,
                action_shortcuts,
                hidden,
            },
        );
        self.activate(next, &id)
    }

    fn activate(
        &mut self,
        next: BTreeMap<String, Installed>,
        id: &str,
    ) -> Result<Vec<String>, String> {
        let candidate = Store {
            root: self.root.clone(),
            installed: next,
        };
        let breaking = crate::contracts::breaking(&self.installed, &candidate.installed);
        if !breaking.is_empty() {
            return Err(format!("Operazione bloccata: dipendenze mancanti per {}. Installa un fornitore alternativo o disabilita prima queste app.",breaking.join(", ")));
        }
        let previous_bindings = self.bindings();
        let mut claimed: Vec<_> = previous_bindings
            .iter()
            .filter(|b| b.owner.app_id.as_deref() != Some(id))
            .filter_map(|b| {
                b.shortcut
                    .as_deref()
                    .and_then(|s| parse_shortcut(s).ok().flatten())
            })
            .collect();
        let mut next = candidate.installed.clone();
        let mut warnings = Vec::new();
        for binding in candidate
            .bindings()
            .into_iter()
            .filter(|b| b.owner.app_id.as_deref() == Some(id))
        {
            let Some(parsed) = binding
                .shortcut
                .as_deref()
                .and_then(|s| parse_shortcut(s).ok().flatten())
            else {
                continue;
            };
            let unchanged = previous_bindings.iter().any(|old| {
                old.owner == binding.owner
                    && old
                        .shortcut
                        .as_deref()
                        .and_then(|s| parse_shortcut(s).ok().flatten())
                        == Some(parsed)
            });
            if claimed.contains(&parsed) && !unchanged {
                let record = next.get_mut(id).ok_or("App non installata.")?;
                if binding.owner.action_id == "open" {
                    record.shortcut_override = Some(String::new());
                } else {
                    record
                        .action_shortcuts
                        .insert(binding.owner.action_id, String::new());
                }
                warnings.push(format!("Hotkey {} gia assegnata: {} resta senza hotkey. Configurala nelle impostazioni dell'app.", binding.shortcut.unwrap_or_default(), binding.label));
            } else {
                claimed.push(parsed);
            }
        }
        self.commit(next)?;
        Ok(warnings)
    }

    pub fn rollback(&mut self, id: &str) -> Result<Vec<String>, String> {
        let record = self.installed.get(id).ok_or("App non installata.")?;
        let previous = record
            .previous_version
            .as_ref()
            .ok_or("Nessuna versione precedente.")?;
        let package = self.read_version(id, previous)?;
        if package
            .manifest
            .permissions
            .iter()
            .any(|p| !record.manifest.permissions.contains(p))
            || package
                .manifest
                .network
                .connect
                .iter()
                .any(|origin| !record.manifest.network.connect.contains(origin))
        {
            return Err(
                "La versione precedente richiede altri permessi: reinstallala con revisione."
                    .into(),
            );
        }
        let mut next = self.installed.clone();
        next.insert(
            id.into(),
            Installed {
                manifest: package.manifest,
                enabled: record.enabled,
                previous_version: Some(record.manifest.version.clone()),
                shortcut_override: record.shortcut_override.clone(),
                action_shortcuts: record.action_shortcuts.clone(),
                hidden: record.hidden,
            },
        );
        self.activate(next, id)
    }

    pub fn enable(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        let mut next = self.installed.clone();
        next.get_mut(id).ok_or("App non installata.")?.enabled = enabled;
        self.commit(next)
    }

    pub fn hide(&mut self, id: &str, hidden: bool) -> Result<(), String> {
        let mut next = self.installed.clone();
        next.get_mut(id).ok_or("App non installata.")?.hidden = hidden;
        self.commit(next)
    }

    pub fn set_shortcut(&mut self, id: &str, shortcut: &str) -> Result<(), String> {
        self.assign_shortcut(id, "open", shortcut, None)
    }

    pub fn bindings(&self) -> Vec<ShortcutBinding> {
        self.installed
            .values()
            .flat_map(|app| {
                let binding =
                    |action_id: &str, label: &str, shortcut: Option<&str>| ShortcutBinding {
                        owner: ShortcutOwner {
                            app_id: Some(app.manifest.id.clone()),
                            action_id: action_id.into(),
                        },
                        app_name: app.manifest.name.clone(),
                        label: label.into(),
                        shortcut: shortcut.map(str::to_owned),
                        enabled: app.enabled,
                        registered: false,
                    };
                let mut items = vec![binding("open", "Apri / nascondi app", app.shortcut())];
                items.extend(
                    app.manifest.actions.iter().map(|action| {
                        binding(&action.id, &action.label, app.action_shortcut(action))
                    }),
                );
                items
            })
            .collect()
    }

    pub fn shortcut_conflicts(
        &self,
        id: &str,
        action: &str,
        shortcut: &str,
    ) -> Result<Vec<ShortcutBinding>, String> {
        let entry = self.installed.get(id).ok_or("App non installata.")?;
        if action != "open" && !entry.manifest.actions.iter().any(|a| a.id == action) {
            return Err("Azione non dichiarata dall'app.".into());
        }
        let Some(parsed) = parse_shortcut(shortcut)? else {
            return Ok(Vec::new());
        };
        Ok(self
            .bindings()
            .into_iter()
            .filter(|b| {
                !(b.owner.app_id.as_deref() == Some(id) && b.owner.action_id == action)
                    && b.shortcut
                        .as_deref()
                        .and_then(|s| parse_shortcut(s).ok().flatten())
                        == Some(parsed)
            })
            .collect())
    }

    pub fn assign_shortcut(
        &mut self,
        id: &str,
        action: &str,
        shortcut: &str,
        replace: Option<&[ShortcutOwner]>,
    ) -> Result<(), String> {
        let conflicts = self.shortcut_conflicts(id, action, shortcut)?;
        if !conflicts.is_empty()
            && !replace.is_some_and(|owners| {
                owners.len() == conflicts.len()
                    && conflicts.iter().all(|b| owners.contains(&b.owner))
            })
        {
            return Err(
                "Hotkey gia usata: controlla i conflitti e conferma la sostituzione.".into(),
            );
        }
        if conflicts.is_empty() && replace.is_some_and(|owners| !owners.is_empty()) {
            return Err("Le assegnazioni sono cambiate. Controlla di nuovo la hotkey.".into());
        }
        let mut next = self.installed.clone();
        for conflict in conflicts {
            if let Some(app_id) = conflict.owner.app_id {
                let app = next.get_mut(&app_id).ok_or("App non installata.")?;
                if conflict.owner.action_id == "open" {
                    app.shortcut_override = Some(String::new());
                } else {
                    app.action_shortcuts
                        .insert(conflict.owner.action_id, String::new());
                }
            }
        }
        let app = next.get_mut(id).ok_or("App non installata.")?;
        if action == "open" {
            app.shortcut_override = Some(shortcut.into());
        } else {
            app.action_shortcuts.insert(action.into(), shortcut.into());
        }
        self.commit(next)
    }

    pub fn preferences(&self, id: &str) -> Result<Value, String> {
        let entry = self.installed.get(id).ok_or("App non installata.")?;
        let saved = self.read_data(id, "preferences")?;
        let saved = saved.as_object().ok_or("Preferenze app non valide.")?;
        let mut result = Map::new();
        for preference in &entry.manifest.preferences {
            let value = match saved.get(&preference.id) {
                Some(value) if preference.accepts(value) => value.clone(),
                Some(_) => {
                    return Err(format!(
                        "Preferenza {} incompatibile: ripristina i valori predefiniti.",
                        preference.label
                    ))
                }
                None => preference.default_value(),
            };
            result.insert(preference.id.clone(), value);
        }
        Ok(Value::Object(result))
    }

    pub fn save_preferences(&self, id: &str, patch: &Value, reset: bool) -> Result<Value, String> {
        let entry = self.installed.get(id).ok_or("App non installata.")?;
        let patch = patch
            .as_object()
            .ok_or("Le preferenze devono essere un oggetto.")?;
        for (key, value) in patch {
            let definition = entry
                .manifest
                .preferences
                .iter()
                .find(|p| &p.id == key)
                .ok_or("Preferenza sconosciuta.")?;
            if !definition.accepts(value) {
                return Err(format!("Valore non valido per {}.", definition.label));
            }
        }
        let mut values = if reset {
            entry
                .manifest
                .preferences
                .iter()
                .map(|p| (p.id.clone(), p.default_value()))
                .collect()
        } else {
            self.preferences(id)?
                .as_object()
                .ok_or("Preferenze app non valide.")?
                .clone()
        };
        values.extend(patch.clone());
        let result = Value::Object(values);
        self.write_data(id, "preferences", &result)?;
        Ok(result)
    }

    pub fn uninstall(&mut self, id: &str, delete_data: bool) -> Result<(), String> {
        if !self.installed.contains_key(id) {
            return Err("App non installata.".into());
        }
        let mut next = self.installed.clone();
        next.remove(id);
        self.commit(next)?;
        fs::remove_dir_all(self.root.join("packages").join(id))
            .map_err(|e| format!("Pulizia pacchetto: {e}"))?;
        let data = self.root.join("data").join(id);
        if delete_data && data.exists() {
            fs::remove_dir_all(data).map_err(|e| format!("Pulizia dati: {e}"))?;
        }
        Ok(())
    }

    pub fn authorize(&self, label: &str, permission: Option<Permission>) -> Result<String, String> {
        let id = label
            .strip_prefix("app-")
            .ok_or("Chiamante non autorizzato.")?;
        let record = self
            .installed
            .get(id)
            .filter(|r| r.enabled)
            .ok_or("App assente o disabilitata.")?;
        if permission.is_some_and(|p| !record.manifest.permissions.contains(&p)) {
            return Err("Permesso non concesso a questa app.".into());
        }
        Ok(id.into())
    }

    pub fn read_data(&self, id: &str, name: &str) -> Result<serde_json::Value, String> {
        let path = self.root.join("data").join(id).join(format!("{name}.json"));
        match fs::read(path) {
            Ok(bytes) => {
                serde_json::from_slice(&bytes).map_err(|e| format!("Dati app non validi: {e}"))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
            Err(e) => Err(format!("Dati app non leggibili: {e}")),
        }
    }

    pub fn write_data(
        &self,
        id: &str,
        name: &str,
        value: &serde_json::Value,
    ) -> Result<(), String> {
        if serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
            return Err("Quota storage app superata (1 MB).".into());
        }
        let directory = self.root.join("data").join(id);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        write_json(&directory.join(format!("{name}.json")), value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> String {
        serde_json::json!({"manifest":{"id":"test-app","name":"Test","description":"","version":"1.0.0","sdk":1,"entry":"index.html","permissions":["storage"],"shortcut":null},"files":{"index.html":STANDARD.encode("<html></html>")}}).to_string()
    }
    fn configured_source(id: &str) -> String {
        let mut package: Value = serde_json::from_str(&source()).unwrap();
        package["manifest"]["id"] = id.into();
        package["manifest"]["actions"] = serde_json::json!([
            {"id":"focus","label":"Focus","shortcut":"Ctrl+Shift+8"},
            {"id":"reset","label":"Reset","shortcut":null}
        ]);
        package["manifest"]["preferences"] = serde_json::json!([
            {"id":"enabled","label":"Enabled","type":"boolean","default":true},
            {"id":"size","label":"Size","type":"number","default":14,"min":12,"max":24},
            {"id":"label","label":"Label","type":"text","default":"hello"},
            {"id":"mode","label":"Mode","type":"select","default":"a","options":[{"value":"a","label":"A"},{"value":"b","label":"B"}]}
        ]);
        package.to_string()
    }

    #[test]
    fn validates_declared_actions_and_preference_schemas() {
        let source = configured_source("settings-app");
        assert!(decode(&source).is_ok());
        assert!(decode(&source.replace("\"focus\"", "\"open\"")).is_err());
        assert!(decode(&source.replace("\"reset\"", "\"focus\"")).is_err());
        assert!(decode(&source.replace("\"default\":14", "\"default\":100")).is_err());
        assert!(decode(&source.replace("\"default\":\"a\"", "\"default\":\"missing\"")).is_err());
        assert!(decode(&source.replace("\"type\":\"boolean\"", "\"type\":\"shell\"")).is_err());
        assert!(decode(&source.replace("Ctrl+Shift+8", "not-a-hotkey")).is_err());
    }

    #[test]
    fn recorder_key_names_are_accepted_by_native_shortcut_parser() {
        for shortcut in [
            "Ctrl+2",
            "Ctrl+Shift+2",
            "Super+K",
            "F9",
            "Alt+ArrowUp",
            "Ctrl+NumpadAdd",
            "Ctrl+Equal",
            "Ctrl+BracketLeft",
        ] {
            assert!(parse_shortcut(shortcut).is_ok(), "{shortcut}");
        }
    }
    #[test]
    fn starter_installation_applies_manifest_defaults_without_collisions() {
        let root =
            std::env::temp_dir().join(format!("orbit-starter-defaults-{}", std::process::id()));
        let mut store = Store::load(root.clone()).unwrap();
        for source in crate::apps::STARTERS {
            let (package, digest) = decode(source).unwrap();
            assert!(store.install(source, &digest).unwrap().is_empty());
            let record = &store.installed[&package.manifest.id];
            assert_eq!(record.shortcut(), package.manifest.shortcut.as_deref());
            assert!(record.shortcut().is_some());
            for action in &package.manifest.actions {
                assert!(action.shortcut.is_some());
                assert_eq!(record.action_shortcut(action), action.shortcut.as_deref());
            }
            let preferences = store.preferences(&package.manifest.id).unwrap();
            for preference in &package.manifest.preferences {
                assert_eq!(preferences[&preference.id], preference.default_value());
            }
        }
        let bindings = store.bindings();
        let parsed: Vec<_> = bindings
            .iter()
            .map(|b| {
                parse_shortcut(b.shortcut.as_deref().unwrap())
                    .unwrap()
                    .unwrap()
            })
            .collect();
        for (i, shortcut) in parsed.iter().enumerate() {
            assert!(!parsed[..i].contains(shortcut));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn updated_defaults_fill_unconfigured_values_and_preserve_user_overrides() {
        let root =
            std::env::temp_dir().join(format!("orbit-updated-defaults-{}", std::process::id()));
        let mut store = Store::load(root.clone()).unwrap();
        let mut package: Value = serde_json::from_str(&configured_source("settings-app")).unwrap();
        package["manifest"]["shortcut"] = Value::Null;
        for action in package["manifest"]["actions"].as_array_mut().unwrap() {
            action["shortcut"] = Value::Null;
        }
        let source = package.to_string();
        store.install(&source, &decode(&source).unwrap().1).unwrap();
        store.set_shortcut("settings-app", "Ctrl+Alt+9").unwrap();
        store
            .assign_shortcut("settings-app", "focus", "", None)
            .unwrap();
        store
            .save_preferences("settings-app", &serde_json::json!({"size":21}), false)
            .unwrap();
        package["manifest"]["version"] = Value::from("1.1.0");
        package["manifest"]["shortcut"] = Value::from("Ctrl+3");
        package["manifest"]["actions"][0]["shortcut"] = Value::from("Ctrl+Shift+3");
        package["manifest"]["actions"][1]["shortcut"] = Value::from("Ctrl+Alt+3");
        package["manifest"]["preferences"].as_array_mut().unwrap().push(
            serde_json::json!({"id":"new-option","label":"New option","type":"boolean","default":true})
        );
        let source = package.to_string();
        store.install(&source, &decode(&source).unwrap().1).unwrap();
        let store = Store::load(root.clone()).unwrap();
        let record = &store.installed["settings-app"];
        assert_eq!(record.shortcut(), Some("Ctrl+Alt+9"));
        assert_eq!(record.action_shortcut(&record.manifest.actions[0]), None);
        assert_eq!(
            record.action_shortcut(&record.manifest.actions[1]),
            Some("Ctrl+Alt+3")
        );
        assert_eq!(store.preferences("settings-app").unwrap()["size"], 21);
        assert_eq!(
            store.preferences("settings-app").unwrap()["new-option"],
            true
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preference_defaults_validation_namespace_and_retention() {
        let root = std::env::temp_dir().join(format!("orbit-preferences-{}", std::process::id()));
        let mut store = Store::load(root.clone()).unwrap();
        for id in ["settings-app", "other-app"] {
            let source = configured_source(id);
            store.install(&source, &decode(&source).unwrap().1).unwrap();
        }
        assert_eq!(store.preferences("settings-app").unwrap()["size"], 14.0);
        let values = serde_json::json!({"size":18,"enabled":false,"mode":"b","label":"new"});
        store
            .save_preferences("settings-app", &values, false)
            .unwrap();
        assert_eq!(store.preferences("settings-app").unwrap()["size"], 18);
        assert_eq!(store.preferences("other-app").unwrap()["size"], 14.0);
        for invalid in [
            serde_json::json!({"size":99}),
            serde_json::json!({"enabled":"yes"}),
            serde_json::json!({"mode":"c"}),
            serde_json::json!({"unknown":true}),
            serde_json::json!([]),
            serde_json::json!({"label":"a".repeat(2001)}),
        ] {
            assert!(store
                .save_preferences("settings-app", &invalid, false)
                .is_err());
        }
        store
            .write_data(
                "settings-app",
                "storage",
                &serde_json::json!({"note":"separate"}),
            )
            .unwrap();
        assert_eq!(store.preferences("settings-app").unwrap()["label"], "new");
        store.enable("settings-app", false).unwrap();
        store
            .save_preferences("settings-app", &serde_json::json!({"size":20}), false)
            .unwrap();
        assert_eq!(
            Store::load(root.clone())
                .unwrap()
                .preferences("settings-app")
                .unwrap()["size"],
            20
        );
        store.uninstall("settings-app", false).unwrap();
        let source = configured_source("settings-app");
        store.install(&source, &decode(&source).unwrap().1).unwrap();
        assert_eq!(store.preferences("settings-app").unwrap()["size"], 20);
        store
            .write_data(
                "settings-app",
                "preferences",
                &serde_json::json!({"size":100}),
            )
            .unwrap();
        assert!(store.preferences("settings-app").is_err());
        store
            .save_preferences("settings-app", &serde_json::json!({}), true)
            .unwrap();
        assert_eq!(store.preferences("settings-app").unwrap()["size"], 14.0);
        store.uninstall("settings-app", true).unwrap();
        assert!(!root.join("data/settings-app").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn action_conflicts_require_exact_confirmation_and_survive_restart() {
        let root = std::env::temp_dir().join(format!("orbit-actions-{}", std::process::id()));
        let mut store = Store::load(root.clone()).unwrap();
        for id in ["settings-app", "other-app"] {
            let source = configured_source(id);
            store.install(&source, &decode(&source).unwrap().1).unwrap();
        }
        // Earlier catalogs could contain colliding manifest defaults.
        store
            .installed
            .get_mut("other-app")
            .unwrap()
            .action_shortcuts
            .clear();
        store.enable("other-app", false).unwrap();
        assert!(store
            .assign_shortcut("settings-app", "missing", "", None)
            .is_err());
        assert!(store
            .assign_shortcut("settings-app", "reset", "Ctrl+Shift+8", None)
            .is_err());
        let conflicts = store
            .shortcut_conflicts("settings-app", "reset", "Control+Shift+8")
            .unwrap();
        assert_eq!(conflicts.len(), 2);
        let owners: Vec<_> = conflicts.into_iter().map(|c| c.owner).collect();
        assert!(store
            .assign_shortcut("settings-app", "reset", "Ctrl+Shift+8", Some(&owners[..1]))
            .is_err());
        store
            .assign_shortcut("settings-app", "reset", "Ctrl+Shift+8", Some(&owners))
            .unwrap();
        assert_eq!(store.installed["other-app"].action_shortcuts["focus"], "");
        assert_eq!(
            store.installed["settings-app"].action_shortcuts["focus"],
            ""
        );
        assert_eq!(
            Store::load(root.clone()).unwrap().installed["settings-app"].action_shortcuts["reset"],
            "Ctrl+Shift+8"
        );
        let mut invalid = store.installed.clone();
        invalid
            .get_mut("settings-app")
            .unwrap()
            .action_shortcuts
            .insert("reset".into(), "not-a-hotkey".into());
        write_json(&root.join("index.json"), &invalid).unwrap();
        assert!(Store::load(root.clone()).is_err());
        write_json(&root.join("index.json"), &store.installed).unwrap();
        assert!(store
            .assign_shortcut("settings-app", "open", "Ctrl+Shift+9", Some(&owners))
            .is_err());
        let update = configured_source("settings-app").replace("1.0.0", "1.1.0");
        store.install(&update, &decode(&update).unwrap().1).unwrap();
        store.rollback("settings-app").unwrap();
        assert_eq!(
            store.installed["settings-app"].action_shortcuts["reset"],
            "Ctrl+Shift+8"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn installing_a_package_never_takes_an_existing_action_hotkey() {
        let root =
            std::env::temp_dir().join(format!("orbit-install-shortcuts-{}", std::process::id()));
        let mut store = Store::load(root.clone()).unwrap();
        let first = configured_source("z-existing");
        store.install(&first, &decode(&first).unwrap().1).unwrap();
        let incoming = configured_source("a-new");
        let warnings = store
            .install(&incoming, &decode(&incoming).unwrap().1)
            .unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(store.installed["a-new"].action_shortcuts["focus"], "");
        assert_eq!(
            store
                .bindings()
                .iter()
                .find(|b| b.owner.app_id.as_deref() == Some("z-existing")
                    && b.owner.action_id == "focus")
                .unwrap()
                .shortcut
                .as_deref(),
            Some("Ctrl+Shift+8")
        );
        assert_eq!(
            Store::load(root.clone()).unwrap().installed["a-new"].action_shortcuts["focus"],
            ""
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn validates_package_and_rejects_traversal_and_unknown_permissions() {
        assert!(decode(&source()).is_ok());
        assert!(decode(&source().replace("index.html", "../index.html")).is_err());
        assert!(decode(&source().replace("\"storage\"", "\"shell\"")).is_err());
        assert!(decode(&source().replace("\"sdk\":1", "\"sdk\":2")).is_err());
        assert!(!identifier("../other"));
    }
    #[test]
    fn permissions_are_bound_to_installed_sender() {
        let package = decode(&source()).unwrap().0;
        let mut installed = BTreeMap::new();
        installed.insert(
            "test-app".into(),
            Installed {
                manifest: package.manifest,
                enabled: true,
                previous_version: None,
                shortcut_override: None,
                action_shortcuts: BTreeMap::new(),
                hidden: false,
            },
        );
        let store = Store {
            root: PathBuf::new(),
            installed,
        };
        assert!(store
            .authorize("app-test-app", Some(Permission::Storage))
            .is_ok());
        assert!(store
            .authorize("app-test-app", Some(Permission::AiChat))
            .is_err());
        assert!(store.authorize("app-other", None).is_err());
        assert!(store.authorize("overlay", None).is_err());
    }
    #[test]
    fn network_permissions_persist_and_rollback_cannot_expand_them() {
        let root = std::env::temp_dir().join(format!("orbit-network-{}", uuid::Uuid::new_v4()));
        let mut store = Store::load(root.clone()).unwrap();
        let mut package: Value = serde_json::from_str(&source()).unwrap();
        package["manifest"]["network"] = serde_json::json!({"connect":["https://api.example.com"]});
        let first = package.to_string();
        store.install(&first, &decode(&first).unwrap().1).unwrap();
        assert_eq!(
            Store::load(root.clone()).unwrap().installed["test-app"]
                .manifest
                .network
                .connect,
            vec!["https://api.example.com"]
        );
        package["manifest"]["version"] = serde_json::json!("1.1.0");
        package["manifest"]["network"] = serde_json::json!({"connect":[]});
        let second = package.to_string();
        store.install(&second, &decode(&second).unwrap().1).unwrap();
        assert!(store.rollback("test-app").unwrap_err().contains("permessi"));
        assert!(store.installed["test-app"]
            .manifest
            .network
            .connect
            .is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_optional_window_defaults() {
        let mut package: serde_json::Value = serde_json::from_str(&source()).unwrap();
        for (width, height, valid) in [
            (1180, 800, true),
            (340, 300, true),
            (0, 800, false),
            (1921, 800, false),
            (1180, 1201, false),
        ] {
            package["manifest"]["window"] = serde_json::json!({"width":width,"height":height});
            assert_eq!(decode(&package.to_string()).is_ok(), valid);
        }
    }

    #[test]
    fn install_update_rollback_and_uninstall_are_persistent() {
        let root = std::env::temp_dir().join(format!("orbit-package-test-{}", std::process::id()));
        let mut store = Store::load(root.clone()).unwrap();
        let a = source();
        assert!(store.install(&a, "wrong").is_err());
        store.install(&a, &decode(&a).unwrap().1).unwrap();
        store.hide("test-app", true).unwrap();
        store.set_shortcut("test-app", "Ctrl+Shift+9").unwrap();
        assert_eq!(store.installed["test-app"].shortcut(), Some("Ctrl+Shift+9"));
        store
            .write_data("test-app", "storage", &serde_json::json!({"note":"kept"}))
            .unwrap();
        let b = a.replace("1.0.0", "1.1.0");
        store.install(&b, &decode(&b).unwrap().1).unwrap();
        assert!(Store::load(root.clone()).unwrap().installed["test-app"].hidden);
        assert_eq!(store.installed["test-app"].shortcut(), Some("Ctrl+Shift+9"));
        store.rollback("test-app").unwrap();
        let modified = b.replace("\"Test\"", "\"Changed\"");
        assert!(store
            .install(&modified, &decode(&modified).unwrap().1)
            .is_err());
        assert!(store
            .write_data(
                "test-app",
                "storage",
                &serde_json::json!("x".repeat(1024 * 1024))
            )
            .is_err());
        assert_eq!(
            store.read_data("other-app", "storage").unwrap(),
            serde_json::json!({})
        );
        assert_eq!(
            Store::load(root.clone()).unwrap().installed["test-app"]
                .manifest
                .version,
            "1.0.0"
        );
        store.enable("test-app", false).unwrap();
        store.set_shortcut("test-app", "").unwrap();
        assert_eq!(store.installed["test-app"].shortcut(), None);
        assert!(store.authorize("app-test-app", None).is_err());
        let mut invalid = store.installed.clone();
        invalid.get_mut("test-app").unwrap().shortcut_override = Some("not-a-shortcut".into());
        write_json(&root.join("index.json"), &invalid).unwrap();
        assert!(Store::load(root.clone()).is_err());
        write_json(&root.join("index.json"), &store.installed).unwrap();
        store.uninstall("test-app", false).unwrap();
        assert_eq!(
            store.read_data("test-app", "storage").unwrap()["note"],
            "kept"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

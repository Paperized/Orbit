use crate::packages::{identifier, Installed, Manifest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Schema {
    Null,
    Boolean,
    Number,
    String {
        #[serde(default = "text_limit", rename = "maxLength")]
        max_length: usize,
    },
    Attachment,
    Array {
        items: Box<Schema>,
        #[serde(rename = "maxItems")]
        max_items: usize,
    },
    Object {
        properties: BTreeMap<String, Schema>,
        #[serde(default)]
        required: Vec<String>,
    },
}
fn text_limit() -> usize {
    20000
}

impl Schema {
    fn valid(&self, depth: usize) -> bool {
        if depth > 8 {
            return false;
        }
        match self {
            Self::String { max_length } => *max_length <= 100000,
            Self::Array { items, max_items } => *max_items <= 100 && items.valid(depth + 1),
            Self::Object {
                properties,
                required,
            } => {
                properties.len() <= 32
                    && properties.iter().all(|(k, v)| {
                        !k.is_empty()
                            && k.len() <= 64
                            && k.bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                            && !["__proto__", "constructor", "prototype"].contains(&k.as_str())
                            && v.valid(depth + 1)
                    })
                    && required.iter().all(|k| properties.contains_key(k))
                    && required.iter().collect::<BTreeSet<_>>().len() == required.len()
            }
            _ => true,
        }
    }

    pub fn validate(&self, value: &Value, refs: &mut Vec<String>) -> Result<(), String> {
        let valid = match self {
            Self::Null => value.is_null(),
            Self::Boolean => value.is_boolean(),
            Self::Number => value.as_f64().is_some_and(f64::is_finite),
            Self::String { max_length } => value.as_str().is_some_and(|v| v.len() <= *max_length),
            Self::Attachment => {
                if let Some(id) = value
                    .as_object()
                    .filter(|v| v.len() == 1)
                    .and_then(|v| v.get("attachmentId"))
                    .and_then(Value::as_str)
                {
                    if uuid::Uuid::parse_str(id).is_ok() {
                        refs.push(id.into());
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            Self::Array { items, max_items } => {
                if let Some(values) = value.as_array().filter(|a| a.len() <= *max_items) {
                    for value in values {
                        items.validate(value, refs)?;
                    }
                    true
                } else {
                    false
                }
            }
            Self::Object {
                properties,
                required,
            } => {
                if let Some(values) = value.as_object().filter(|v| {
                    required.iter().all(|key| v.contains_key(key))
                        && v.keys().all(|key| properties.contains_key(key))
                }) {
                    for (key, value) in values {
                        properties[key].validate(value, refs)?;
                    }
                    true
                } else {
                    false
                }
            }
        };
        if valid {
            Ok(())
        } else {
            Err("Valore non conforme al contratto dell'azione.".into())
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Contract {
    pub id: String,
    pub version: u32,
    pub input: Schema,
    pub output: Schema,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Export {
    pub id: String,
    pub title: String,
    pub description: String,
    pub contract: String,
    pub version: u32,
    #[serde(default)]
    pub accepts: Vec<String>,
    #[serde(default)]
    pub mode: ExportMode,
    #[serde(default)]
    pub invocation_modes: Vec<InvocationMode>,
    pub interactive_entry: Option<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InvocationMode {
    Service,
    Interactive,
}
impl Export {
    pub fn intent(&self, intent: Option<InvocationMode>) -> Result<InvocationMode, String> {
        let intent = intent.unwrap_or(if self.mode == ExportMode::Handoff {
            InvocationMode::Interactive
        } else {
            InvocationMode::Service
        });
        let supported = if self.invocation_modes.is_empty() {
            intent == InvocationMode::Service && self.mode == ExportMode::Request
        } else {
            self.invocation_modes.contains(&intent)
        };
        if !supported || (intent == InvocationMode::Interactive && self.interactive_entry.is_none())
        {
            return Err("Intento non supportato: dichiara invocationModes e interactiveEntry per la UI dedicata; nessuna apertura implicita dell'app.".into());
        }
        Ok(intent)
    }
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportMode {
    #[default]
    Request,
    Handoff,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Dependency {
    pub contract: String,
    pub version: u32,
    #[serde(default)]
    pub required: bool,
    pub provider: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    pub app_id: String,
    pub app_name: String,
    pub feature: Export,
}

pub fn standard(id: &str, version: u32) -> Option<Contract> {
    if version != 1 {
        return None;
    }
    let (input, output) = match id {
        "image.capture" => (
            json!({"type":"object","properties":{}}),
            json!({"type":"object","properties":{"image":{"type":"attachment"}},"required":["image"]}),
        ),
        "image.receive" => (
            json!({"type":"object","properties":{"image":{"type":"attachment"},"prompt":{"type":"string","maxLength":20000}},"required":["image"]}),
            json!({"type":"object","properties":{"accepted":{"type":"boolean"}},"required":["accepted"]}),
        ),
        _ => return None,
    };
    Some(Contract {
        id: id.into(),
        version,
        input: serde_json::from_value(input).expect("static schema"),
        output: serde_json::from_value(output).expect("static schema"),
    })
}
pub fn definition(manifest: &Manifest, id: &str, version: u32) -> Option<Contract> {
    standard(id, version).or_else(|| {
        manifest
            .contracts
            .iter()
            .find(|c| c.id == id && c.version == version)
            .cloned()
    })
}
fn contract_id(id: &str) -> bool {
    id.len() <= 160 && id.contains('.') && id.split('.').all(identifier)
}
pub fn validate_manifest(m: &Manifest) -> Result<(), String> {
    if m.contracts.len() > 16 || m.exports.len() > 32 || m.dependencies.len() > 32 {
        return Err("Troppi contratti, funzioni o dipendenze.".into());
    }
    let mut keys = BTreeSet::new();
    for c in &m.contracts {
        if !contract_id(&c.id)
            || c.version == 0
            || !c.input.valid(0)
            || !c.output.valid(0)
            || !keys.insert((&c.id, c.version))
            || standard(&c.id, c.version).is_some_and(|standard| standard != *c)
        {
            return Err("Contratto non valido, duplicato o diverso dallo standard.".into());
        }
    }
    let mut names = BTreeSet::new();
    for e in &m.exports {
        if !identifier(&e.id)
            || !names.insert(&e.id)
            || e.title.trim().is_empty()
            || e.title.len() > 80
            || e.description.len() > 400
            || definition(m, &e.contract, e.version).is_none()
            || e.accepts
                .iter()
                .any(|s| !["image/png", "image/*"].contains(&s.as_str()))
            || e.accepts.len() > 2
            || (e.contract == "image.receive" && e.accepts.is_empty())
            || e.invocation_modes.len() > 2
            || (e.invocation_modes.len() == 2 && e.invocation_modes[0] == e.invocation_modes[1])
            || e.interactive_entry.as_ref().is_some_and(|p| {
                !crate::packages::asset_path(p) || !p.ends_with(".html") || p == &m.entry
            })
            || (e.invocation_modes.contains(&InvocationMode::Interactive)
                && e.interactive_entry.is_none())
        {
            return Err("Funzione pubblica non valida o contratto mancante.".into());
        }
    }
    let mut deps = BTreeSet::new();
    for d in &m.dependencies {
        if !contract_id(&d.contract)
            || d.version == 0
            || definition(m, &d.contract, d.version).is_none()
            || !deps.insert((&d.contract, d.version))
            || d.provider
                .as_deref()
                .is_some_and(|id| !identifier(id) || id == m.id)
        {
            return Err("Dipendenza non valida o duplicata.".into());
        }
    }
    if (!m.dependencies.is_empty() || !m.exports.is_empty())
        && !m
            .permissions
            .contains(&crate::packages::Permission::AppActions)
    {
        return Err("Funzioni pubbliche e dipendenze richiedono il permesso app-actions.".into());
    }
    Ok(())
}
pub fn validate_registry(installed: &BTreeMap<String, Installed>) -> Result<(), String> {
    let mut definitions = BTreeMap::new();
    for app in installed.values() {
        for c in &app.manifest.contracts {
            let key = (c.id.clone(), c.version);
            if definitions.insert(key, c).is_some_and(|old| old != c) {
                return Err(format!(
                    "Definizioni incompatibili per {} v{}.",
                    c.id, c.version
                ));
            }
        }
    }
    Ok(())
}
fn ready_inner(
    id: &str,
    apps: &BTreeMap<String, Installed>,
    visiting: &mut BTreeSet<String>,
) -> bool {
    let Some(app) = apps.get(id).filter(|a| a.enabled) else {
        return false;
    };
    if !visiting.insert(id.into()) {
        return false;
    }
    let result = app
        .manifest
        .dependencies
        .iter()
        .filter(|d| d.required)
        .all(|d| {
            apps.values().any(|provider| {
                matches_dependency(&provider.manifest, d)
                    && ready_inner(&provider.manifest.id, apps, visiting)
            })
        });
    visiting.remove(id);
    result
}
fn matches_dependency(m: &Manifest, d: &Dependency) -> bool {
    d.provider.as_ref().is_none_or(|id| id == &m.id)
        && m.exports
            .iter()
            .any(|e| e.contract == d.contract && e.version == d.version)
}
pub fn ready(id: &str, apps: &BTreeMap<String, Installed>) -> bool {
    ready_inner(id, apps, &mut BTreeSet::new())
}
pub fn destinations(
    apps: &BTreeMap<String, Installed>,
    contract: &str,
    version: u32,
    provider: Option<&str>,
    mime: Option<&str>,
) -> Vec<Destination> {
    apps.values()
        .filter(|app| {
            provider.is_none_or(|id| id == app.manifest.id) && ready(&app.manifest.id, apps)
        })
        .flat_map(|app| {
            app.manifest
                .exports
                .iter()
                .filter(move |e| {
                    e.contract == contract
                        && e.version == version
                        && mime.is_none_or(|mime| {
                            e.accepts.iter().any(|m| m == mime || m == "image/*")
                        })
                })
                .map(|feature| Destination {
                    app_id: app.manifest.id.clone(),
                    app_name: app.manifest.name.clone(),
                    feature: feature.clone(),
                })
        })
        .collect()
}
pub fn breaking(
    before: &BTreeMap<String, Installed>,
    after: &BTreeMap<String, Installed>,
) -> Vec<String> {
    before
        .keys()
        .filter(|id| {
            after.get(*id).is_some_and(|a| a.enabled) && ready(id, before) && !ready(id, after)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invocation_intent_never_escalates_to_the_full_app() {
        let legacy: Export = serde_json::from_value(json!({"id":"run","title":"Run","description":"","contract":"image.capture","version":1})).unwrap();
        assert_eq!(legacy.intent(None).unwrap(), InvocationMode::Service);
        assert!(legacy.intent(Some(InvocationMode::Interactive)).is_err());
        let mut handoff = legacy.clone();
        handoff.mode = ExportMode::Handoff;
        assert!(handoff
            .intent(None)
            .unwrap_err()
            .contains("nessuna apertura implicita"));
        handoff.invocation_modes = vec![InvocationMode::Interactive];
        handoff.interactive_entry = Some("image.html".into());
        assert_eq!(handoff.intent(None).unwrap(), InvocationMode::Interactive);
        assert!(handoff.intent(Some(InvocationMode::Service)).is_err());
        assert!(serde_json::from_value::<InvocationMode>(json!("app")).is_err());
        let mut manifest: Manifest =
            serde_json::from_str(include_str!("../../apps/chat/manifest.json")).unwrap();
        manifest.exports[0].interactive_entry = Some(manifest.entry.clone());
        assert!(validate_manifest(&manifest).is_err());
        manifest.exports[0].interactive_entry = Some("../image.html".into());
        assert!(validate_manifest(&manifest).is_err());
    }
    fn app(id: &str, export: Option<&str>, required: Option<&str>) -> Installed {
        let mut manifest: Value =
            serde_json::from_str(include_str!("../../apps/chat/manifest.json")).unwrap();
        manifest["id"] = json!(id);
        manifest["exports"] = export.map(|contract| json!([{"id":"run","title":"Run","description":"Test","contract":contract,"version":1}])).unwrap_or(json!([]));
        manifest["dependencies"] = required
            .map(|contract| json!([{"contract":contract,"version":1,"required":true}]))
            .unwrap_or(json!([]));
        serde_json::from_value(json!({"manifest":manifest,"enabled":true,"previousVersion":null}))
            .unwrap()
    }
    #[test]
    fn validates_exact_payloads_and_attachment_references() {
        let contract = standard("image.receive", 1).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut refs = Vec::new();
        contract
            .input
            .validate(&json!({"image":{"attachmentId":id}}), &mut refs)
            .unwrap();
        assert_eq!(refs, vec![id]);
        assert!(contract
            .input
            .validate(
                &json!({"image":{"attachmentId":"invalid"}}),
                &mut Vec::new()
            )
            .is_err());
        assert!(contract
            .input
            .validate(
                &json!({"image":{"attachmentId":refs[0]},"extra":true}),
                &mut Vec::new()
            )
            .is_err());
        assert!(contract
            .output
            .validate(&json!({"accepted":"yes"}), &mut Vec::new())
            .is_err());
        assert!(Schema::String { max_length: 2 }
            .validate(&json!("long"), &mut Vec::new())
            .is_err());
    }
    #[test]
    fn dependency_cycles_alternatives_and_hidden_providers() {
        let mut apps = BTreeMap::from([
            (
                "a".into(),
                app("a", Some("image.capture"), Some("image.receive")),
            ),
            (
                "b".into(),
                app("b", Some("image.receive"), Some("image.capture")),
            ),
        ]);
        assert!(!ready("a", &apps));
        apps.insert(
            "alternative".into(),
            app("alternative", Some("image.receive"), None),
        );
        apps.get_mut("alternative").unwrap().hidden = true;
        assert!(ready("a", &apps));
        assert!(ready("b", &apps));
        let before = apps.clone();
        apps.get_mut("alternative").unwrap().enabled = false;
        assert_eq!(breaking(&before, &apps), vec!["a", "b"]);
        assert!(!ready("a", &apps));
    }
    #[test]
    fn object_fields_allow_camel_case_but_not_prototype_keys() {
        let schema = Schema::Object {
            properties: BTreeMap::from([("inputValue".into(), Schema::Number)]),
            required: vec!["inputValue".into()],
        };
        assert!(schema.valid(0));
        for key in ["__proto__", "constructor", "prototype"] {
            assert!(!Schema::Object {
                properties: BTreeMap::from([(key.into(), Schema::Number)]),
                required: vec![],
            }
            .valid(0));
        }
    }
    #[test]
    fn custom_contracts_must_agree_and_cannot_override_standards() {
        let mut a = app("a", None, None);
        let mut contract = standard("image.capture", 1).unwrap();
        contract.id = "example.custom".into();
        a.manifest.contracts.push(contract);
        let mut b = a.clone();
        b.manifest.id = "b".into();
        b.manifest.contracts[0].output = Schema::Null;
        assert!(
            validate_registry(&BTreeMap::from([("a".into(), a.clone()), ("b".into(), b)])).is_err()
        );
        a.manifest.contracts[0].id = "image.capture".into();
        a.manifest.contracts[0].output = Schema::Null;
        assert!(validate_manifest(&a.manifest).is_err());
    }
}

use crate::{
    apps::{self, Runtime},
    capture::Capture,
    contracts::{self, Schema},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio::sync::oneshot;

#[derive(Default)]
struct Grant {
    retained: bool,
    calls: BTreeSet<String>,
}
struct Attachment {
    capture: Capture,
    bytes: Vec<u8>,
    grants: BTreeMap<String, Grant>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Invocation {
    request_id: String,
    action_id: String,
    input: Value,
    caller_name: String,
    intent: contracts::InvocationMode,
}
struct Pending {
    caller: String,
    provider: String,
    invocation: Invocation,
    output: Schema,
    response: Option<oneshot::Sender<Result<Value, String>>>,
    input_refs: Vec<String>,
    dispatched: bool,
}
#[derive(Default)]
pub struct Hub {
    attachments: BTreeMap<String, Attachment>,
    pending: BTreeMap<String, Pending>,
    ready: BTreeSet<String>,
    pub(crate) transient: BTreeSet<String>,
    cancelled: BTreeSet<(String, String)>,
}
fn argument<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone())
        .map_err(|e| format!("Argomenti inter-app non validi: {e}"))
}
fn ref_id(value: &Value) -> Result<&str, String> {
    value["attachmentId"]
        .as_str()
        .ok_or("Riferimento allegato mancante.".into())
}
impl Hub {
    fn attachment(&self, id: &str, owner: &str) -> Result<&Attachment, String> {
        self.attachments
            .get(id)
            .filter(|a| a.grants.contains_key(owner))
            .ok_or("Allegato assente, scaduto o non autorizzato.".into())
    }
    fn create(&mut self, owner: &str, capture: Capture) -> Result<Value, String> {
        let encoded = capture
            .data_url
            .strip_prefix("data:image/png;base64,")
            .ok_or("Solo PNG supportati.")?;
        if encoded.len() > 16 * 1024 * 1024 {
            return Err("Allegato troppo grande.".into());
        }
        let bytes = STANDARD.decode(encoded).map_err(|_| "PNG non valido.")?;
        let reader =
            image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png);
        let (width, height) = reader
            .into_dimensions()
            .map_err(|_| "Immagine PNG non valida.")?;
        if width == 0
            || height == 0
            || width > 1800
            || height > 1800
            || width != capture.width
            || height != capture.height
        {
            return Err("Dimensioni immagine non valide.".into());
        }
        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .map_err(|_| "PNG non valido.")?;
        if self.attachments.len() >= 32
            || self
                .attachments
                .values()
                .map(|a| a.bytes.len())
                .sum::<usize>()
                + bytes.len()
                > 48 * 1024 * 1024
        {
            return Err(
                "Quota allegati raggiunta: chiudi o libera le immagini inutilizzate.".into(),
            );
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.attachments.insert(
            id.clone(),
            Attachment {
                capture,
                bytes,
                grants: BTreeMap::from([(
                    owner.into(),
                    Grant {
                        retained: true,
                        calls: BTreeSet::new(),
                    },
                )]),
            },
        );
        Ok(json!({"attachmentId":id}))
    }
    fn prune(&mut self) {
        self.attachments.retain(|_, a| {
            a.grants.retain(|_, g| g.retained || !g.calls.is_empty());
            !a.grants.is_empty()
        });
    }
    fn finish(&mut self, id: &str) -> Option<Pending> {
        let pending = self.pending.remove(id)?;
        for reference in &pending.input_refs {
            if let Some(a) = self.attachments.get_mut(reference) {
                if let Some(g) = a.grants.get_mut(&pending.provider) {
                    g.calls.remove(id);
                }
            }
        }
        self.prune();
        Some(pending)
    }
    fn cyclic(&self, caller: &str, provider: &str) -> bool {
        let mut seen = BTreeSet::new();
        let mut queue = vec![provider.to_string()];
        while let Some(id) = queue.pop() {
            if id == caller {
                return true;
            }
            if seen.insert(id.clone()) {
                queue.extend(
                    self.pending
                        .values()
                        .filter(|p| p.caller == id)
                        .map(|p| p.provider.clone()),
                );
            }
        }
        false
    }
}
pub fn closed(app: &AppHandle, id: &str) {
    let runtime = app.state::<Runtime>();
    let cancelled = match runtime.interop.lock() {
        Ok(mut hub) => {
            hub.ready.remove(id);
            hub.transient.remove(id);
            hub.cancelled.retain(|(owner, _)| owner != id);
            let requests: Vec<_> = hub
                .pending
                .iter()
                .filter(|(_, p)| p.caller == id || p.provider == id)
                .map(|(id, _)| id.clone())
                .collect();
            let mut cancelled = Vec::new();
            for request in requests {
                if let Some(mut p) = hub.finish(&request) {
                    if let Some(sender) = p.response.take() {
                        let _ = sender.send(Err("App chiusa durante la richiesta.".into()));
                    }
                    cancelled.push((p.provider, request));
                }
            }
            for a in hub.attachments.values_mut() {
                a.grants.remove(id);
            }
            hub.prune();
            cancelled
        }
        Err(_) => {
            crate::overlay::report(app, "Stato chiamate inter-app non disponibile.".into());
            return;
        }
    };
    for (provider, request) in cancelled {
        notify_cancel(app, &provider, &request);
    }
}
fn notify_cancel(app: &AppHandle, provider: &str, request: &str) {
    if let Some(window) = app.get_webview_window(&format!("app-{provider}")) {
        if let Err(error) = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('orbit:service-cancel',{{detail:{}}}))",
            json!(request)
        )) {
            crate::overlay::report(app, format!("Annullamento azione: {error}"));
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Query {
    contract: String,
    version: u32,
    #[serde(default)]
    mime: Option<String>,
}
fn dependency<'a>(
    store: &'a crate::packages::Store,
    id: &str,
    contract: &str,
    version: u32,
) -> Result<&'a contracts::Dependency, String> {
    store
        .installed
        .get(id)
        .and_then(|a| {
            a.manifest
                .dependencies
                .iter()
                .find(|d| d.contract == contract && d.version == version)
        })
        .ok_or("Questa dipendenza non e dichiarata dall'app.".into())
}

pub async fn request(
    window: WebviewWindow,
    owner: String,
    action: &str,
    args: Value,
) -> Result<Value, String> {
    let app = window.app_handle();
    let runtime = app.state::<Runtime>();
    let package = apps::package_id(&runtime, &owner)?;
    match action {
        "attachments.create" => {
            let capture: Capture = argument(&args)?;
            runtime
                .interop
                .lock()
                .map_err(|_| "Allegati occupati.")?
                .create(&owner, capture)
        }
        "attachments.read" => {
            let hub = runtime.interop.lock().map_err(|_| "Allegati occupati.")?;
            Ok(json!(hub.attachment(ref_id(&args)?, &owner)?.capture))
        }
        "attachments.retain" | "attachments.release" => {
            let mut hub = runtime.interop.lock().map_err(|_| "Allegati occupati.")?;
            let id = ref_id(&args)?;
            hub.attachment(id, &owner)?;
            let grant = hub
                .attachments
                .get_mut(id)
                .and_then(|a| a.grants.get_mut(&owner))
                .ok_or("Allegato non disponibile.")?;
            grant.retained = action == "attachments.retain";
            hub.prune();
            Ok(Value::Null)
        }
        "attachments.save" => {
            let bytes = {
                let hub = runtime.interop.lock().map_err(|_| "Allegati occupati.")?;
                hub.attachment(ref_id(&args)?, &owner)?.bytes.clone()
            };
            let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
            let path = format!("screenshots/{}.png", uuid::Uuid::new_v4());
            crate::files::write(
                &store.root.join("data").join(&package).join("files"),
                &path,
                &bytes,
            )?;
            Ok(json!({"saved":true,"path":path}))
        }
        "services.list" => {
            let query: Query = argument(&args)?;
            let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
            let dep = dependency(&store, &package, &query.contract, query.version)?;
            Ok(json!(contracts::destinations(
                &store.installed,
                &query.contract,
                query.version,
                dep.provider.as_deref(),
                query.mime.as_deref()
            )
            .into_iter()
            .filter(|d| d.app_id != package)
            .collect::<Vec<_>>()))
        }
        "services.register" => {
            let ids: Vec<String> = argument(&args)?;
            let feature = runtime
                .features
                .lock()
                .map_err(|_| "Sessioni occupate.")?
                .get(&owner)
                .cloned();
            let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
            let exports = &store.installed[&package].manifest.exports;
            let expected: Vec<_> = exports
                .iter()
                .filter(|e| feature.as_ref().is_none_or(|s| s.action_id == e.id))
                .collect();
            if ids.len() != expected.len() || !expected.iter().all(|e| ids.contains(&e.id)) {
                return Err("Registra esattamente le funzioni pubbliche dichiarate.".into());
            }
            let mut hub = runtime.interop.lock().map_err(|_| "Chiamate occupate.")?;
            hub.ready.insert(owner.clone());
            let requests: Vec<_> = hub
                .pending
                .values_mut()
                .filter(|p| p.provider == owner && !p.dispatched)
                .map(|p| {
                    p.dispatched = true;
                    p.invocation.clone()
                })
                .collect();
            let present = feature.is_some() && !requests.is_empty();
            drop(hub);
            drop(store);
            if present {
                crate::window_geometry::show(&window)?;
                window.set_focus().map_err(|e| e.to_string())?;
            }
            Ok(json!(requests))
        }
        "services.respond" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Response {
                request_id: String,
                output: Option<Value>,
                error: Option<String>,
            }
            let reply: Response = argument(&args)?;
            let mut hub = runtime.interop.lock().map_err(|_| "Chiamate occupate.")?;
            let p = hub
                .pending
                .get(&reply.request_id)
                .filter(|p| p.provider == owner)
                .ok_or("Richiesta scaduta o non autorizzata.")?;
            if p.response.is_none() {
                return Err("Risposta gia consegnata.".into());
            }
            let mut refs = Vec::new();
            let result = if let Some(error) = reply.error {
                Err(error.chars().take(500).collect())
            } else {
                let output = reply.output.unwrap_or(Value::Null);
                if serde_json::to_vec(&output)
                    .map_err(|e| e.to_string())?
                    .len()
                    > 1024 * 1024
                {
                    return Err("Risultato troppo grande.".into());
                }
                p.output.validate(&output, &mut refs)?;
                for id in &refs {
                    hub.attachment(id, &owner)?;
                }
                Ok(output)
            };
            let caller = p.caller.clone();
            for id in refs {
                hub.attachments
                    .get_mut(&id)
                    .ok_or("Allegato scaduto.")?
                    .grants
                    .entry(caller.clone())
                    .or_default()
                    .retained = true;
            }
            let p = hub
                .pending
                .get_mut(&reply.request_id)
                .ok_or("Richiesta scaduta.")?;
            if let Some(sender) = p.response.take() {
                let _ = sender.send(result);
            } else {
                return Err("Risposta gia consegnata.".into());
            }
            Ok(Value::Null)
        }
        "services.cancel" => {
            let request = args["requestId"].as_str().ok_or("ID richiesta assente.")?;
            uuid::Uuid::parse_str(request).map_err(|_| "ID richiesta non valido.")?;
            let pending = {
                let mut hub = runtime.interop.lock().map_err(|_| "Chiamate occupate.")?;
                if hub.pending.get(request).is_some_and(|p| p.caller != owner) {
                    return Err("Richiesta non autorizzata.".into());
                }
                let pending = hub.finish(request);
                if pending.is_none() {
                    if hub.cancelled.len() >= 128 {
                        hub.cancelled.pop_first();
                    }
                    hub.cancelled.insert((owner.clone(), request.into()));
                }
                pending
            };
            if let Some(mut p) = pending {
                if let Some(tx) = p.response.take() {
                    let _ = tx.send(Err("Richiesta annullata.".into()));
                }
                notify_cancel(app, &p.provider, request);
            }
            Ok(Value::Null)
        }
        "services.call" => call(app.clone(), owner, args).await,
        _ => Err("Metodo inter-app sconosciuto.".into()),
    }
}
async fn call(app: AppHandle, owner: String, args: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Call {
        request_id: String,
        contract: String,
        version: u32,
        input: Value,
        provider: Option<String>,
        action_id: Option<String>,
        intent: Option<contracts::InvocationMode>,
    }
    let call: Call = argument(&args)?;
    uuid::Uuid::parse_str(&call.request_id).map_err(|_| "ID richiesta non valido.")?;
    if serde_json::to_vec(&call.input)
        .map_err(|e| e.to_string())?
        .len()
        > 1024 * 1024
    {
        return Err("Input troppo grande.".into());
    }
    let runtime = app.state::<Runtime>();
    let package = apps::package_id(&runtime, &owner)?;
    let (target, contract, caller_name) = {
        let store = runtime.store.lock().map_err(|_| "Catalogo occupato.")?;
        let dep = dependency(&store, &package, &call.contract, call.version)?;
        let mut targets = contracts::destinations(
            &store.installed,
            &call.contract,
            call.version,
            dep.provider.as_deref(),
            None,
        );
        targets.retain(|d| {
            d.app_id != package
                && call.provider.as_ref().is_none_or(|id| id == &d.app_id)
                && call.action_id.as_ref().is_none_or(|id| id == &d.feature.id)
        });
        if targets.len() != 1 {
            return Err(if targets.is_empty() {
                "Nessuna app compatibile disponibile."
            } else {
                "Piu funzioni disponibili: scegli una destinazione."
            }
            .into());
        }
        let target = targets.remove(0);
        let contract = contracts::definition(
            &store.installed[&target.app_id].manifest,
            &call.contract,
            call.version,
        )
        .ok_or("Contratto non disponibile.")?;
        (
            target,
            contract,
            store.installed[&package].manifest.name.clone(),
        )
    };
    let intent = target.feature.intent(call.intent)?;
    let interactive = intent == contracts::InvocationMode::Interactive;
    if interactive
        && runtime
            .features
            .lock()
            .map_err(|_| "Sessioni occupate.")?
            .len()
            >= 32
    {
        return Err("Limite finestre di funzione raggiunto.".into());
    }
    let provider = if interactive {
        format!("feature-{}", uuid::Uuid::new_v4())
    } else {
        target.app_id.clone()
    };
    let mut refs = Vec::new();
    contract.input.validate(&call.input, &mut refs)?;
    let invocation = Invocation {
        request_id: call.request_id.clone(),
        action_id: target.feature.id.clone(),
        input: call.input,
        caller_name,
        intent,
    };
    let (tx, rx) = oneshot::channel();
    {
        let mut hub = runtime.interop.lock().map_err(|_| "Chiamate occupate.")?;
        if hub
            .cancelled
            .remove(&(owner.clone(), call.request_id.clone()))
        {
            return Err("Richiesta annullata.".into());
        }
        if hub.pending.len() >= 32 || hub.pending.contains_key(&call.request_id) {
            return Err("Limite chiamate raggiunto o ID duplicato.".into());
        }
        if hub.cyclic(&owner, &target.app_id) {
            return Err("Chiamata ciclica tra app non consentita.".into());
        }
        for id in &refs {
            hub.attachment(id, &owner)?;
        }
        for id in &refs {
            hub.attachments
                .get_mut(id)
                .ok_or("Allegato scaduto.")?
                .grants
                .entry(provider.clone())
                .or_default()
                .calls
                .insert(call.request_id.clone());
        }
        hub.pending.insert(
            call.request_id.clone(),
            Pending {
                caller: owner.clone(),
                provider: provider.clone(),
                invocation: invocation.clone(),
                output: contract.output,
                response: Some(tx),
                input_refs: refs,
                dispatched: false,
            },
        );
    }
    let launch = if interactive {
        apps::launch_feature(
            app.clone(),
            provider.clone(),
            apps::FeatureSession {
                app_id: target.app_id.clone(),
                action_id: target.feature.id.clone(),
                request_id: call.request_id.clone(),
            },
        )
        .await
    } else {
        apps::launch_service(app.clone(), target.app_id.clone(), true).await
    };
    let result = if let Err(error) = launch {
        Err(error)
    } else {
        let send = {
            let mut hub = runtime.interop.lock().map_err(|_| "Chiamate occupate.")?;
            if hub.ready.contains(&provider) {
                if let Some(p) = hub.pending.get_mut(&call.request_id) {
                    let send = !p.dispatched;
                    p.dispatched = true;
                    send
                } else {
                    false
                }
            } else {
                false
            }
        };
        if send {
            if let Some(window) = app.get_webview_window(&format!("app-{provider}")) {
                if let Err(error) = window.eval(format!(
                    "window.dispatchEvent(new CustomEvent('orbit:service',{{detail:{}}}))",
                    json!(invocation)
                )) {
                    closed(&app, &provider);
                    crate::overlay::report(&app, format!("Consegna azione: {error}"));
                }
            }
        }
        match tokio::time::timeout(std::time::Duration::from_secs(180), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("App destinataria non disponibile.".into()),
            Err(_) => Err("Tempo massimo dell'azione superato.".into()),
        }
    };
    let pending = runtime
        .interop
        .lock()
        .map_err(|_| "Chiamate occupate.")?
        .finish(&call.request_id);
    if result.is_err() {
        notify_cancel(&app, &provider, &call.request_id);
    }
    if interactive {
        if let Some(window) = app.get_webview_window(&format!("app-{provider}")) {
            if result.is_err() {
                window.destroy().map_err(|e| e.to_string())?;
            }
        } else {
            runtime
                .features
                .lock()
                .map_err(|_| "Sessioni occupate.")?
                .remove(&provider);
        }
    } else {
        let (in_use, close) = {
            let mut hub = runtime.interop.lock().map_err(|_| "Chiamate occupate.")?;
            let in_use = hub.pending.values().any(|p| p.provider == target.app_id);
            (in_use, !in_use && hub.transient.remove(&target.app_id))
        };
        if close {
            if let Some(window) = app.get_webview_window(&format!("app-{}", target.app_id)) {
                window.destroy().map_err(|e| e.to_string())?;
            }
        }
        if !in_use {
            if let Some(window) = app.get_webview_window(&format!("app-{owner}")) {
                crate::window_geometry::show(&window)?;
                window.set_focus().map_err(|e| e.to_string())?;
            }
        }
    }
    drop(pending);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_access_is_explicit_and_last_release_removes_bytes() {
        let mut hub = Hub::default();
        let image = crate::capture::encode(&image::RgbaImage::new(2, 2)).unwrap();
        let reference = hub.create("capture", image.clone()).unwrap();
        let id = ref_id(&reference).unwrap();
        assert!(hub.attachment(id, "chat").is_err());
        hub.attachments.get_mut(id).unwrap().grants.insert(
            "chat".into(),
            Grant {
                retained: true,
                calls: BTreeSet::new(),
            },
        );
        hub.attachments
            .get_mut(id)
            .unwrap()
            .grants
            .remove("capture");
        assert_eq!(
            hub.attachment(id, "chat").unwrap().capture.data_url,
            image.data_url
        );
        assert!(hub.attachment(id, "feature-chat-one").is_err());
        assert!(hub.attachment(id, "feature-chat-two").is_err());
        hub.attachments
            .get_mut(id)
            .unwrap()
            .grants
            .get_mut("chat")
            .unwrap()
            .retained = false;
        hub.prune();
        assert!(hub.attachments.is_empty());
    }
    #[test]
    fn borrowed_inputs_expire_at_request_completion_unless_retained() {
        let mut hub = Hub::default();
        let reference = hub
            .create(
                "caller",
                crate::capture::encode(&image::RgbaImage::new(2, 2)).unwrap(),
            )
            .unwrap();
        let id = ref_id(&reference).unwrap().to_string();
        hub.attachments.get_mut(&id).unwrap().grants.insert(
            "provider".into(),
            Grant {
                retained: false,
                calls: BTreeSet::from(["request".into()]),
            },
        );
        let (tx, _rx) = oneshot::channel();
        hub.pending.insert(
            "request".into(),
            Pending {
                caller: "caller".into(),
                provider: "provider".into(),
                invocation: Invocation {
                    request_id: "request".into(),
                    action_id: "run".into(),
                    input: json!(null),
                    caller_name: "Caller".into(),
                    intent: contracts::InvocationMode::Service,
                },
                output: Schema::Null,
                response: Some(tx),
                input_refs: vec![id.clone()],
                dispatched: false,
            },
        );
        assert!(hub.cyclic("provider", "caller"));
        assert!(!hub.cyclic("another", "provider"));
        hub.finish("request");
        assert!(hub.attachment(&id, "provider").is_err());
        assert!(hub.attachment(&id, "caller").is_ok());
    }
    #[test]
    fn attachment_limits_and_dimension_checks_are_enforced() {
        let mut hub = Hub::default();
        let mut image = crate::capture::encode(&image::RgbaImage::new(2, 2)).unwrap();
        image.width = 3;
        assert!(hub.create("caller", image.clone()).is_err());
        image.width = 2;
        for _ in 0..32 {
            hub.create("caller", image.clone()).unwrap();
        }
        assert!(hub.create("caller", image).is_err());
    }
}

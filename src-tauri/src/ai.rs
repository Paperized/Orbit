use crate::{
    protocol::{self, Chunk, Message, Provider, Settings},
    settings, AppState,
};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::Serialize;
use std::time::Duration;
use tauri::{ipc::Channel, State};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    request_id: String,
    kind: &'static str,
    text: String,
}

fn request(
    state: &AppState,
    settings: &Settings,
    messages: &[Message],
    streaming: bool,
) -> Result<reqwest::RequestBuilder, String> {
    if settings.model.is_empty() {
        return Err("Configura un modello in Impostazioni > Provider AI.".into());
    }
    let key = settings::get_key(settings)?;
    if key.is_none() && settings.provider != Provider::Compatible {
        return Err("Configura l'API key in Impostazioni > Provider AI.".into());
    }
    build_request(&state.client, settings, key.as_deref(), messages, streaming)
}

fn build_request(
    client: &reqwest::Client,
    settings: &Settings,
    key: Option<&str>,
    messages: &[Message],
    streaming: bool,
) -> Result<reqwest::RequestBuilder, String> {
    let mut request = client
        .post(settings.endpoint())
        .json(&protocol::request_body(settings, messages, streaming));
    if settings.provider == Provider::Anthropic {
        request = request.header("anthropic-version", "2023-06-01");
        if let Some(key) = key {
            request = request.header("x-api-key", key);
        }
    } else if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    Ok(request)
}

async fn successful(response: reqwest::Response) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    // Do not echo remote response bodies: they can contain credentials or submitted images.
    let hint = match status.as_u16() {
        401 | 403 => "Controlla API key e autorizzazioni.",
        404 => "Controlla Base URL e ID modello.",
        400 | 422 => "Controlla modello e supporto immagini/formato API.",
        429 => "Quota o limite di richieste raggiunto.",
        _ => "Il provider non ha completato la richiesta.",
    };
    Err(format!("Provider HTTP {status}. {hint}"))
}

#[tauri::command]
pub async fn test_provider(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Stato impostazioni non disponibile.")?
        .clone();
    let messages = vec![Message {
        role: "user".into(),
        content: "Reply with OK.".into(),
        image: None,
    }];
    let response = request(&state, &settings, &messages, false)?
        .timeout(Duration::from_secs(45))
        .send()
        .await
        .map_err(|_| "Impossibile raggiungere il provider (rete, TLS o timeout).")?;
    let response = successful(response).await?;
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Risposta del provider non valida.")?;
    let has_text = if settings.provider == Provider::Anthropic {
        value["content"].as_array().is_some_and(|blocks| {
            blocks
                .iter()
                .any(|block| block["text"].as_str().is_some_and(|text| !text.is_empty()))
        })
    } else {
        value["choices"][0]["message"]["content"]
            .as_str()
            .is_some_and(|text| !text.is_empty())
    };
    if !has_text {
        return Err("Il provider non ha restituito testo nel formato atteso.".into());
    }
    Ok(format!(
        "Connessione verificata: {}. Test solo testo.",
        settings.model
    ))
}

#[tauri::command]
pub async fn stream_chat(
    state: State<'_, AppState>,
    request_id: String,
    messages: Vec<Message>,
    channel: Channel<StreamEvent>,
) -> Result<(), String> {
    run_chat(
        &state,
        request_id,
        messages,
        channel,
        CancellationToken::new(),
    )
    .await
}

pub async fn run_chat(
    state: &AppState,
    request_id: String,
    messages: Vec<Message>,
    channel: Channel<StreamEvent>,
    token: CancellationToken,
) -> Result<(), String> {
    protocol::validate_messages(&messages)?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| "Stato impostazioni non disponibile.")?
        .clone();
    let request = request(state, &settings, &messages, true)?;
    {
        let mut active = state
            .requests
            .lock()
            .map_err(|_| "Stato richieste non disponibile.")?;
        if !active.is_empty() {
            return Err("Una risposta e gia in corso.".into());
        }
        active.insert(request_id.clone(), token.clone());
    }
    let emit = |kind: &'static str, text: String| {
        channel
            .send(StreamEvent {
                request_id: request_id.clone(),
                kind,
                text,
            })
            .map_err(|_| "La finestra della chat non e piu disponibile.".to_owned())
    };
    let result = run_stream(request, &settings.provider, &token, |text| {
        emit("delta", text)
    })
    .await;
    state
        .requests
        .lock()
        .map_err(|_| "Stato richieste non disponibile.")?
        .remove(&request_id);
    match result {
        Ok(completed) => emit(if completed { "done" } else { "cancelled" }, String::new()),
        Err(error) => {
            emit("error", error.clone())?;
            Err(error)
        }
    }
}

async fn run_stream(
    request: reqwest::RequestBuilder,
    provider: &Provider,
    token: &CancellationToken,
    mut on_text: impl FnMut(String) -> Result<(), String>,
) -> Result<bool, String> {
    tokio::select! {
        biased;
        _ = token.cancelled() => Ok(false),
        result = async {
            let response = request.send().await.map_err(|_| "Connessione al provider non riuscita (rete, TLS o timeout).")?;
            let response = successful(response).await?;
            let mut events = response.bytes_stream().eventsource();
            let mut finished = false;
            let mut received_text = false;
            let mut text_bytes = 0;
            while let Some(event) = events.next().await {
                let event = event.map_err(|_| "Streaming interrotto o formato SSE non valido.")?;
                match protocol::parse_chunk(provider, &event.data)? {
                    Chunk::Text(text) => {
                        text_bytes += text.len();
                        if text_bytes > 2 * 1024 * 1024 { return Err("Risposta troppo grande per la demo (limite 2 MB).".into()); }
                        received_text |= !text.is_empty();
                        on_text(text)?;
                    }
                    Chunk::Done => { finished = true; break; }
                    Chunk::Ignore => {}
                }
            }
            if !finished { return Err("Il provider ha chiuso lo stream senza confermare il completamento.".into()); }
            if !received_text { return Err("Il modello non ha restituito testo. Controlla modello e protocollo.".into()); }
            Ok::<_, String>(true)
        } => result,
    }
}

#[tauri::command]
pub fn cancel_chat(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    let requests = state
        .requests
        .lock()
        .map_err(|_| "Stato richieste non disponibile.")?;
    if let Some(token) = requests.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    async fn mock_server(status: &str, body: &str) -> (String, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let read = socket.read(&mut buffer).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            // Fragment network data, including JSON and UTF-8 code points.
            for part in response.as_bytes().chunks(7) {
                if socket.write_all(part).await.is_err() {
                    break;
                }
                tokio::task::yield_now().await;
            }
            String::from_utf8(request).unwrap()
        });
        (format!("http://{address}/v1"), task)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap()
    }

    fn message() -> Vec<Message> {
        vec![Message {
            role: "user".into(),
            content: "Describe".into(),
            image: Some("data:image/png;base64,YQ==".into()),
        }]
    }

    #[tokio::test]
    async fn openai_http_stream_preserves_images_and_unicode() {
        let (url, server) = mock_server("200 OK", "data: {\"choices\":[{\"delta\":{\"content\":\"Caff\\u00e8 \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"pronto\"}}]}\n\ndata: [DONE]\n\n").await;
        let settings = Settings {
            provider: Provider::Compatible,
            base_url: url,
            model: "vision".into(),
            ..Settings::default()
        };
        let request =
            build_request(&client(), &settings, Some("test-key"), &message(), true).unwrap();
        let mut output = String::new();
        assert!(run_stream(
            request,
            &settings.provider,
            &CancellationToken::new(),
            |text| {
                output.push_str(&text);
                Ok(())
            }
        )
        .await
        .unwrap());
        assert_eq!(output, "Caff\u{e8} pronto");
        let request = server.await.unwrap();
        assert!(request.starts_with("POST /v1/chat/completions "));
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer test-key"));
        let body: serde_json::Value =
            serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(
            body["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,YQ=="
        );
        assert_eq!(body["stream"], true);
    }

    #[tokio::test]
    async fn anthropic_http_headers_and_stream() {
        let (url, server) = mock_server("200 OK", "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n").await;
        let settings = Settings {
            provider: Provider::Anthropic,
            base_url: url,
            model: "claude-test".into(),
            ..Settings::default()
        };
        let request =
            build_request(&client(), &settings, Some("test-key"), &message(), true).unwrap();
        let mut output = String::new();
        assert!(run_stream(
            request,
            &settings.provider,
            &CancellationToken::new(),
            |text| {
                output.push_str(&text);
                Ok(())
            }
        )
        .await
        .unwrap());
        assert_eq!(output, "Hello");
        let request = server.await.unwrap().to_lowercase();
        assert!(request.starts_with("post /v1/messages "));
        assert!(request.contains("anthropic-version: 2023-06-01"));
        assert!(request.contains("x-api-key: test-key"));
        assert!(!request.contains("authorization:"));
    }

    #[tokio::test]
    async fn http_errors_do_not_echo_sensitive_bodies() {
        let (url, server) = mock_server("401 Unauthorized", "secret-provider-body").await;
        let error = run_stream(
            client().post(url),
            &Provider::Openai,
            &CancellationToken::new(),
            |_| Ok(()),
        )
        .await
        .unwrap_err();
        assert!(error.contains("401"));
        assert!(!error.contains("secret-provider-body"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn truncated_stream_is_not_a_success() {
        let (url, server) = mock_server(
            "200 OK",
            "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n",
        )
        .await;
        let error = run_stream(
            client().post(url),
            &Provider::Openai,
            &CancellationToken::new(),
            |_| Ok(()),
        )
        .await
        .unwrap_err();
        assert!(error.contains("senza confermare"));
        server.await.unwrap();
    }

    #[tokio::test]
    async fn cancellation_stops_pending_network_work() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let token = CancellationToken::new();
        let trigger = token.clone();
        let cancel = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            trigger.cancel();
        });
        assert!(!run_stream(
            client().post(format!("http://{address}")),
            &Provider::Openai,
            &token,
            |_| Ok(())
        )
        .await
        .unwrap());
        cancel.await.unwrap();
    }

    #[tokio::test]
    async fn pending_response_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (_socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
        });
        let request = client()
            .post(format!("http://{address}"))
            .timeout(Duration::from_millis(100));
        let result = run_stream(
            request,
            &Provider::Openai,
            &CancellationToken::new(),
            |_| Ok(()),
        )
        .await;
        assert!(result.unwrap_err().contains("timeout"));
        server.abort();
    }

    #[tokio::test]
    async fn redirects_are_not_followed_with_credentials() {
        let (url, server) = mock_server("302 Found", "").await;
        let error = run_stream(
            client().post(url).bearer_auth("private-key"),
            &Provider::Openai,
            &CancellationToken::new(),
            |_| Ok(()),
        )
        .await
        .unwrap_err();
        assert!(error.contains("302"));
        server.await.unwrap();
    }
}

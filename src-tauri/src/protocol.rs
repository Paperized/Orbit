use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Compatible,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub provider: Provider,
    pub base_url: String,
    pub model: String,
    pub agent_enabled: bool,
    pub agent_executable: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: Provider::Openai,
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            agent_enabled: false,
            agent_executable: "opencode".into(),
        }
    }
}

impl Settings {
    pub fn normalize(mut self) -> Result<Self, String> {
        self.base_url = self.base_url.trim().trim_end_matches('/').to_owned();
        self.model = self.model.trim().to_owned();
        self.agent_executable = self.agent_executable.trim().to_owned();
        if self.agent_executable.is_empty() || self.agent_executable.contains(['\n', '\r', '\0']) {
            return Err("Indica un eseguibile OpenCode valido, senza argomenti.".into());
        }
        match self.provider {
            Provider::Openai => self.base_url = "https://api.openai.com/v1".into(),
            Provider::Anthropic => self.base_url = "https://api.anthropic.com/v1".into(),
            Provider::Compatible => validate_endpoint(&self.base_url)?,
        }
        if self.model.len() > 200 || self.model.contains(['\n', '\r', '\0']) {
            return Err("ID modello non valido.".into());
        }
        Ok(self)
    }

    pub fn endpoint(&self) -> String {
        format!(
            "{}/{}",
            self.base_url,
            if self.provider == Provider::Anthropic {
                "messages"
            } else {
                "chat/completions"
            }
        )
    }
}

pub fn validate_endpoint(endpoint: &str) -> Result<(), String> {
    let url = Url::parse(endpoint).map_err(|_| "Base URL non valida.")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("Usa HTTPS, oppure HTTP esclusivamente su localhost/127.0.0.1/[::1].".into());
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("La Base URL non deve contenere credenziali, query o frammenti.".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub image: Option<String>,
}

pub fn validate_messages(messages: &[Message]) -> Result<(), String> {
    if messages.is_empty() || messages.len() > 100 {
        return Err(
            "La conversazione deve contenere da 1 a 100 messaggi. Apri una nuova chat.".into(),
        );
    }
    let mut total = 0usize;
    for message in messages {
        if !matches!(message.role.as_str(), "user" | "assistant")
            || message.content.trim().is_empty()
        {
            return Err("Messaggio non valido.".into());
        }
        if message.content.len() > 80_000 {
            return Err("Messaggio troppo lungo.".into());
        }
        total += message.content.len() + message.image.as_ref().map_or(0, String::len);
        if let Some(image) = &message.image {
            if message.role != "user" || !image.starts_with("data:image/png;base64,") {
                return Err("Formato immagine non supportato: usa una cattura PNG.".into());
            }
        }
    }
    if total > 24 * 1024 * 1024 {
        return Err("Conversazione troppo grande. Apri una nuova chat.".into());
    }
    Ok(())
}

pub fn request_body(settings: &Settings, messages: &[Message], stream: bool) -> Value {
    let mapped: Vec<Value> = messages
        .iter()
        .map(|message| {
            let content = match (&settings.provider, &message.image) {
                (Provider::Anthropic, Some(image)) => json!([
                    { "type": "image", "source": { "type": "base64", "media_type": "image/png",
                        "data": image.trim_start_matches("data:image/png;base64,") } },
                    { "type": "text", "text": message.content }
                ]),
                (Provider::Anthropic, None) => json!([{ "type": "text", "text": message.content }]),
                (_, Some(image)) => json!([
                    { "type": "text", "text": message.content },
                    { "type": "image_url", "image_url": { "url": image } }
                ]),
                (_, None) => json!(message.content),
            };
            json!({ "role": message.role, "content": content })
        })
        .collect();
    let mut body = json!({ "model": settings.model, "messages": mapped, "stream": stream });
    if settings.provider == Provider::Anthropic {
        body["max_tokens"] = json!(4096);
    }
    body
}

#[derive(Debug, PartialEq)]
pub enum Chunk {
    Text(String),
    Done,
    Ignore,
}

pub fn parse_chunk(provider: &Provider, data: &str) -> Result<Chunk, String> {
    if data == "[DONE]" {
        return Ok(Chunk::Done);
    }
    let value: Value = serde_json::from_str(data)
        .map_err(|_| "Il provider ha inviato un evento JSON non valido.")?;
    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Errore del provider.");
        return Err(message.chars().take(600).collect());
    }
    if *provider == Provider::Anthropic {
        match value["type"].as_str() {
            Some("content_block_delta") => {
                if let Some(text) = value["delta"]["text"].as_str() {
                    return Ok(Chunk::Text(text.to_owned()));
                }
            }
            Some("message_stop") => return Ok(Chunk::Done),
            Some("message_delta") if value["delta"]["stop_reason"] == "max_tokens" => {
                return Err(
                    "Il modello ha raggiunto il limite di output. Chiedi di continuare.".into(),
                );
            }
            _ => {}
        }
    } else {
        if value["choices"][0]["finish_reason"] == "length" {
            return Err(
                "Il modello ha raggiunto il limite di output. Chiedi di continuare.".into(),
            );
        }
        if let Some(text) = value["choices"][0]["delta"]["content"].as_str() {
            return Ok(Chunk::Text(text.to_owned()));
        }
    }
    Ok(Chunk::Ignore)
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

pub fn validate_rect(rect: Rect, width: u32, height: u32) -> Result<(), String> {
    if rect.width == 0
        || rect.height == 0
        || rect
            .x
            .checked_add(rect.width)
            .is_none_or(|right| right > width)
        || rect
            .y
            .checked_add(rect.height)
            .is_none_or(|bottom| bottom > height)
    {
        return Err("Selezione fuori dai limiti dell'immagine.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_reject_remote_http_and_embedded_credentials() {
        for endpoint in [
            "http://example.org/v1",
            "https://key@example.org",
            "https://example.org?key=x",
            "file:///tmp/a",
        ] {
            assert!(validate_endpoint(endpoint).is_err(), "{endpoint}");
        }
        for endpoint in [
            "https://example.org/v1",
            "http://localhost:11434/v1",
            "http://127.0.0.1:8080",
            "http://[::1]:8080",
        ] {
            assert!(validate_endpoint(endpoint).is_ok(), "{endpoint}");
        }
    }

    #[test]
    fn provider_endpoints_cannot_be_overridden() {
        let settings = Settings {
            base_url: "https://other.invalid".into(),
            ..Settings::default()
        }
        .normalize()
        .unwrap();
        assert_eq!(
            settings.endpoint(),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn image_payloads_preserve_context_for_both_protocols() {
        let messages = vec![Message {
            role: "user".into(),
            content: "Explain".into(),
            image: Some("data:image/png;base64,YQ==".into()),
        }];
        let mut settings = Settings::default();
        let openai = request_body(&settings, &messages, true);
        assert_eq!(
            openai["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,YQ=="
        );
        settings.provider = Provider::Anthropic;
        let anthropic = request_body(&settings, &messages, true);
        assert_eq!(
            anthropic["messages"][0]["content"][0]["source"]["data"],
            "YQ=="
        );
        assert_eq!(anthropic["messages"][0]["content"][1]["text"], "Explain");
        assert_eq!(anthropic["max_tokens"], 4096);
    }

    #[test]
    fn streaming_handles_both_providers_and_errors() {
        assert_eq!(
            parse_chunk(
                &Provider::Openai,
                r#"{"choices":[{"delta":{"content":"hello"}}]}"#
            )
            .unwrap(),
            Chunk::Text("hello".into())
        );
        assert_eq!(
            parse_chunk(
                &Provider::Anthropic,
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"ciao"}}"#
            )
            .unwrap(),
            Chunk::Text("ciao".into())
        );
        assert_eq!(
            parse_chunk(&Provider::Openai, "[DONE]").unwrap(),
            Chunk::Done
        );
        assert_eq!(
            parse_chunk(&Provider::Anthropic, r#"{"type":"message_stop"}"#).unwrap(),
            Chunk::Done
        );
        assert!(parse_chunk(
            &Provider::Anthropic,
            r#"{"type":"error","error":{"message":"overloaded"}}"#
        )
        .is_err());
        assert!(parse_chunk(&Provider::Openai, "bad json").is_err());
    }

    #[test]
    fn crop_checks_bounds_and_integer_overflow() {
        assert!(validate_rect(
            Rect {
                x: 10,
                y: 20,
                width: 100,
                height: 80
            },
            200,
            200
        )
        .is_ok());
        for rect in [
            Rect {
                x: 0,
                y: 0,
                width: 0,
                height: 10,
            },
            Rect {
                x: 190,
                y: 0,
                width: 20,
                height: 20,
            },
            Rect {
                x: u32::MAX,
                y: 0,
                width: 20,
                height: 20,
            },
        ] {
            assert!(validate_rect(rect, 200, 200).is_err());
        }
    }

    #[test]
    fn validates_chat_roles_and_image_type() {
        assert!(validate_messages(&[]).is_err());
        assert!(validate_messages(&[Message {
            role: "system".into(),
            content: "test".into(),
            image: None
        }])
        .is_err());
        assert!(validate_messages(&[Message {
            role: "user".into(),
            content: "test".into(),
            image: Some("http://remote/image".into())
        }])
        .is_err());
    }
}

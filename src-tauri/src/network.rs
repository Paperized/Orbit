use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Network {
    #[serde(default)]
    pub connect: Vec<String>,
}

impl Network {
    pub fn validate(&self) -> Result<(), String> {
        if self.connect.len() > 32 {
            return Err("Massimo 32 origini di rete per app.".into());
        }
        for (index, origin) in self.connect.iter().enumerate() {
            let parsed = url::Url::parse(origin).map_err(|_| "Origine di rete non valida.")?;
            let domain = match parsed.host() {
                Some(url::Host::Domain(domain)) => domain,
                _ => {
                    return Err(
                        "La rete richiede un nome di dominio HTTPS/WSS, non un indirizzo IP."
                            .into(),
                    )
                }
            };
            if origin.len() > 300
                || !matches!(parsed.scheme(), "https" | "wss")
                || parsed.origin().ascii_serialization() != *origin
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || parsed.path() != "/"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
                || domain.ends_with('.')
                || !domain.contains('.')
                || domain.split('.').any(|part| {
                    part.is_empty()
                        || part.starts_with('-')
                        || part.ends_with('-')
                        || !part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                })
                || ["localhost", "local", "internal", "lan", "home", "arpa"]
                    .iter()
                    .any(|suffix| domain == *suffix || domain.ends_with(&format!(".{suffix}")))
                || domain.starts_with("orbitapp.")
                || self.connect[..index].contains(origin)
            {
                return Err("Dichiara origini HTTPS/WSS esatte (schema, dominio e porta opzionale), senza percorsi, wildcard, duplicati o nomi locali.".into());
            }
        }
        Ok(())
    }
}

pub fn policy(network: &Network) -> Result<String, String> {
    network.validate()?;
    let extra = network.connect.join(" ");
    Ok(format!("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ipc: http://ipc.localhost https://ipc.localhost {extra}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; font-src 'self'"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permits_only_exact_secure_origins() {
        for origin in ["https://api.example.com", "wss://events.example.com:8443"] {
            assert!(Network {
                connect: vec![origin.into()]
            }
            .validate()
            .is_ok());
        }
        for origin in [
            "*",
            "https:",
            "http://api.example.com",
            "ws://events.example.com",
            "https://*.example.com",
            "https://api.example.com/",
            "https://api.example.com/data",
            "https://user:pass@api.example.com",
            "https://api.example.com?x=1",
            "https://api.example.com#x",
            "https://api.example.com;script-src *",
            "https://api.example.com\n",
            "https://API.example.com",
            "https://api.example.com:443",
            "https://localhost",
            "https://ipc.localhost",
            "https://127.0.0.1",
            "https://[::1]",
            "https://192.168.1.1",
            "https://2130706433",
            "https://printer.local",
            "https://router.home.arpa",
            "https://orbitapp.other",
            "https://api.example.com.",
        ] {
            assert!(
                Network {
                    connect: vec![origin.into()]
                }
                .validate()
                .is_err(),
                "{origin}"
            );
        }
        assert!(Network {
            connect: vec!["https://api.example.com".into(); 2]
        }
        .validate()
        .is_err());
        assert!(Network {
            connect: (0..33)
                .map(|i| format!("https://api{i}.example.com"))
                .collect()
        }
        .validate()
        .is_err());
    }

    #[test]
    fn networking_does_not_enable_remote_code_or_other_resources() {
        let policy = policy(&Network {
            connect: vec!["https://api.example.com".into()],
        })
        .unwrap();
        let directives: Vec<_> = policy.split("; ").collect();
        assert!(directives.contains(&"script-src 'self'"));
        assert!(directives.contains(&"worker-src 'none'"));
        assert!(directives.contains(&"img-src 'self' data:"));
        assert!(directives.contains(&"form-action 'none'"));
        assert_eq!(policy.matches("https://api.example.com").count(), 1);
        assert!(!policy.contains("unsafe-eval"));
        assert!(!super::policy(&Network::default())
            .unwrap()
            .contains("https://api.example.com"));
    }
}

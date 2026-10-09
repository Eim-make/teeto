pub mod discover;
pub mod models;
pub mod ws;

use base64::Engine;
use serde::de::DeserializeOwned;

use crate::error::{Error, Result};
pub use discover::Credentials;

#[derive(Clone)]
pub struct LcuClient {
    http: reqwest::Client,
    creds: Credentials,
}

impl LcuClient {
    pub fn new(creds: Credentials) -> Result<Self> {
        let http = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        Ok(Self { http, creds })
    }

    pub fn credentials(&self) -> &Credentials {
        &self.creds
    }

    pub fn auth_header(&self) -> String {
        basic_auth(&self.creds.token)
    }

    pub async fn send(&self, method: reqwest::Method, path: &str, body: Option<&serde_json::Value>) -> Result<()> {
        let url = format!("https://127.0.0.1:{}{}", self.creds.port, path);
        let mut req = self.http.request(method, url).header("Authorization", self.auth_header());
        if let Some(body) = body {
            req = req.json(body);
        }
        let res = req.send().await?;
        if !res.status().is_success() {
            return Err(Error::Status(res.status().as_u16()));
        }
        Ok(())
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let url = format!("https://127.0.0.1:{}{}", self.creds.port, path);
        let res = self.http.get(url).header("Authorization", self.auth_header()).send().await?;
        if !res.status().is_success() {
            return Err(Error::Status(res.status().as_u16()));
        }
        Ok(res.json().await?)
    }
}

pub fn basic_auth(token: &str) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(format!("riot:{token}"));
    format!("Basic {encoded}")
}

use futures_util::{SinkExt, Stream, StreamExt};
use serde::Deserialize;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;

use super::LcuClient;
use crate::error::Result;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LcuEvent {
    pub uri: String,
    #[serde(default)]
    pub event_type: String,
    #[serde(default)]
    pub data: serde_json::Value,
}

pub async fn subscribe(client: &LcuClient, topics: &[&str]) -> Result<impl Stream<Item = LcuEvent>> {
    let url = format!("wss://127.0.0.1:{}/", client.credentials().port);
    let mut request = url.into_client_request()?;
    request.headers_mut().insert("Authorization", HeaderValue::from_str(&client.auth_header())?);

    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()?;
    let (mut socket, _) =
        tokio_tungstenite::connect_async_tls_with_config(request, None, false, Some(Connector::NativeTls(tls)))
            .await?;

    for topic in topics {
        socket.send(Message::text(format!("[5,\"{topic}\"]"))).await?;
    }

    Ok(socket.filter_map(|msg| async move {
        match msg {
            Ok(Message::Text(text)) => parse(&text),
            _ => None,
        }
    }))
}

fn parse(text: &str) -> Option<LcuEvent> {
    let (opcode, _topic, payload): (u8, String, LcuEvent) = serde_json::from_str(text).ok()?;
    (opcode == 8).then_some(payload)
}

pub fn topic(path: &str) -> String {
    format!("OnJsonApiEvent{}", path.replace('/', "_"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_event_frames() {
        let frame = r#"[8,"OnJsonApiEvent",{"data":"InProgress","eventType":"Update","uri":"/lol-gameflow/v1/gameflow-phase"}]"#;
        let e = parse(frame).unwrap();
        assert_eq!(e.uri, "/lol-gameflow/v1/gameflow-phase");
        assert_eq!(e.data, serde_json::json!("InProgress"));
        assert!(parse("").is_none());
        assert!(parse(r#"[0,"x",{}]"#).is_none());
    }

    #[test]
    fn builds_topics() {
        assert_eq!(topic("/lol-gameflow/v1/gameflow-phase"), "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase");
    }
}

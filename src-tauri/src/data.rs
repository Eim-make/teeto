use std::time::Duration;

use crate::error::{Error, Result};

const PUBLIC_DATA: &str = "https://cdn.jsdelivr.net/gh/Eim-make/teeto@data";

fn valid_data_path(path: &str) -> bool {
    path.ends_with(".json")
        && !path.contains("..")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_'))
}

pub async fn data_file(path: &str) -> Result<serde_json::Value> {
    if !valid_data_path(path) {
        return Err(Error::Server(format!("bad data path {path}")));
    }
    let http = reqwest::Client::builder().timeout(Duration::from_secs(20)).build()?;
    let res = http.get(format!("{PUBLIC_DATA}/{path}")).send().await?;
    if !res.status().is_success() {
        return Err(Error::Server(format!("{} loading {path}", res.status().as_u16())));
    }
    Ok(res.json().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_paths_are_restricted() {
        assert!(valid_data_path("16.20/tierlist.json"));
        assert!(valid_data_path("patches/26.20.json"));
        assert!(!valid_data_path("../secret.json"));
        assert!(!valid_data_path("index.html"));
        assert!(!valid_data_path("a b.json"));
    }
}

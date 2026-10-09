use reqwest::Method;
use serde::Deserialize;
use serde_json::json;

use crate::error::{Error, Result};
use crate::lcu::LcuClient;

const PREFIX: &str = "Teeto";
const TOOL_PREFIXES: [&str; 6] = ["Teeto", "OP.GG", "U.GG", "Blitz", "Mobalytics", "Porofessor"];
const DEFAULT_SHARDS: [i32; 3] = [5008, 5008, 5011];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    id: i64,
    name: String,
    #[serde(default)]
    is_deletable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Inventory {
    can_add_custom_page: bool,
}

fn generated_by_tool(name: &str) -> bool {
    TOOL_PREFIXES.iter().any(|p| name.starts_with(p))
}

fn page_to_replace(pages: &[Page], can_add: bool) -> Option<Option<i64>> {
    let deletable = || pages.iter().filter(|p| p.is_deletable);
    if let Some(own) = deletable().find(|p| p.name.starts_with(PREFIX)) {
        return Some(Some(own.id));
    }
    if can_add {
        return Some(None);
    }
    deletable().find(|p| generated_by_tool(&p.name)).map(|p| Some(p.id))
}

pub fn selected_perks(perks: &[i32], shards: &[i32]) -> Vec<i32> {
    let shards = if shards.len() == 3 { shards } else { &DEFAULT_SHARDS[..] };
    perks.iter().take(6).chain(shards).copied().collect()
}

pub async fn import(client: &LcuClient, name: &str, primary: i32, sub: i32, perks: &[i32], shards: &[i32]) -> Result<()> {
    let pages: Vec<Page> = client.get("/lol-perks/v1/pages").await?;
    let inventory: Inventory = client.get("/lol-perks/v1/inventory").await?;
    let Some(replace) = page_to_replace(&pages, inventory.can_add_custom_page) else {
        return Err(Error::Server(
            "all your rune pages are your own. Delete one, or rename it to start with \"Teeto\" so Teeto can reuse it".into(),
        ));
    };
    if let Some(id) = replace {
        client.send(Method::DELETE, &format!("/lol-perks/v1/pages/{id}"), None).await?;
    }
    let body = json!({
        "name": format!("{PREFIX}: {name}"),
        "primaryStyleId": primary,
        "subStyleId": sub,
        "selectedPerkIds": selected_perks(perks, shards),
        "current": true,
    });
    client.send(Method::POST, "/lol-perks/v1/pages", Some(&body)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(id: i64, name: &str) -> Page {
        Page { id, name: name.into(), is_deletable: true }
    }

    #[test]
    fn picks_page_to_replace() {
        assert_eq!(page_to_replace(&[page(1, "Mine"), page(2, "Teeto: Fiora")], false), Some(Some(2)));
        assert_eq!(page_to_replace(&[page(1, "Mine")], true), Some(None));
        assert_eq!(page_to_replace(&[page(1, "Mine"), page(2, "U.GG - Caitlyn")], false), Some(Some(2)));
        assert_eq!(page_to_replace(&[page(1, "Mine"), page(2, "Also mine")], false), None);
    }

    #[test]
    fn fills_missing_shards() {
        assert_eq!(selected_perks(&[1, 2, 3, 4, 5, 6], &[]), vec![1, 2, 3, 4, 5, 6, 5008, 5008, 5011]);
        assert_eq!(selected_perks(&[1, 2, 3, 4, 5, 6], &[7, 8, 9]), vec![1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
}

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credentials {
    pub port: u16,
    pub token: String,
}

const UX_PROCESS: &str = "LeagueClientUx.exe";
const FALLBACK_DIRS: [&str; 2] = [r"C:\Riot Games\League of Legends", r"D:\Riot Games\League of Legends"];

pub fn find() -> Option<Credentials> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always),
    );
    let process = sys.processes_by_exact_name(OsStr::new(UX_PROCESS)).next()?;

    let args: Vec<String> = process.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect();
    if let Some(creds) = from_args(&args) {
        return Some(creds);
    }

    let dirs = process
        .exe()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .into_iter()
        .chain(FALLBACK_DIRS.iter().map(PathBuf::from));
    dirs.filter_map(|dir| std::fs::read_to_string(dir.join("lockfile")).ok())
        .find_map(|content| from_lockfile(&content))
}

fn from_args(args: &[String]) -> Option<Credentials> {
    let value = |name: &str| {
        let prefix = format!("--{name}=");
        args.iter().find_map(|a| a.trim_matches('"').strip_prefix(&prefix).map(str::to_owned))
    };
    Some(Credentials {
        port: value("app-port")?.parse().ok()?,
        token: value("remoting-auth-token")?,
    })
}

fn from_lockfile(content: &str) -> Option<Credentials> {
    let mut parts = content.trim().split(':');
    let _name = parts.next()?;
    let _pid = parts.next()?;
    let port = parts.next()?.parse().ok()?;
    let token = parts.next()?.to_owned();
    Some(Credentials { port, token })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_args() {
        let args = vec![
            "LeagueClientUx.exe".to_owned(),
            "\"--remoting-auth-token=abc123\"".to_owned(),
            "--app-port=51234".to_owned(),
        ];
        assert_eq!(from_args(&args), Some(Credentials { port: 51234, token: "abc123".into() }));
    }

    #[test]
    fn reads_lockfile() {
        assert_eq!(
            from_lockfile("LeagueClient:1234:50000:tok:https"),
            Some(Credentials { port: 50000, token: "tok".into() })
        );
        assert_eq!(from_lockfile("garbage"), None);
    }
}

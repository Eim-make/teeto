import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { native } from "../lib/ipc";
import { useUpdater, type UpdateState } from "./useUpdater";

const win = native ? getCurrentWindow() : null;

function Control({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`flex h-9 w-11 items-center justify-center text-muted transition-colors ${
        danger
          ? "hover:bg-crimson hover:text-white"
          : "hover:bg-ink-800 hover:text-fg"
      }`}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
      >
        {children}
      </svg>
    </button>
  );
}

function updateLabel(state: UpdateState): string | null {
  switch (state.kind) {
    case "checking":
      return "Checking for updates…";
    case "current":
      return "Up to date";
    case "downloading":
      return `Downloading ${state.version}${state.progress !== null ? ` · ${Math.round(state.progress * 100)}%` : "…"}`;
    case "installing":
      return `Installing ${state.version}…`;
    case "failed":
      return "Update check failed";
    default:
      return null;
  }
}

export function TitleBar() {
  const updater = useUpdater();
  const notice = updateLabel(updater.state);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (native) getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);
  return (
    <header
      data-tauri-drag-region
      className="flex h-9 shrink-0 items-center border-b border-line bg-ink-900"
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 pl-3 text-xs tracking-wide text-muted"
      >
        <span className="h-2 w-2 rounded-full bg-crimson" />
        Teeto
        {version && (
          <button
            onClick={updater.check}
            title={updater.state.kind === "failed" ? updater.state.message : "Check for updates"}
            className="cursor-pointer text-faint hover:text-soft"
          >
            {version}
          </button>
        )}
        {notice && <span className="text-faint">{notice}</span>}
        {updater.state.kind === "ready" && (
          <button
            onClick={() => void updater.install()}
            className="cursor-pointer rounded bg-crimson px-2 py-0.5 text-white hover:bg-crimson-bright"
          >
            Restart to update to {updater.state.version}
          </button>
        )}
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <Control label="Minimize" onClick={() => win?.minimize()}>
        <path d="M1 5h8" />
      </Control>
      <Control label="Maximize" onClick={() => win?.toggleMaximize()}>
        <rect x="1" y="1" width="8" height="8" />
      </Control>
      <Control label="Close to tray" onClick={() => win?.hide()} danger>
        <path d="M1 1l8 8M9 1l-8 8" />
      </Control>
    </header>
  );
}

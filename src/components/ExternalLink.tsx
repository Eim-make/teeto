import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { native } from "../lib/ipc";

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        if (!native) return;
        e.preventDefault();
        void openUrl(href);
      }}
      className="underline hover:text-soft"
    >
      {children}
    </a>
  );
}

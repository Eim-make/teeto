import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { native } from "../lib/ipc";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "downloading"; version: string; progress: number | null }
  | { kind: "ready"; version: string }
  | { kind: "installing"; version: string }
  | { kind: "failed"; message: string };

const FIRST_CHECK = 5_000;
const CHECK_EVERY = 4 * 3_600_000;
const NOTICE_FOR = 4_000;

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const pending = useRef<Update | null>(null);
  const busy = useRef(false);

  const run = useCallback(async (manual: boolean) => {
    if (!native || busy.current || pending.current) return;
    busy.current = true;
    if (manual) setState({ kind: "checking" });
    try {
      const update = await check();
      if (!update) {
        if (manual) {
          setState({ kind: "current" });
          setTimeout(() => setState((s) => (s.kind === "current" ? { kind: "idle" } : s)), NOTICE_FOR);
        }
        return;
      }
      let total = 0;
      let done = 0;
      setState({ kind: "downloading", version: update.version, progress: null });
      await update.download((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        if (e.event === "Progress") {
          done += e.data.chunkLength;
          setState({ kind: "downloading", version: update.version, progress: total ? done / total : null });
        }
      });
      pending.current = update;
      setState({ kind: "ready", version: update.version });
    } catch (err) {
      if (manual) setState({ kind: "failed", message: String(err) });
      else setState({ kind: "idle" });
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void run(false), FIRST_CHECK);
    const every = setInterval(() => void run(false), CHECK_EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [run]);

  const install = useCallback(async () => {
    const update = pending.current;
    if (!update) return;
    setState({ kind: "installing", version: update.version });
    try {
      await update.install();
      await relaunch();
    } catch (err) {
      setState({ kind: "failed", message: String(err) });
    }
  }, []);

  return { state, check: () => void run(true), install };
}

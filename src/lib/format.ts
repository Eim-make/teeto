import type { Queue } from "./bindings/Queue";

const PHASES: Record<string, string> = {
  None: "Idle",
  Lobby: "In lobby",
  Matchmaking: "In queue",
  ReadyCheck: "Match found",
  ChampSelect: "Champ select",
  GameStart: "Loading in",
  InProgress: "In game",
  Reconnect: "Reconnect needed",
  WaitingForStats: "Post game",
  PreEndOfGame: "Post game",
  EndOfGame: "Post game",
};

const QUEUES: Record<number, string> = {
  400: "Normal draft",
  420: "Ranked solo",
  430: "Normal blind",
  440: "Ranked flex",
  450: "ARAM",
  480: "Swiftplay",
  490: "Quickplay",
  700: "Clash",
  900: "URF",
  1700: "Arena",
  1900: "URF",
  2400: "ARAM Mayhem",
};

export const phaseLabel = (phase: string) => PHASES[phase] ?? phase;
export const queueLabel = (id: number) => QUEUES[id] ?? "Other";

export function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export const DAY = 86_400_000;

export const QUEUE_OPTIONS: { value: Queue; label: string }[] = [
  { value: "solo", label: "Solo/Duo" },
  { value: "flex", label: "Flex" },
];

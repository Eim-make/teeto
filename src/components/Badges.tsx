import type { Badge } from "../lib/bindings/Badge";
import type { PlayerBadge } from "../lib/bindings/PlayerBadge";

type Tone = "good" | "bad" | "neutral";

const MATCH: Record<Badge, { label: string; tip: string; tone: Tone }> = {
  mvp: {
    label: "MVP",
    tip: "Best performance on the winning team",
    tone: "good",
  },
  ace: {
    label: "ACE",
    tip: "Best performance on the losing team",
    tone: "neutral",
  },
  penta: { label: "Penta", tip: "Got a pentakill", tone: "good" },
  quadra: { label: "Quadra", tip: "Got a quadra kill", tone: "good" },
  unkillable: {
    label: "Unkillable",
    tip: "No deaths in a full-length game",
    tone: "good",
  },
  firstBlood: {
    label: "First blood",
    tip: "Took first blood",
    tone: "neutral",
  },
  topDamage: {
    label: "Most damage",
    tip: "Dealt the most damage to champions",
    tone: "neutral",
  },
  vision: {
    label: "Vision",
    tip: "Highest vision score in the game",
    tone: "neutral",
  },
  farmer: { label: "Farmer", tip: "8.5+ CS per minute", tone: "neutral" },
  tank: {
    label: "Tank",
    tip: "Took the most damage in the game",
    tone: "neutral",
  },
  teamplayer: {
    label: "Teamplayer",
    tip: "In on 70%+ of the team's kills",
    tone: "neutral",
  },
};

const PLAYER: Record<PlayerBadge, { label: string; tip: string; tone: Tone }> =
  {
    hotStreak: {
      label: "On fire",
      tip: "Won their last 3+ games",
      tone: "good",
    },
    main: {
      label: "Main",
      tip: "Most of their recent games are on this champion",
      tone: "good",
    },
  expert: { label: "Expert", tip: "100k+ mastery points on this champion", tone: "good" },
    highWinRate: {
      label: "Winning",
      tip: "60%+ win rate this season",
      tone: "good",
    },
    veteran: {
      label: "Veteran",
      tip: "400+ ranked games this season",
      tone: "neutral",
    },
  };

const TONE: Record<Tone, string> = {
  good: "border-win/40 text-win",
  bad: "border-crimson/50 text-crimson-bright",
  neutral: "border-line-strong text-soft",
};

function Pill({
  label,
  tip,
  tone,
}: {
  label: string;
  tip: string;
  tone: Tone;
}) {
  return (
    <span
      title={tip}
      className={`rounded border px-1.5 py-px text-[11px] leading-4 whitespace-nowrap ${TONE[tone]}`}
    >
      {label}
    </span>
  );
}

export function MatchBadges({
  badges,
  max,
}: {
  badges: Badge[];
  max?: number;
}) {
  if (!badges.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.slice(0, max).map((b) => (
        <Pill key={b} {...MATCH[b]} />
      ))}
    </div>
  );
}

export function PlayerBadges({ badges }: { badges: PlayerBadge[] }) {
  if (!badges.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <Pill key={b} {...PLAYER[b]} />
      ))}
    </div>
  );
}

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
  comeback: { label: "Comeback", tip: "Won after being 5k+ gold behind", tone: "good" },
  wireToWire: { label: "Wire to wire", tip: "Your team led in gold the whole game", tone: "good" },
  bigBrain: { label: "Big brain", tip: "Took Baron or a dragon while behind in gold", tone: "good" },
  cleanLaning: { label: "Clean laning", tip: "No deaths before 14:00", tone: "neutral" },
  demolisher: { label: "Demolisher", tip: "Most damage to towers", tone: "neutral" },
  lockdown: { label: "Lockdown", tip: "Most time crowd-controlling enemies", tone: "neutral" },
  ironWall: { label: "Iron wall", tip: "Most damage blocked", tone: "neutral" },
  wardHunter: { label: "Ward hunter", tip: "Destroyed the most wards", tone: "neutral" },
  bargainBin: { label: "Bargain bin", tip: "Most champion damage per gold earned", tone: "neutral" },
  speedrun: { label: "Speedrun", tip: "Won in under 20 minutes", tone: "good" },
  marathon: { label: "Marathon", tip: "Game went past 40 minutes", tone: "neutral" },
  nightOwl: { label: "Night owl", tip: "Finished between 3 and 6 in the morning", tone: "neutral" },
  grinder: { label: "Grinder", tip: "Your 10th+ game of the day", tone: "neutral" },
  bounceBack: { label: "Bounce back", tip: "Won right after 3 losses in a row", tone: "good" },
  pocketPick: { label: "Pocket pick", tip: "Won on a champion you'd never played before", tone: "good" },
  heartbreaker: { label: "Heartbreaker", tip: "Lost after leading by 5k+ gold", tone: "bad" },
  grayScreen: { label: "Gray screen enjoyer", tip: "Died 10+ times", tone: "bad" },
  generous: { label: "Generous", tip: "Gave up first blood", tone: "bad" },
  pacifist: { label: "Pacifist", tip: "No kills in a 20+ minute game", tone: "bad" },
  wardrobeEmpty: { label: "Wardrobe empty", tip: "No wards placed in a 20+ minute game", tone: "bad" },
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
    coldStreak: { label: "Cold streak", tip: "Lost their last 3+ games", tone: "neutral" },
    newToChamp: { label: "New to champ", tip: "Under 2k mastery points on this champion", tone: "neutral" },
    fewRankedGames: { label: "Few ranked games", tip: "Under 10 ranked games this season", tone: "neutral" },
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

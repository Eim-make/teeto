import type { ReactNode } from "react";

export type Section =
  | "home"
  | "live"
  | "matches"
  | "lp"
  | "champions"
  | "patches"
  | "widgets";

interface Item {
  page: Section;
  label: string;
  icon: ReactNode;
}

const TOP: Item[] = [
  {
    page: "home",
    label: "Home",
    icon: <path d="M3 10.5 10 4l7 6.5M5 9v7h10V9" />,
  },
  {
    page: "live",
    label: "Live game",
    icon: (
      <>
        <circle cx="10" cy="10" r="2" />
        <path d="M6.2 13.8a5.4 5.4 0 0 1 0-7.6m7.6 0a5.4 5.4 0 0 1 0 7.6M3.6 16.4a9 9 0 0 1 0-12.8m12.8 0a9 9 0 0 1 0 12.8" />
      </>
    ),
  },
  {
    page: "matches",
    label: "Matches",
    icon: <path d="M4 5h12M4 10h12M4 15h8" />,
  },
  {
    page: "lp",
    label: "LP history",
    icon: <path d="M3 15l4.5-5 3.5 3 6-7M13 6h4v4" />,
  },
  {
    page: "champions",
    label: "Champions",
    icon: <path d="M4 16V9m4 7V4m4 12v-5m4 5V7" />,
  },
  {
    page: "patches",
    label: "Patch notes",
    icon: <path d="M6 3h6l3 3v11H6zM12 3v3h3M8.5 10h4M8.5 13h4" />,
  },
  {
    page: "widgets",
    label: "In-game widgets",
    icon: (
      <>
        <rect x="3" y="4" width="14" height="12" rx="1.5" />
        <path d="M6 7h4M6 13h3M12.5 11.5h2.5v2.5h-2.5z" />
      </>
    ),
  },
];

function NavButton({
  item,
  active,
  onClick,
}: {
  item: Item;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={item.label}
      aria-label={item.label}
      onClick={onClick}
      className={`relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg transition-colors ${
        active
          ? "bg-ink-800 text-fg"
          : "text-faint hover:bg-ink-850 hover:text-soft"
      }`}
    >
      {active && <span className="absolute -left-2 h-5 w-[2px] bg-crimson" />}
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {item.icon}
      </svg>
    </button>
  );
}

export function Sidebar({
  page,
  onNavigate,
}: {
  page: Section;
  onNavigate: (p: Section) => void;
}) {
  const render = (item: Item) => (
    <NavButton
      key={item.page}
      item={item}
      active={item.page === page}
      onClick={() => onNavigate(item.page)}
    />
  );
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-ink-900 py-3">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-crimson text-[13px] font-semibold text-white">
        T
      </div>
      {TOP.map(render)}
    </nav>
  );
}

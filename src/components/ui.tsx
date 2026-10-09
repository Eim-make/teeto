import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-ink-850 p-4 ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-[13px] font-medium">{children}</h2>
      <div className="flex-1" />
      {aside}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Panel className="min-w-0">
      <div className="text-muted">{label}</div>
      <div className="tabular mt-1 truncate text-lg font-medium">{value}</div>
      {sub && <div className="mt-0.5 truncate text-muted">{sub}</div>}
    </Panel>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-3">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`cursor-pointer border-b-[1.5px] pb-0.5 transition-colors ${
            o.value === value
              ? "border-crimson text-fg"
              : "border-transparent text-muted hover:text-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <div className="font-medium">{title}</div>
      <div className="max-w-sm text-muted">{body}</div>
    </div>
  );
}

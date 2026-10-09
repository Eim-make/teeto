import { itemIcon, runeIcon, spellIcon, useCatalog } from "../lib/ddragon";

function Img({
  src,
  title,
  size,
  round,
}: {
  src: string | null;
  title?: string;
  size: number;
  round?: boolean;
}) {
  return (
    <div
      className={`shrink-0 overflow-hidden bg-ink-800 ${round ? "rounded-full" : "rounded"}`}
      style={{ width: size, height: size }}
      title={title}
    >
      {src && (
        <img
          src={src}
          alt={title ?? ""}
          className="h-full w-full object-cover"
          draggable={false}
        />
      )}
    </div>
  );
}

export function Items({
  items,
  size = 22,
}: {
  items: number[];
  size?: number;
}) {
  const catalog = useCatalog();
  return (
    <div className="flex gap-0.5">
      {items.map((id, i) => (
        <Img
          key={i}
          size={size}
          src={itemIcon(catalog, id)}
          title={catalog?.items[String(id)]}
          round={i === 6}
        />
      ))}
    </div>
  );
}

export function Spells({
  spells,
  size = 16,
}: {
  spells: number[];
  size?: number;
}) {
  const catalog = useCatalog();
  return (
    <div className="flex flex-col gap-0.5">
      {spells.map((id, i) => (
        <Img
          key={i}
          size={size}
          src={spellIcon(catalog, id)}
          title={catalog?.spells[String(id)]?.name}
        />
      ))}
    </div>
  );
}

export function Runes({
  keystone,
  sub,
  size = 16,
}: {
  keystone: number;
  sub: number;
  size?: number;
}) {
  const catalog = useCatalog();
  return (
    <div className="flex flex-col items-center gap-0.5">
      <Img
        size={size}
        round
        src={runeIcon(catalog, keystone)}
        title={catalog?.runes[String(keystone)]?.name}
      />
      <div className="p-[2px]">
        <Img
          size={size - 4}
          round
          src={runeIcon(catalog, sub)}
          title={catalog?.runes[String(sub)]?.name}
        />
      </div>
    </div>
  );
}

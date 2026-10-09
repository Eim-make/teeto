import { championIcon, championName, useCatalog } from "../lib/ddragon";

export function ChampionIcon({
  id,
  size = 34,
}: {
  id: number | null;
  size?: number;
}) {
  const catalog = useCatalog();
  const src = championIcon(catalog, id);
  const name = championName(catalog, id);
  return (
    <div
      className="shrink-0 overflow-hidden rounded-lg bg-ink-800"
      style={{ width: size, height: size }}
      title={name}
    >
      {src && (
        <img
          src={src}
          alt={name}
          className="h-full w-full scale-110 object-cover"
          draggable={false}
        />
      )}
    </div>
  );
}

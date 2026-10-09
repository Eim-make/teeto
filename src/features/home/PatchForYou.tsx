import { useMemo } from "react";
import { Panel, PanelTitle } from "../../components/ui";
import { dataFile, type PatchNotes, type PatchSummary } from "../../lib/data";
import { championName, useCatalog } from "../../lib/ddragon";
import { useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";
import { VerdictTag } from "../patches/PatchNotesPage";

export function PatchForYou({ onOpen }: { onOpen: () => void }) {
  const catalog = useCatalog();
  const notes = useResource(async () => {
    const index = await dataFile<PatchSummary[]>("patches/index.json");
    const latest = index[0];
    return latest ? dataFile<PatchNotes>(`patches/${latest.patch}.json`) : null;
  }, []);
  const matches = useResource(() => api.matches("all", 100), []);

  const yours = useMemo(() => {
    if (notes.state !== "ready" || !notes.data || matches.state !== "ready")
      return [];
    const played = new Set(
      matches.data.map((m) => championName(catalog, m.championId)),
    );
    return notes.data.sections
      .filter((s) => s.title === "Champions")
      .flatMap((s) => s.entries)
      .filter((e) => played.has(e.name));
  }, [notes, matches, catalog]);

  if (notes.state !== "ready" || !notes.data) return null;

  return (
    <Panel>
      <PanelTitle
        aside={
          <button
            onClick={onOpen}
            className="cursor-pointer text-muted hover:text-fg"
          >
            Patch notes
          </button>
        }
      >
        Patch {notes.data.patch} for you
      </PanelTitle>
      {yours.length === 0 ? (
        <p className="text-muted">
          None of the champions you've played recently were changed this patch.
        </p>
      ) : (
        yours.map((e) => (
          <button
            key={e.name}
            onClick={onOpen}
            className="flex w-full cursor-pointer items-center gap-3 border-t border-line py-2 text-left first:border-t-0"
          >
            {e.image && (
              <img
                src={e.image}
                alt=""
                className="h-8 w-8 rounded-lg"
                draggable={false}
              />
            )}
            <span className="flex-1 truncate">{e.name}</span>
            <VerdictTag verdict={e.verdict} />
          </button>
        ))
      )}
    </Panel>
  );
}

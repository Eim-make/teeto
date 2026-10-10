import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Queue } from "../lib/bindings/Queue";
import { useClientStatus } from "../lib/hooks";
import { ChampionsPage } from "../features/champions/ChampionsPage";
import { HomePage } from "../features/home/HomePage";
import { IN_GAME, LivePage } from "../features/live/LivePage";
import { LpPage } from "../features/lp/LpPage";
import { MatchDetailPage } from "../features/matches/MatchDetailPage";
import { MatchList } from "../features/matches/MatchList";
import { PatchNotesPage } from "../features/patches/PatchNotesPage";
import { Sidebar, type Section } from "./Sidebar";
import { TitleBar } from "./TitleBar";

export type Route = {
  section: Section;
  gameId?: number;
  champion?: { id: number; position: string };
};

const routeKey = (r: Route) =>
  [
    r.section,
    r.gameId ?? "",
    r.champion ? `${r.champion.id}:${r.champion.position}` : "",
  ].join("|");

export function App() {
  const status = useClientStatus();
  const [stack, setStack] = useState<Route[]>([{ section: "home" }]);
  const [queue, setQueue] = useState<Queue>("solo");
  const main = useRef<HTMLElement>(null);
  const scroll = useRef(new Map<string, number>());
  const route = stack[stack.length - 1] ?? { section: "home" };
  const puuid = status?.summoner?.puuid ?? null;
  const phase = status?.state === "connected" ? status.phase : "";
  const wasInGame = useRef(false);

  const remember = () =>
    scroll.current.set(routeKey(route), main.current?.scrollTop ?? 0);
  const push = (next: Route) => {
    remember();
    setStack((s) => [...s, next]);
  };
  const back = () => {
    remember();
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };
  const navigate = (section: Section) => {
    remember();
    setStack([{ section }]);
  };

  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    const target = scroll.current.get(routeKey(route)) ?? 0;
    let frames = 0;
    const restore = () => {
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) > 1 && frames++ < 30)
        requestAnimationFrame(restore);
    };
    restore();
  }, [route]);

  useEffect(() => {
    const inGame = phase === "ChampSelect" || IN_GAME.includes(phase);
    if (inGame && !wasInGame.current) setStack([{ section: "live" }]);
    wasInGame.current = inGame;
  }, [phase]);

  const openMatch = (gameId: number) =>
    push({ section: route.section, gameId });

  const page = () => {
    if (route.gameId !== undefined)
      return (
        <MatchDetailPage gameId={route.gameId} puuid={puuid} onBack={back} />
      );
    switch (route.section) {
      case "home":
        return (
          <HomePage
            status={status}
            queue={queue}
            onQueue={setQueue}
            onOpenMatch={openMatch}
            onNavigate={navigate}
          />
        );
      case "live":
        return <LivePage status={status} />;
      case "matches":
        return (
          <MatchList
            title="Match history"
            pageSize={20}
            paged
            onOpen={openMatch}
          />
        );
      case "lp":
        return <LpPage queue={queue} onQueue={setQueue} />;
      case "champions":
        return (
          <ChampionsPage
            open={route.champion ?? null}
            onOpen={(id, position) =>
              push({ section: "champions", champion: { id, position } })
            }
            onBack={back}
          />
        );
      case "patches":
        return <PatchNotesPage />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar page={route.section} onNavigate={navigate} />
        <main
          ref={main}
          className="relative min-w-0 flex-1 overflow-y-auto p-4 2xl:px-8"
        >
          <div className="mx-auto max-w-[1680px]">{page()}</div>
        </main>
      </div>
    </div>
  );
}

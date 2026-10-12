import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Segment } from "./bindings/Segment";
import type { SegmentKind } from "./bindings/SegmentKind";
import type { WidgetSettings } from "./bindings/WidgetSettings";
import { native, on } from "./ipc";

export const EDIT_SHORTCUT = "Ctrl+Shift+O";

export const SEGMENT_INFO: Record<SegmentKind, { name: string; about: string }> =
  {
    champion: {
      name: "Champion",
      about: "Your champion portrait and level.",
    },
    kda: { name: "K / D / A", about: "Your kills, deaths and assists." },
    farm: { name: "Farm", about: "Your CS and CS per minute." },
    goldLead: {
      name: "Gold lead",
      about: "Your team's item gold against theirs.",
    },
    objectives: {
      name: "Objectives",
      about: "Dragon, Baron and inhibitor respawns from the game's own events.",
    },
    coreItems: {
      name: "Core items",
      about: "The usual build for your champion and what's next.",
    },
  };

const HOME = { x: 0.5, y: 0.01 };

const PREVIEW: WidgetSettings = {
  enabled: true,
  locked: false,
  opacity: 0.9,
  ...HOME,
  segments: (Object.keys(SEGMENT_INFO) as SegmentKind[]).map((kind) => ({
    kind,
    visible: true,
  })),
};

export const widgetApi = {
  settings: (): Promise<WidgetSettings> =>
    native ? invoke("widget_settings") : Promise.resolve(PREVIEW),
  save: (settings: WidgetSettings): Promise<WidgetSettings> =>
    native
      ? invoke("save_widget_settings", { settings })
      : Promise.resolve(settings),
  editing: (): Promise<boolean> =>
    native ? invoke("widget_editing") : Promise.resolve(false),
  setEditing: (editing: boolean): Promise<void> =>
    native ? invoke("set_widget_editing", { editing }) : Promise.resolve(),
};

export function useWidgetSettings() {
  const [settings, setSettings] = useState<WidgetSettings | null>(null);

  useEffect(() => {
    widgetApi
      .settings()
      .then(setSettings)
      .catch(() => setSettings(null));
    return on("widget-settings", setSettings);
  }, []);

  const save = useCallback((next: WidgetSettings) => {
    setSettings(next);
    void widgetApi.save(next).then(setSettings);
  }, []);

  const update = useCallback(
    (patch: Partial<WidgetSettings>) => {
      if (settings) save({ ...settings, ...patch });
    },
    [settings, save],
  );

  const updateSegment = useCallback(
    (kind: SegmentKind, patch: Partial<Segment>) => {
      if (!settings) return;
      save({
        ...settings,
        segments: settings.segments.map((s) =>
          s.kind === kind ? { ...s, ...patch } : s,
        ),
      });
    },
    [settings, save],
  );

  const moveSegment = useCallback(
    (kind: SegmentKind, by: -1 | 1) => {
      if (!settings) return;
      const from = settings.segments.findIndex((s) => s.kind === kind);
      const to = from + by;
      if (from < 0 || to < 0 || to >= settings.segments.length) return;
      const segments = [...settings.segments];
      [segments[from], segments[to]] = [segments[to]!, segments[from]!];
      save({ ...settings, segments });
    },
    [settings, save],
  );

  return {
    settings,
    save,
    update,
    updateSegment,
    moveSegment,
    setLocal: setSettings,
  };
}

export function useWidgetEditing(): boolean {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    widgetApi
      .editing()
      .then(setEditing)
      .catch(() => setEditing(false));
    return on("widget-editing", setEditing);
  }, []);
  return editing;
}

export function resetLayout(settings: WidgetSettings): WidgetSettings {
  return { ...settings, ...HOME };
}

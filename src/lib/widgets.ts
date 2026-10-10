import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WidgetConfig } from "./bindings/WidgetConfig";
import type { WidgetKind } from "./bindings/WidgetKind";
import type { WidgetSettings } from "./bindings/WidgetSettings";
import { native, on } from "./ipc";

export const EDIT_SHORTCUT = "Ctrl+Shift+O";

export const WIDGET_INFO: Record<WidgetKind, { name: string; about: string }> =
  {
    goldLead: {
      name: "Gold lead",
      about: "Your team's item gold against theirs.",
    },
    coreItems: {
      name: "Core items",
      about: "The usual build for your champion and what's next.",
    },
    objectives: {
      name: "Objectives",
      about: "Dragon, Baron and inhibitor respawns from the game's own events.",
    },
    farm: { name: "Farm", about: "Your CS and CS per minute." },
  };

const PREVIEW: WidgetSettings = {
  enabled: true,
  widgets: [
    {
      kind: "goldLead",
      visible: true,
      locked: false,
      opacity: 0.9,
      x: 0.44,
      y: 0.01,
    },
    {
      kind: "objectives",
      visible: true,
      locked: false,
      opacity: 0.9,
      x: 0.83,
      y: 0.07,
    },
    {
      kind: "coreItems",
      visible: true,
      locked: false,
      opacity: 0.9,
      x: 0.005,
      y: 0.3,
    },
    {
      kind: "farm",
      visible: true,
      locked: false,
      opacity: 0.9,
      x: 0.005,
      y: 0.22,
    },
  ],
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
    (kind: WidgetKind, patch: Partial<WidgetConfig>) => {
      if (!settings) return;
      save({
        ...settings,
        widgets: settings.widgets.map((w) =>
          w.kind === kind ? { ...w, ...patch } : w,
        ),
      });
    },
    [settings, save],
  );

  return { settings, save, update, setLocal: setSettings };
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
  return {
    ...settings,
    widgets: settings.widgets.map((w) => {
      const home = PREVIEW.widgets.find((p) => p.kind === w.kind);
      return home ? { ...w, x: home.x, y: home.y } : w;
    }),
  };
}

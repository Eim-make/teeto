import { Panel, PanelTitle, Switch } from "../../components/ui";
import { native } from "../../lib/ipc";
import { EDIT_SHORTCUT, resetLayout, useWidgetEditing, useWidgetSettings, widgetApi, WIDGET_INFO } from "../../lib/widgets";

export function WidgetsPage() {
  const { settings, save, update } = useWidgetSettings();
  const editing = useWidgetEditing();
  if (!settings) return null;

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-[15px] font-medium">In-game widgets</h1>

      <Panel>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Show widgets in game</div>
            <div className="text-muted">
              Small panels drawn over League while you play. Press {EDIT_SHORTCUT} in game to move them around.
            </div>
          </div>
          <Switch label="Show widgets in game" checked={settings.enabled} onChange={(enabled) => save({ ...settings, enabled })} />
        </div>
        <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
          <button
            disabled={!native}
            onClick={() => void widgetApi.setEditing(!editing)}
            className="cursor-pointer rounded-md bg-crimson px-3 py-1.5 text-white hover:bg-crimson-bright disabled:cursor-default disabled:opacity-50"
          >
            {editing ? "Finish editing" : "Edit layout"}
          </button>
          <button onClick={() => save(resetLayout(settings))} className="cursor-pointer text-muted hover:text-fg">
            Reset layout
          </button>
          <div className="flex-1" />
          <span className="text-faint">League must be in Borderless or Windowed mode</span>
        </div>
      </Panel>

      <Panel>
        <PanelTitle>Widgets</PanelTitle>
        {settings.widgets.map((w) => (
          <div key={w.kind} className="flex items-center gap-4 border-t border-line py-2.5 first:border-t-0">
            <Switch label={`Show ${WIDGET_INFO[w.kind].name}`} checked={w.visible} onChange={(visible) => update(w.kind, { visible })} />
            <div className="min-w-0 flex-1">
              <div className={w.visible ? "" : "text-muted"}>{WIDGET_INFO[w.kind].name}</div>
              <div className="truncate text-muted">{WIDGET_INFO[w.kind].about}</div>
            </div>
            <label className="tabular flex items-center gap-2 text-muted">
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(w.opacity * 100)}
                onChange={(e) => update(w.kind, { opacity: Number(e.target.value) / 100 })}
                className="w-24 accent-crimson"
                aria-label={`${WIDGET_INFO[w.kind].name} opacity`}
              />
              <span className="w-9 text-right">{Math.round(w.opacity * 100)}%</span>
            </label>
            <button
              onClick={() => update(w.kind, { locked: !w.locked })}
              className={`w-14 cursor-pointer text-right ${w.locked ? "text-crimson-bright" : "text-muted hover:text-fg"}`}
            >
              {w.locked ? "Locked" : "Lock"}
            </button>
          </div>
        ))}
      </Panel>
    </div>
  );
}

import { Panel, PanelTitle, Switch } from "../../components/ui";
import { native } from "../../lib/ipc";
import { demo } from "../../lib/demo";
import {
  EDIT_SHORTCUT,
  resetLayout,
  SEGMENT_INFO,
  useWidgetEditing,
  useWidgetSettings,
  widgetApi,
} from "../../lib/widgets";
import { StatsBar } from "./WidgetViews";

export function WidgetsPage() {
  const { settings, save, update, updateSegment, moveSegment } =
    useWidgetSettings();
  const editing = useWidgetEditing();
  if (!settings) return null;

  const shown = settings.segments.filter((s) => s.visible).map((s) => s.kind);

  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <h1 className="text-[15px] font-medium">In-game stats bar</h1>

      <Panel>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Show the bar in game</div>
            <div className="text-muted">
              One bar drawn over League while you play. Press {EDIT_SHORTCUT} in
              game to move it.
            </div>
          </div>
          <Switch
            label="Show the bar in game"
            checked={settings.enabled}
            onChange={(enabled) => update({ enabled })}
          />
        </div>
        <div className="mt-3 flex min-h-16 items-center justify-center overflow-x-auto rounded-md bg-ink-950 px-3 py-4">
          {shown.length ? (
            <div style={{ opacity: settings.opacity }}>
              <StatsBar segments={shown} game={demo.inGame} editing />
            </div>
          ) : (
            <span className="text-muted">Every part is switched off</span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-4 border-t border-line pt-3">
          <button
            disabled={!native}
            onClick={() => void widgetApi.setEditing(!editing)}
            className="cursor-pointer rounded-md bg-crimson px-3 py-1.5 text-white hover:bg-crimson-bright disabled:cursor-default disabled:opacity-50"
          >
            {editing ? "Finish editing" : "Edit position"}
          </button>
          <button
            onClick={() => save(resetLayout(settings))}
            className="cursor-pointer text-muted hover:text-fg"
          >
            Reset position
          </button>
          <button
            onClick={() => update({ locked: !settings.locked })}
            className={`cursor-pointer ${settings.locked ? "text-crimson-bright" : "text-muted hover:text-fg"}`}
          >
            {settings.locked ? "Locked" : "Lock"}
          </button>
          <div className="flex-1" />
          <label className="tabular flex items-center gap-2 text-muted">
            Opacity
            <input
              type="range"
              min={20}
              max={100}
              value={Math.round(settings.opacity * 100)}
              onChange={(e) =>
                update({ opacity: Number(e.target.value) / 100 })
              }
              className="w-24 accent-crimson"
              aria-label="Bar opacity"
            />
            <span className="w-9 text-right">
              {Math.round(settings.opacity * 100)}%
            </span>
          </label>
        </div>
        <div className="mt-3 text-faint">
          League must be in Borderless or Windowed mode
        </div>
      </Panel>

      <Panel>
        <PanelTitle>Parts</PanelTitle>
        {settings.segments.map((s, i) => (
          <div
            key={s.kind}
            className="flex items-center gap-4 border-t border-line py-2.5 first:border-t-0"
          >
            <Switch
              label={`Show ${SEGMENT_INFO[s.kind].name}`}
              checked={s.visible}
              onChange={(visible) => updateSegment(s.kind, { visible })}
            />
            <div className="min-w-0 flex-1">
              <div className={s.visible ? "" : "text-muted"}>
                {SEGMENT_INFO[s.kind].name}
              </div>
              <div className="truncate text-muted">
                {SEGMENT_INFO[s.kind].about}
              </div>
            </div>
            <div className="flex gap-1">
              <button
                disabled={i === 0}
                onClick={() => moveSegment(s.kind, -1)}
                aria-label={`Move ${SEGMENT_INFO[s.kind].name} left`}
                className="h-6 w-6 cursor-pointer rounded text-muted hover:bg-ink-800 hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
              >
                ←
              </button>
              <button
                disabled={i === settings.segments.length - 1}
                onClick={() => moveSegment(s.kind, 1)}
                aria-label={`Move ${SEGMENT_INFO[s.kind].name} right`}
                className="h-6 w-6 cursor-pointer rounded text-muted hover:bg-ink-800 hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
              >
                →
              </button>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

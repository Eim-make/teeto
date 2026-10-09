import { useMemo } from "react";
import type { Queue } from "../../lib/bindings/Queue";
import { useResource } from "../../lib/hooks";
import { api } from "../../lib/ipc";
import { lpStats } from "../../lib/rank";

export function useLp(queue: Queue) {
  const history = useResource(
    () => api.lpHistory(queue, 0),
    [queue],
    ["ranked-changed"],
  );
  const ranks = useResource(
    () => api.ranks(),
    [],
    ["ranked-changed", "client-status"],
  );

  const entries = history.state === "ready" ? history.data : [];
  const rank =
    ranks.state === "ready"
      ? ranks.data.find((r) => r.queue === queue)
      : undefined;
  const stats = useMemo(() => lpStats(entries), [entries]);

  return { entries, rank, stats, loading: history.state === "loading" };
}

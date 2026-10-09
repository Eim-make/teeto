import { useCallback, useEffect, useState } from "react";
import type { ClientStatus } from "./bindings/ClientStatus";
import { api, on, type AppEvent } from "./ipc";

export function useClientStatus(): ClientStatus | null {
  const [status, setStatus] = useState<ClientStatus | null>(null);
  useEffect(() => {
    api.clientStatus().then(setStatus);
    return on("client-status", setStatus);
  }, []);
  return status;
}

export type Resource<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "error"; message: string };

export function useResource<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  refreshOn: (keyof AppEvent)[] = [],
): Resource<T> {
  const [resource, setResource] = useState<Resource<T>>({ state: "loading" });
  const loader = useCallback(load, deps);

  useEffect(() => {
    let alive = true;
    const run = () =>
      loader()
        .then((data) => alive && setResource({ state: "ready", data }))
        .catch(
          (err: unknown) =>
            alive && setResource({ state: "error", message: String(err) }),
        );
    run();
    const offs = refreshOn.map((name) => on(name, run));
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [loader, refreshOn.join()]);

  return resource;
}

const remembered = new Map<string, unknown>();

export function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (remembered.has(key) ? (remembered.get(key) as T) : initial));
  const set = useCallback(
    (next: T) => {
      remembered.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

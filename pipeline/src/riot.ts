const ROUTING: Record<string, string> = {
  NA1: "americas",
  BR1: "americas",
  LA1: "americas",
  LA2: "americas",
  EUW1: "europe",
  EUN1: "europe",
  TR1: "europe",
  RU: "europe",
  ME1: "europe",
  KR: "asia",
  JP1: "asia",
  OC1: "sea",
  SG2: "sea",
  TW2: "sea",
  VN2: "sea",
};

export function routingFor(platform: string): string {
  const routing = ROUTING[platform.toUpperCase()];
  if (!routing) throw new Error(`unknown platform ${platform}`);
  return routing;
}

type Window = { limit: number; spanMs: number; hits: number[] };

export class Limiter {
  private windows: Window[];

  constructor(limits: [number, number][]) {
    this.windows = limits.map(([limit, seconds]) => ({
      limit,
      spanMs: seconds * 1000,
      hits: [],
    }));
  }

  waitMs(now: number): number {
    let wait = 0;
    for (const w of this.windows) {
      w.hits = w.hits.filter((t) => now - t < w.spanMs);
      const oldest = w.hits[0];
      if (w.hits.length >= w.limit && oldest !== undefined)
        wait = Math.max(wait, w.spanMs - (now - oldest));
    }
    return wait;
  }

  record(now: number): void {
    for (const w of this.windows) w.hits.push(now);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RiotClient {
  private limiters = new Map<string, Limiter>();
  private key: string;
  private limits: [number, number][];
  requests = 0;

  constructor(key: string, production: boolean) {
    this.key = key;
    this.limits = production
      ? [
          [500, 10],
          [30000, 600],
        ]
      : [
          [20, 1],
          [100, 120],
        ];
  }

  private async acquire(host: string): Promise<void> {
    let limiter = this.limiters.get(host);
    if (!limiter) {
      limiter = new Limiter(this.limits);
      this.limiters.set(host, limiter);
    }
    for (;;) {
      const wait = limiter.waitMs(Date.now());
      if (wait <= 0) break;
      await sleep(wait);
    }
    limiter.record(Date.now());
  }

  async get<T>(host: string, path: string): Promise<T | null> {
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.acquire(host);
      this.requests++;
      const res = await fetch(`https://${host}.api.riotgames.com${path}`, {
        headers: { "X-Riot-Token": this.key },
      });
      if (res.status === 429 || res.status >= 500) {
        const retry = Number(res.headers.get("Retry-After") ?? 5);
        await sleep((Number.isFinite(retry) ? retry : 5) * 1000);
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`riot ${res.status} for ${path}`);
      return (await res.json()) as T;
    }
    return null;
  }
}

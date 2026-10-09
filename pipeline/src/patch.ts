export function patchOf(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

export function comparePatch(a: string, b: string): number {
  const [am = 0, an = 0] = a.split(".").map(Number);
  const [bm = 0, bn = 0] = b.split(".").map(Number);
  return am - bm || an - bn;
}

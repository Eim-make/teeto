export interface Change {
  text: string;
  label: string;
  before: string;
  after: string;
  better: boolean | null;
}

export interface ChangeGroup {
  title: string;
  icon: string | null;
  changes: Change[];
}

export type Verdict = "buff" | "nerf" | "adjusted";

export interface ChangeEntry {
  name: string;
  image: string | null;
  tag?: string;
  kind?: string;
  context: string;
  verdict: Verdict;
  groups: ChangeGroup[];
}

export interface Section {
  title: string;
  entries: ChangeEntry[];
}

const SKIP = new Set(["", "Patch Highlights", "Upcoming Skins & Chromas"]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  nbsp: " ",
  quot: '"',
  lt: "<",
  gt: ">",
  "#39": "'",
  apos: "'",
};

export function text(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e.startsWith("#x"))
        return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function image(html: string): string | null {
  const src = /<img[^>]+src="([^"]+)"/.exec(html)?.[1];
  if (!src) return null;
  const wrapped = /[?&]f=(https?:[^&]+)/.exec(src)?.[1];
  return wrapped ? decodeURIComponent(wrapped) : src;
}

const LOWER_IS_BETTER =
  /cooldown|\bcost\b|cast time|delay|windup|wind-up|recharge|damage taken|health cost|self[- ]slow|lockout|time to/i;

function average(s: string): number | null {
  const nums = [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function change(line: string): Change {
  const arrow = line.indexOf("⇒");
  if (arrow < 0) {
    const colon = line.indexOf(": ");
    const label = colon > 0 && colon <= 40 ? line.slice(0, colon) : "";
    return { text: line, label, before: label ? line.slice(colon + 2) : "", after: "", better: null };
  }
  const left = line.slice(0, arrow).trim();
  const after = line.slice(arrow + 1).trim();
  const colon = left.indexOf(": ");
  const label = colon > 0 ? left.slice(0, colon) : "";
  const before = colon > 0 ? left.slice(colon + 2) : left;
  const a = average(before);
  const b = average(after);
  let better: boolean | null = null;
  if (a !== null && b !== null && a !== b) {
    const increased = b > a;
    better = LOWER_IS_BETTER.test(label) ? !increased : increased;
  }
  return { text: line, label, before, after, better };
}

export function verdict(groups: ChangeGroup[]): Verdict {
  const all = groups.flatMap((g) => g.changes).filter((c) => c.better !== null);
  if (all.length === 0) return "adjusted";
  const share = all.filter((c) => c.better).length / all.length;
  if (share >= 0.75) return "buff";
  if (share <= 0.25) return "nerf";
  return "adjusted";
}

function groups(html: string): ChangeGroup[] {
  const out: ChangeGroup[] = [];
  let current: ChangeGroup = { title: "", icon: null, changes: [] };
  const token = /<h4[^>]*>([\s\S]*?)<\/h4>|<li[^>]*>([\s\S]*?)<\/li>/g;
  for (const m of html.matchAll(token)) {
    if (m[1] !== undefined) {
      if (current.title || current.changes.length) out.push(current);
      current = { title: text(m[1]), icon: image(m[1]), changes: [] };
    } else if (m[2] !== undefined) {
      const line = text(m[2]);
      if (line) current.changes.push(change(line));
    }
  }
  if (current.title || current.changes.length) out.push(current);
  return out.filter((g) => g.changes.length > 0);
}

function entry(block: string): ChangeEntry | null {
  const name =
    /<h3[^>]*class="[^"]*change-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/.exec(
      block,
    )?.[1];
  const context =
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(block)?.[1] ?? "";
  const body = block.replace(/<blockquote[\s\S]*?<\/blockquote>/, "");
  const parsed = groups(body);
  if (!name && parsed.length === 0) return null;
  return {
    verdict: verdict(parsed),
    name: name ? text(name) : "",
    image: image(block),
    context: text(context),
    groups: parsed,
  };
}

const NAME_PARAGRAPH = /<p[^>]*>((?:(?!<\/p>)[\s\S])*?<strong>(?:(?!<\/p>)[\s\S])*?)<\/p>/;

function looseEntry(chunk: string): ChangeEntry | null {
  const withoutQuotes = chunk.replace(/<blockquote[\s\S]*?<\/blockquote>/g, "");
  const nameMatch = NAME_PARAGRAPH.exec(withoutQuotes);
  const nameText = nameMatch ? text(nameMatch[1] ?? "") : "";
  const isName = nameMatch !== null && nameText.length > 0 && nameText.length <= 40;
  const tag = isName && /\bNEW\b/.test(nameText) ? "New" : "";
  const name = isName ? nameText.replace(/\bNEW\b/, "").trim() : "";
  const context = text(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(chunk)?.[1] ?? "");

  let rest = withoutQuotes;
  if (isName && nameMatch) {
    const at = rest.indexOf(nameMatch[0]);
    rest = rest.slice(at + nameMatch[0].length);
  }
  const parsed = groups(rest);
  const notes = [...rest.replace(/<ul[\s\S]*?<\/ul>/g, "").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => text(m[1] ?? ""))
    .filter((t) => t.length > 0);
  if (notes.length) parsed.unshift({ title: "", icon: null, changes: notes.map(change) });

  if (!name && !context && parsed.length === 0) return null;
  return { name, tag, image: image(rest), context, verdict: verdict(parsed), groups: parsed };
}

const NAME_PARAGRAPHS = /<p[^>]*>((?:(?!<\/p>)[\s\S])*?<strong>(?:(?!<\/p>)[\s\S])*?)<\/p>/g;

function nameStarts(chunk: string): number[] {
  const quoted = [...chunk.matchAll(/<blockquote[\s\S]*?<\/blockquote>/g)].map((m) => [m.index, m.index + m[0].length]);
  return [...chunk.matchAll(NAME_PARAGRAPHS)]
    .filter((m) => {
      const t = text(m[1] ?? "");
      return t.length > 0 && t.length <= 40 && !quoted.some(([a = 0, b = 0]) => m.index >= a && m.index < b);
    })
    .map((m) => m.index);
}

function looseEntries(html: string): ChangeEntry[] {
  const out: ChangeEntry[] = [];
  for (const chunk of html.split(/<hr[^>]*>/)) {
    const starts = nameStarts(chunk);
    if (starts.length <= 1) {
      const lead = starts.length ? chunk.slice(0, starts[0]) : "";
      const heading = text(/<h4[^>]*>([\s\S]*?)<\/h4>/.exec(lead)?.[1] ?? "");
      const e = looseEntry(heading ? lead.replace(/<h4[\s\S]*?<\/h4>/, "") + chunk.slice(starts[0]) : chunk);
      if (e) out.push(heading ? { ...e, kind: heading } : e);
      continue;
    }
    const lead = chunk.slice(0, starts[0]);
    const heading = text(/<h4[^>]*>([\s\S]*?)<\/h4>/.exec(lead)?.[1] ?? "");
    const intro = looseEntry(lead.replace(/<h4[\s\S]*?<\/h4>/, ""));
    if (intro) out.push(intro);
    starts.forEach((start, n) => {
      const e = looseEntry(chunk.slice(start, starts[n + 1] ?? chunk.length));
      if (e) out.push(heading ? { ...e, kind: heading } : e);
    });
  }
  return out;
}

export function parsePatchNotes(body: string): Section[] {
  const parts = body.split(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const sections: Section[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const title = text(parts[i] ?? "");
    const html = parts[i + 1] ?? "";
    if (SKIP.has(title)) continue;
    const blocks = html.split(/class="[^"]*patch-change-block[^"]*"/).slice(1);
    const entries = blocks.length
      ? blocks.map(entry).filter((e): e is ChangeEntry => e !== null)
      : looseEntries(html);
    if (entries.length) sections.push({ title, entries });
  }
  return sections;
}

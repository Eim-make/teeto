import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compact, purchases, type RiotMatch, type RiotTimeline } from "./compact.ts";
import type { CompactMatch, CompactPlayer } from "./db.ts";
import { comparePatch, patchOf } from "./patch.ts";
import { change, parsePatchNotes, text, verdict } from "./patchnotes.ts";
import { Limiter } from "./riot.ts";
import { aggregate, blend, skillPriority } from "./stats.ts";

test("patch helpers", () => {
  assert.equal(patchOf("16.20.712.1234"), "16.20");
  assert.ok(comparePatch("16.9", "16.10") < 0);
  assert.ok(comparePatch("17.1", "16.24") > 0);
});

test("limiter waits when a window is full", () => {
  const l = new Limiter([[2, 1]]);
  assert.equal(l.waitMs(0), 0);
  l.record(0);
  l.record(0);
  assert.ok(l.waitMs(10) > 0);
  assert.equal(l.waitMs(1001), 0);
});

test("text strips tags and decodes entities", () => {
  assert.equal(
    text("<strong>Damage</strong>: 5 &amp; 6 &#8658; <b>7</b>"),
    "Damage: 5 & 6 ⇒ 7",
  );
});

test("parses patch note sections", () => {
  const html = `
    <h2 id="patch-patch-highlights">Patch Highlights</h2><p>skins</p>
    <h2 id="patch-champions">Champions</h2>
    <div class="patch-change-block white-stone"><div>
      <p><img src="https://am-a.akamaihd.net/image?f=https://ddragon.leagueoflegends.com/cdn/16.17.1/img/champion/Ambessa.png"></p>
      <h3 class="change-title" id="patch-ambessa"><a href="#">Ambessa</a></h3>
      <blockquote class="blockquote context"><p>Too strong late.</p></blockquote>
      <h4 class="change-detail-title">Passive - Step</h4>
      <ul><li><strong>Damage</strong>: 5 ⇒ <strong>4</strong></li></ul>
      <h4 class="change-detail-title">R - Fall</h4>
      <ul><li>Cooldown: 100 ⇒ 110</li><li>Range: 500</li></ul>
    </div></div>
    <h2 id="patch-bugfixes">Bugfixes &amp; QoL Changes</h2>
    <ul><li>Fixed a thing</li></ul>`;
  const sections = parsePatchNotes(html);
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Champions", "Bugfixes & QoL Changes"],
  );
  const ambessa = sections[0]?.entries[0];
  assert.equal(ambessa?.name, "Ambessa");
  assert.equal(ambessa?.context, "Too strong late.");
  assert.equal(
    ambessa?.image,
    "https://ddragon.leagueoflegends.com/cdn/16.17.1/img/champion/Ambessa.png",
  );
  assert.deepEqual(
    ambessa?.groups.map((g) => [g.title, g.changes.map((c) => c.text)]),
    [
      ["Passive - Step", ["Damage: 5 ⇒ 4"]],
      ["R - Fall", ["Cooldown: 100 ⇒ 110", "Range: 500"]],
    ],
  );
  assert.equal(ambessa?.verdict, "nerf");
  assert.deepEqual(
    sections[1]?.entries[0]?.groups[0]?.changes.map((c) => c.text),
    ["Fixed a thing"],
  );
});

test("compacts a riot match", () => {
  const participant = {
    championId: 17,
    teamPosition: "TOP",
    teamId: 100,
    win: true,
    summoner1Id: 4,
    summoner2Id: 14,
    item0: 3020,
    item1: 0,
    item2: 3115,
    item3: 0,
    item4: 0,
    item5: 0,
    perks: {
      styles: [
        { style: 8000, selections: [{ perk: 8010 }] },
        { style: 8200, selections: [{ perk: 8226 }] },
      ],
    },
  };
  const m: RiotMatch = {
    metadata: { matchId: "EUW1_1", participants: ["a"] },
    info: {
      gameCreation: 1,
      gameDuration: 1800,
      gameVersion: "16.20.1.1",
      queueId: 420,
      participants: [participant],
      teams: [{ bans: [{ championId: 25 }, { championId: -1 }] }],
    },
  };
  const c = compact("EUW1", m);
  assert.equal(c.patch, "16.20");
  assert.deepEqual(c.bans, [25]);
  assert.deepEqual(c.players[0]?.items, [3020, 3115]);
  assert.deepEqual(c.players[0]?.perks, [8010, 8226]);
});

test("aggregates champion roles, builds and matchups", () => {
  const player = (
    champion: number,
    team: number,
    win: boolean,
  ): CompactPlayer => ({
    champion,
    position: "TOP",
    team,
    win,
    primaryStyle: 8000,
    subStyle: 8200,
    perks: [8010, 9111],
    spells: [14, 4],
    items: [3020, 3115, 3089, 4645],
  });
  const matches: CompactMatch[] = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    platform: "EUW1",
    patch: "16.20",
    createdAt: i,
    durationSec: 1800,
    bans: [86],
    players: [player(17, 100, i % 4 !== 0), player(86, 200, i % 4 === 0)],
  }));
  const rows = aggregate(matches, {
    boots: new Set([3020]),
    legendary: new Set([3115, 3089, 4645]),
  });
  const teemo = rows.find((r) => r.championId === 17);
  assert.ok(teemo);
  assert.equal(teemo.games, 40);
  assert.equal(teemo.winRate, 0.75);
  assert.equal(teemo.pickRate, 1);
  assert.deepEqual(teemo.spells[0]?.value, [4, 14]);
  assert.equal(teemo.boots[0]?.value, 3020);
  assert.deepEqual(teemo.core[0]?.value, [3115, 3089, 4645]);
  assert.equal(teemo.best[0]?.championId, 86);
  assert.equal(rows.find((r) => r.championId === 86)?.banRate, 1);
  assert.equal(teemo.tier, "S");
});

test("reads skill and item order from a timeline", () => {
  const timeline: RiotTimeline = {
    info: {
      frames: [
        {
          events: [
            { type: "ITEM_PURCHASED", timestamp: 1000, participantId: 1, itemId: 1055 },
            { type: "ITEM_PURCHASED", timestamp: 2000, participantId: 1, itemId: 2003 },
            { type: "SKILL_LEVEL_UP", timestamp: 3000, participantId: 1, skillSlot: 3, levelUpType: "NORMAL" },
            { type: "SKILL_LEVEL_UP", timestamp: 3000, participantId: 1, skillSlot: 4, levelUpType: "EVOLVE" },
          ],
        },
        {
          events: [
            { type: "ITEM_PURCHASED", timestamp: 400000, participantId: 1, itemId: 3078 },
            { type: "ITEM_PURCHASED", timestamp: 410000, participantId: 1, itemId: 1036 },
            { type: "ITEM_UNDO", timestamp: 411000, participantId: 1, beforeId: 1036, afterId: 0 },
          ],
        },
      ],
    },
  };
  const p = purchases(timeline).get(1);
  assert.deepEqual(p, { skills: [3], start: [1055, 2003], buys: [3078] });
});

test("skill priority follows max order", () => {
  assert.deepEqual(skillPriority([1, 3, 2, 1, 1, 4, 1, 3, 1, 3, 4, 3, 3, 2, 2]), [1, 3, 2]);
  assert.deepEqual(skillPriority([3, 1, 2, 3, 3, 4, 3, 1, 3, 1, 4, 1, 1, 2, 2]), [3, 1, 2]);
});

test("judges whether a change helps the champion", () => {
  assert.equal(change("Damage: 5 - 30 (+25% bonus AD) ⇒ 5 - 25 (+20% bonus AD)").better, false);
  assert.equal(change("Cooldown: 12 / 11 / 10 ⇒ 10 / 9 / 8").better, true);
  assert.equal(change("Mana Cost: 50 ⇒ 60").better, false);
  assert.equal(change("Base Health: 630 ⇒ 650").better, true);
  assert.equal(change("New effect: does a thing").better, null);
  const c = change("Base Mana: 480 ⇒ 450");
  assert.deepEqual([c.label, c.before, c.after], ["Base Mana", "480", "450"]);
  const g = (lines: string[]) => [{ title: "", icon: null, changes: lines.map(change) }];
  assert.equal(verdict(g(["Damage: 1 ⇒ 2"])), "buff");
  assert.equal(verdict(g(["Damage: 1 ⇒ 2", "Cooldown: 5 ⇒ 6"])), "adjusted");
  assert.equal(verdict(g(["Fixed a bug"])), "adjusted");
  assert.equal(change("Base Mana: 480 ⇒ 450").better, false);
  assert.equal(verdict(g(["Damage: 1 ⇒ 2", "Range: 1 ⇒ 2", "Speed: 1 ⇒ 2", "Armor: 2 ⇒ 1"])), "buff");
});

test("falls back to the combined sample when the current patch is thin", () => {
  const row = (championId: number, games: number) =>
    ({ championId, position: "TOP", games, score: games, tier: "" }) as Parameters<typeof blend>[0][number];
  const out = blend([row(1, 200), row(2, 40)], [row(1, 260), row(2, 120), row(3, 60)]);
  const by = (id: number) => out.find((r) => r.championId === id);
  assert.equal(by(1)?.games, 200);
  assert.equal(by(1)?.blended, undefined);
  assert.equal(by(2)?.games, 120);
  assert.equal(by(2)?.blended, true);
  assert.equal(by(3)?.blended, true);
});

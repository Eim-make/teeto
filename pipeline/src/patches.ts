import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePatchNotes } from "./patchnotes.ts";

const SITE = "https://www.leagueoflegends.com";
const outDir = join(process.env.OUT_DIR ?? "out", "patches");
const keep = Number(process.env.PATCH_COUNT ?? 4);

interface NextPage {
  props: {
    pageProps: {
      page: {
        title: string;
        url: string;
        description?: string;
        displayedPublishDate?: string;
        metaImage?: { url?: string };
        blades: { type: string; richText?: { body: string } }[];
      };
    };
  };
}

async function nextData(url: string): Promise<NextPage> {
  const html = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 teeto-data" },
  }).then((r) => r.text());
  const json =
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1];
  if (!json) throw new Error(`no page data at ${url}`);
  return JSON.parse(json) as NextPage;
}

async function main(): Promise<void> {
  const list = await fetch(`${SITE}/en-us/news/tags/patch-notes/`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());
  const paths = [
    ...new Set(
      [
        ...list.matchAll(
          /\/en-us\/news\/game-updates\/league-of-legends-patch-(\d+)-(\d+)-notes\/?/g,
        ),
      ].map((m) => `${m[1]}.${m[2]}`),
    ),
  ];
  const index = [];
  mkdirSync(outDir, { recursive: true });

  for (const patch of paths.slice(0, keep)) {
    const url = `${SITE}/en-us/news/game-updates/league-of-legends-patch-${patch.replace(".", "-")}-notes/`;
    const page = (await nextData(url)).props.pageProps.page;
    const body =
      page.blades.find((b) => b.richText?.body.includes("patch-change-block"))
        ?.richText?.body ?? "";
    const [season = "0", minor = "0"] = patch.split(".");
    const notes = {
      patch,
      gameVersion: `${Number(season) - 10}.${minor}`,
      title: page.title,
      url: page.url,
      description: page.description ?? "",
      publishedAt: page.displayedPublishDate ?? null,
      image: page.metaImage?.url ?? null,
      sections: parsePatchNotes(body),
    };
    writeFileSync(join(outDir, `${patch}.json`), JSON.stringify(notes));
    index.push({
      patch,
      gameVersion: notes.gameVersion,
      title: notes.title,
      publishedAt: notes.publishedAt,
      description: notes.description,
      image: notes.image,
    });
    console.log(
      `patch ${patch}: ${notes.sections.map((s) => `${s.title} (${s.entries.length})`).join(", ")}`,
    );
  }
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index));
}

await main();

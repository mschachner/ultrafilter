#!/usr/bin/env node
/**
 * Builds every section's data file. Each section is independent: one flaky
 * upstream can't blank the others. When a section's fresh build fails, the
 * currently-published copy of its data is pulled from the live site and kept
 * (marked `stale: true`); only a section with neither gets a bare
 * `status: "failed"` file, which the page shows as a quiet note in the
 * ledger.
 *
 * The wikis section is built the same way one level down: each of its tabs
 * falls back independently (see sections/wikis.mjs).
 *
 * Weather is the exception: it is fetched client-side (so the temperature on
 * screen is current, not build-time), and its data file just carries the
 * config the page needs to make that call.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublished } from "./lib.mjs";
import * as blogroll from "./sections/blogroll.mjs";
import * as wikis from "./sections/wikis.mjs";
import * as albums from "./sections/albums.mjs";
import * as archive from "./sections/archive.mjs";
import * as artwork from "./sections/artwork.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "config.json");
const DATA_DIR = resolve(ROOT, "data");

const SECTIONS = [
  { name: "blogroll", ...blogroll },
  { name: "wikis", ...wikis },
  { name: "albums", ...albums },
  { name: "archive", ...archive },
  { name: "artwork", ...artwork },
];

export async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  await mkdir(DATA_DIR, { recursive: true });

  const results = {};
  for (const section of SECTIONS) {
    console.log(`\n== ${section.name} ==`);
    const published = await loadPublished(config.site, section.name);
    let payload;
    try {
      payload = await section.build(config, { published });
    } catch (err) {
      const msg = String(err?.message || err);
      if (published) {
        payload = { ...published, stale: true };
        console.log(`FAIL  ${section.name} — ${msg}; keeping published data`);
      } else {
        payload = { generated: new Date().toISOString(), status: "failed", error: msg };
        console.log(`FAIL  ${section.name} — ${msg}; nothing published to fall back on`);
      }
    }
    results[section.name] = payload;
    await writeFile(
      resolve(DATA_DIR, `${section.name}.json`),
      JSON.stringify(payload, null, 1) + "\n",
      "utf8"
    );
  }

  // Weather: config passthrough only — the page fetches the forecast itself.
  await writeFile(
    resolve(DATA_DIR, "weather.json"),
    JSON.stringify({ generated: new Date().toISOString(), config: config.weather }, null, 1) + "\n",
    "utf8"
  );

  const posts = results.blogroll?.posts?.length ?? 0;
  const wikisNote = w => {
    const ids = w?.order || [];
    const bad = ids.filter(id => w.tabs?.[id]?.stale || w.tabs?.[id]?.status === "failed");
    return ids.length ? ` (${ids.length - bad.length}/${ids.length} tabs${bad.length ? `; ${bad.join(", ")}` : ""})` : "";
  };
  console.log(
    `\nWrote data/: blogroll ${posts} posts (${results.blogroll?.feedsOk ?? 0}/${
      results.blogroll?.feedsTotal ?? 0
    } feeds)` +
      `${results.blogroll?.stale ? " [stale]" : ""}, wikis ${
        results.wikis?.date || results.wikis?.status || "?"
      }${wikisNote(results.wikis)}, albums ${
        results.albums?.date || results.albums?.status || "?"
      }${results.albums?.stale ? " [stale]" : ""}, artwork ${
        results.artwork?.date || results.artwork?.status || "?"
      }${results.artwork?.stale ? " [stale]" : ""}`
  );

  // The blogroll is the page's backbone: with no posts at all (fresh build
  // failed AND nothing published to fall back on), refuse to deploy so the
  // previously published site stays up untouched.
  if (!posts) {
    console.error("No blogroll posts from any source; refusing to publish.");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

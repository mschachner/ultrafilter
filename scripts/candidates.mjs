#!/usr/bin/env node
/**
 * Candidate pools for the morning task's artwork and wiki picks.
 *
 * The task chooses by judgment against the likes; this script does the
 * fetching, with the same queries and extractors the site build uses, and
 * prints JSON. Run it from a checkout of `main` with the store (the `data`
 * branch) checked out beside it — STORE_DIR names the store when it isn't
 * ./store.
 *
 *   node scripts/candidates.mjs likes
 *       A digest of likes.json: liked artworks (with artist and interest),
 *       liked wiki entries by source and topic, liked posts, liked albums,
 *       and counts per interest area / topic / artist — plus the Q-numbers
 *       and URLs already picked, so they aren't picked again.
 *
 *   node scripts/candidates.mjs artwork [--interest ID | --creator Q…] [--limit N]
 *       Works with an English Wikipedia article in one interest area (from
 *       config.json) or by one artist, in a fresh random order, minus
 *       anything picked before. Without --interest/--creator: a few from
 *       every area. Each line: wikidata, title, artist, artistId, year, url.
 *
 *   node scripts/candidates.mjs wikis [--tabs nlab,sep,attic,oeis,wikipedia] [--count N]
 *       Random entries per tab (title and URL) to choose leads from; for
 *       Wikipedia, Good articles per interest area. Note the OEIS pool is
 *       slow to sample (one fetch per A-number).
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson } from "./lib.mjs";
import * as store from "./store.mjs";
import * as likes from "./sections/likes.mjs";
import * as artwork from "./sections/artwork.mjs";
// The pool tabs directly rather than wikis.mjs's TABS table: that would pull
// in the arXiv module and its XML parser dependency, which the morning
// task's session has no reason to npm-install.
import * as nlab from "./sections/wikis/nlab.mjs";
import * as sep from "./sections/wikis/sep.mjs";
import * as attic from "./sections/wikis/attic.mjs";
import * as oeis from "./sections/wikis/oeis.mjs";
const TABS = { nlab: { module: nlab }, sep: { module: sep }, attic: { module: attic }, oeis: { module: oeis } };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};

const config = JSON.parse(await readFile(resolve(ROOT, "config.json"), "utf8"));
const out = v => console.log(JSON.stringify(v, null, 1));

/** Everything the task has picked before, from the store's picks/ files. */
async function pickedBefore() {
  const qids = new Set(), urls = new Set();
  for (const name of await store.list(config, "picks")) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    try {
      const doc = await store.json(config, `picks/${name}`);
      if (doc?.artwork?.wikidata) qids.add(doc.artwork.wikidata);
      for (const v of Object.values(doc?.wikis || {})) {
        for (const p of Array.isArray(v) ? v : [v]) if (p?.url) urls.add(p.url);
      }
    } catch {}
  }
  return { qids, urls };
}

if (cmd === "likes") {
  const set = await likes.load(config) ?? likes.wrap([]);
  const tally = (items, f) => {
    const m = new Map();
    for (const it of items) { const k = f(it); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
  };
  const art = set.of("artwork"), wiki = set.of("wiki"), posts = set.of("post");
  const albums = set.of("album");
  const before = await pickedBefore();
  out({
    counts: { artwork: art.length, wiki: wiki.length, post: posts.length,
              albumsListened: albums.length, albumsLiked: albums.filter(a => a.liked).length },
    artworkByInterest: tally(art, a => a.interest),
    artworkByArtist: tally(art, a => a.artistId ? `${a.artist || "?"} (${a.artistId})` : a.artist),
    wikiBySource: tally(wiki, w => w.source),
    wikipediaByTopic: tally(wiki.filter(w => w.source === "wikipedia"), w => w.topic),
    postsByFeed: tally(posts, p => p.feed),
    likedAlbumGenres: tally(albums.filter(a => a.liked).flatMap(a => a.genres || []), g => g.toLowerCase()),
    artworks: art.map(a => ({ wikidata: a.key, title: a.title, artist: a.artist, artistId: a.artistId, interest: a.interest, when: a.when })),
    wikis: wiki.map(w => ({ source: w.source, title: w.title, url: w.url, topic: w.topic, when: w.when })),
    posts: posts.map(p => ({ title: p.title, feed: p.feed, url: p.url, when: p.when })),
    albums: albums.map(a => ({ artist: a.artist, album: a.album, liked: a.liked, genres: a.genres, listened: a.listened })),
    alreadyPicked: { artworks: [...before.qids], wikis: [...before.urls] },
  });
} else if (cmd === "artwork") {
  const limit = Number(opt("limit", 12));
  const seed = String(Math.random());
  const before = await pickedBefore();
  const interests = config.artwork?.interests || [];
  let specs;
  if (opt("creator")) specs = [{ id: `creator:${opt("creator")}`, label: "by artist", creators: [opt("creator")],
    classes: ["Q3305213", "Q860861", "Q11060274", "Q93184", "Q18219090", "Q28913685", "Q19960510"] }];
  else if (opt("interest")) {
    const i = interests.find(i => i.id === opt("interest"));
    if (!i) { console.error(`no interest "${opt("interest")}" in config.json`); process.exit(2); }
    specs = [i];
  } else specs = interests;
  const per = specs.length > 1 ? Math.max(3, Math.ceil(limit / specs.length)) : limit;
  const result = [];
  for (const spec of specs) {
    try {
      const rows = await artwork.runSparql(artwork.sparqlFor(spec, seed, per + before.qids.size));
      for (const r of rows) {
        const q = artwork.itemId(r);
        if (before.qids.has(q)) continue;
        result.push({
          wikidata: q,
          title: decodeURIComponent(new URL(r.article.value).pathname.replace("/wiki/", "")).replace(/_/g, " "),
          artist: artwork.qid(r.creatorLabel?.value) ? null : r.creatorLabel?.value || null,
          artistId: r.creator?.value ? r.creator.value.split("/").pop() : null,
          year: r.year?.value != null ? Number(r.year.value) : null,
          hasImage: Boolean(r.image?.value),
          url: r.article.value,
          interest: spec.id,
        });
        if (result.filter(x => x.interest === spec.id).length >= per) break;
      }
    } catch (err) {
      console.error(`${spec.id}: ${err.message || err}`);
    }
  }
  out(result);
} else if (cmd === "wikis") {
  const count = Number(opt("count", 8));
  const tabs = String(opt("tabs", "wikipedia,nlab,sep,attic,oeis")).split(",").map(s => s.trim()).filter(Boolean);
  const before = await pickedBefore();
  const seed = String(Math.random());
  const result = {};
  for (const id of tabs) {
    try {
      if (id === "wikipedia") {
        const list = [];
        for (const t of config.wikipedia?.topics || []) {
          const search = `incategory:"Good articles" articletopic:${t.articleTopics.join("|")}`;
          const doc = await fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&formatversion=2` +
            `&srsearch=${encodeURIComponent(search)}&srsort=random&srlimit=${Math.max(3, Math.ceil(count / 2))}&srprop=`,
            { "User-Agent": "UltrafilterBuild/1.0 (https://github.com/mschachner/ultrafilter)" });
          for (const r of doc?.query?.search || []) {
            list.push({ title: r.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`, topic: t.id });
          }
        }
        result.wikipedia = list.filter(p => !before.urls.has(p.url));
      } else if (TABS[id]?.module?.candidates) {
        result[id] = (await TABS[id].module.candidates(count, `${id}:${seed}`)).filter(p => !before.urls.has(p.url));
      } else {
        result[id] = { error: "no candidate sampler for this tab" };
      }
    } catch (err) {
      result[id] = { error: String(err.message || err) };
    }
  }
  out(result);
} else {
  console.error("usage: candidates.mjs likes | artwork [--interest ID | --creator Q…] [--limit N] | wikis [--tabs a,b] [--count N]");
  process.exit(2);
}

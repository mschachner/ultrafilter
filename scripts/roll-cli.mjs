#!/usr/bin/env node
/**
 * The roll from the command line — what the morning task runs to maintain
 * the blogroll, and a way to do by hand what the page's blogroll menu does.
 * Run it from a checkout of `main` with the store (the `data` branch)
 * checked out beside it (`git worktree add store data`; STORE_DIR names it
 * when it isn't ./store). Commands that write change store/blogroll.json
 * only — committing and pushing is the caller's job.
 *
 *   node scripts/roll-cli.mjs status
 *       JSON digest: the policy, counts, free slots, every feed in the roll
 *       with days in the roll, liked posts, last build result and newest
 *       post, the feeds due for rotation, and the archive (never re-add
 *       those). Needs no npm install.
 *
 *   node scripts/roll-cli.mjs rotate [--dry-run]
 *       Applies the policy: every active (not pinned) feed that has been in
 *       the roll for `trialDays` with no liked post is archived. Prints
 *       what it archived. Needs no npm install.
 *
 *   node scripts/roll-cli.mjs check <url>
 *       Finds and verifies the feed at a blog's address — the feed URL
 *       itself, a page that links to one, or a site with a feed at a
 *       well-known path — fetching it exactly as the build does. Prints
 *       the entry it would add (name, author, site, feed, newest posts) and
 *       whether it is already in the roll or the archive. Exit 1 if no feed
 *       parses. Needs `npm ci` (the XML parser).
 *
 *   node scripts/roll-cli.mjs add <url> --topics math[,sci] [--name N] [--author A] [--site S]
 *                                        [--note "one line"] [--by task|mark] [--pinned]
 *       check, then append the entry to the roll (status active, added
 *       today). Refuses a duplicate of anything in the roll or the archive,
 *       an unknown topic, and — for --by task — a full roll.
 *
 *   node scripts/roll-cli.mjs pin|unpin|remove|restore <name>
 *       Status changes by feed name, as in the page's menu. remove archives
 *       (archivedBy mark); restore makes the feed active again with a fresh
 *       trial from today.
 *
 *   node scripts/roll-cli.mjs init [--from <json>]
 *       Writes the store's blogroll.json from a `blogroll.feeds` list (a
 *       config.json of the old layout), every feed active and added today.
 *       Refuses to overwrite an existing roll.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublished, todayIn } from "./lib.mjs";
import * as roll from "./roll.mjs";
import * as likes from "./sections/likes.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0];
const flag = name => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i + 1 >= args.length ? dflt : args[i + 1];
};
const BARE_FLAGS = new Set(["--dry-run", "--pinned"]);
const positional = [];
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) { if (!BARE_FLAGS.has(args[i])) i++; continue; }
  positional.push(args[i]);
}

const config = JSON.parse(await readFile(resolve(ROOT, "config.json"), "utf8"));
const P = roll.policy(config);
const today = todayIn(P.timezone).key;
const out = v => console.log(JSON.stringify(v, null, 1));
const die = (msg, code = 1) => { console.error(msg); process.exit(code); };

async function current() {
  const { roll: r, source } = await roll.load(config);
  return { r, source };
}
async function likeItems() {
  const set = await likes.load(config);
  return set ? set.items : [];
}

/** The build's XML side, loaded only for the commands that fetch feeds. */
async function fetcher() {
  try { return await import("./sections/blogroll.mjs"); }
  catch (err) {
    if (/fast-xml-parser/.test(String(err.message || err))) die("check/add need the feed parser: run `npm ci` once, then retry");
    throw err;
  }
}

function entryFrom(found, overrides) {
  const topics = String(overrides.topics || "").split(",").map(s => s.trim()).filter(Boolean);
  const name = overrides.name || found.info.title || "";
  return roll.normalizeEntry({
    name,
    author: overrides.author || found.info.author || name,
    site: overrides.site || found.info.site || "",
    feed: found.feed,
    topics,
  });
}

function describe(found) {
  return {
    feed: found.feed,
    source: found.source,
    entries: found.entries.length,
    newest: found.entries.slice(0, 3).map(e => ({ title: e.title, date: e.date ? e.date.toISOString().slice(0, 10) : null, link: e.link })),
    latest: found.entries.map(e => e.date).filter(Boolean).sort((a, b) => b - a)[0]?.toISOString().slice(0, 10) || null,
  };
}

if (cmd === "status") {
  const { r, source } = await current();
  const items = await likeItems();
  const likeCounts = roll.likesByFeed(r, items);
  const due = new Set(roll.rotationDue(r, items, config, today).map(f => f.name));
  const published = await loadPublished(config.site, "blogroll");
  const lastBuild = new Map((published?.feeds || []).map(f => [f.name, f]));
  const latestPost = new Map();
  for (const p of published?.posts || []) {
    if (p.date && (!latestPost.has(p.feed) || latestPost.get(p.feed) < p.date)) latestPost.set(p.feed, p.date);
  }
  const inRoll = r.feeds.filter(roll.inRoll);
  out({
    policy: { targetSize: P.targetSize, trialDays: P.trialDays, today },
    source,
    counts: {
      pinned: inRoll.filter(f => f.status === "pinned").length,
      active: inRoll.filter(f => f.status === "active").length,
      inRoll: inRoll.length,
      archived: r.feeds.length - inRoll.length,
      slotsFree: roll.slotsFree(r, config),
      dueForRotation: due.size,
    },
    topics: (config.blogroll?.topics || []).map(t => t.id),
    feeds: inRoll.map(f => {
      const b = lastBuild.get(f.name);
      return {
        name: f.name, author: f.author, site: f.site, feed: f.feed, topics: f.topics,
        status: f.status, added: f.added || null, addedBy: f.addedBy || null,
        daysInRoll: f.added ? roll.daysBetween(f.added, today) : null,
        likedPosts: likeCounts.get(f.name) || 0,
        due: due.has(f.name),
        lastBuild: b ? { status: b.status, posts: b.count, source: b.source || null, error: b.error || null } : null,
        latestPost: latestPost.get(f.name)?.slice(0, 10) || null,
        note: f.note || undefined,
      };
    }),
    due: [...due],
    archive: r.feeds.filter(f => !roll.inRoll(f)).map(f => ({
      name: f.name, site: f.site, feed: f.feed, topics: f.topics,
      archived: f.archived || null, archivedBy: f.archivedBy || null, reason: f.reason || null,
    })),
  });
} else if (cmd === "rotate") {
  const { r, source } = await current();
  if (source !== "store") die(`the store has no ${P.path} yet — run \`init\` first`);
  const due = roll.rotationDue(r, await likeItems(), config, today);
  const names = due.map(f => f.name);
  if (!flag("dry-run") && names.length) {
    roll.applyRotation(r, due, config, today);
    await roll.save(config, r);
  }
  out({ dryRun: flag("dry-run"), archived: names, slotsFree: roll.slotsFree(r, config) + (flag("dry-run") ? names.length : 0) });
} else if (cmd === "check" || cmd === "add") {
  const input = positional[0];
  if (!input) die(`usage: roll-cli.mjs ${cmd} <url> …`);
  let url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try { url = new URL(url).href; } catch { die(`not a URL: ${input}`); }
  const { discover } = await fetcher();
  let found;
  try { found = await discover(url); }
  catch (err) { die(`no working feed: ${err.message || err}`); }
  const { r, source } = await current();
  const entry = entryFrom(found, { name: opt("name"), author: opt("author"), site: opt("site") || (found.feed === url ? "" : url), topics: opt("topics", "") });
  const dupe = roll.findFeed(r, entry);
  const result = { ...describe(found), entry, duplicateOf: dupe ? { name: dupe.name, status: dupe.status } : null };
  if (cmd === "check") { out(result); process.exit(0); }

  if (source !== "store") die(`the store has no ${P.path} yet — run \`init\` first`);
  if (dupe) die(`already in the roll as “${dupe.name}” (${dupe.status})${dupe.status === "archived" ? " — restore it instead" : ""}`);
  if (!entry.name) die("the feed has no title — pass --name");
  if (!entry.topics.length) die("pass --topics with at least one topic id from config.json");
  const known = new Set((config.blogroll?.topics || []).map(t => t.id));
  const bad = entry.topics.filter(t => !known.has(t));
  if (bad.length) die(`unknown topic${bad.length > 1 ? "s" : ""} ${bad.join(", ")} — config.json has ${[...known].join(", ")}`);
  const by = opt("by", "task");
  if (by === "task" && !roll.slotsFree(r, config)) die(`the roll is full (${P.targetSize}) — nothing added`);
  entry.status = flag("pinned") ? "pinned" : "active";
  entry.added = today;
  entry.addedBy = by;
  if (opt("note")) entry.note = opt("note");
  r.feeds.push(entry);
  await roll.save(config, r);
  out({ added: entry, slotsFree: roll.slotsFree(r, config) });
} else if (["pin", "unpin", "remove", "restore"].includes(cmd)) {
  const name = positional.join(" ");
  if (!name) die(`usage: roll-cli.mjs ${cmd} <feed name>`);
  const { r, source } = await current();
  if (source !== "store") die(`the store has no ${P.path} yet — run \`init\` first`);
  const f = r.feeds.find(x => x.name === name) || r.feeds.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!f) die(`no feed named “${name}” in the roll`);
  if (cmd === "pin") f.status = "pinned";
  if (cmd === "unpin") f.status = "active";
  if (cmd === "remove") { f.status = "archived"; f.archived = today; f.archivedBy = opt("by", "mark"); f.reason = opt("reason", "removed"); }
  if (cmd === "restore") { f.status = "active"; f.added = today; f.addedBy = opt("by", "mark"); delete f.archived; delete f.archivedBy; delete f.reason; }
  await roll.save(config, r);
  out({ [cmd]: roll.normalizeEntry(f) });
} else if (cmd === "init") {
  const { source } = await current();
  if (source === "store") die(`the store already has ${P.path} — nothing done`);
  const from = opt("from", "config.json");
  const doc = JSON.parse(await readFile(resolve(ROOT, from), "utf8"));
  const feeds = doc?.blogroll?.feeds || doc?.feeds;
  if (!Array.isArray(feeds) || !feeds.length) die(`${from} has no blogroll.feeds list`);
  const r = roll.fromConfigFeeds(feeds, today);
  const path = await roll.save(config, r);
  out({ wrote: path, feeds: r.feeds.length });
} else {
  console.error("usage: roll-cli.mjs status | rotate [--dry-run] | check <url> | add <url> --topics a,b [--name N --author A --site S --note … --by task|mark --pinned] | pin|unpin|remove|restore <name> | init [--from file]");
  process.exit(2);
}

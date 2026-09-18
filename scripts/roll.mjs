/**
 * The roll — the list of blogs the blogroll section fetches — as a file in
 * the store: blogroll.json on the `data` branch. Three writers share it:
 * the page's blogroll menu (pin, remove, restore, add a blog), the morning
 * task (adds a verified feed when the roll has room, rotates out feeds
 * that earned no likes), and the CLI in roll-cli.mjs that the task runs.
 * The build only reads it. This module has no dependencies, so the CLI's
 * read-only commands and the rotation work without an npm install.
 *
 * Shape:
 *   {
 *     "version": 1,
 *     "updated": "<ISO time of the last write>",
 *     "feeds": [
 *       { "name": "Joel David Hamkins", "author": "…", "site": "https://…", "feed": "https://…/feed/",
 *         "altFeeds": [ … ], "proxyFallback": false,          // optional, as in the old config.json
 *         "topics": ["math"],
 *         "status": "pinned" | "active" | "archived",
 *         "added": "YYYY-MM-DD", "addedBy": "mark" | "task",
 *         "archived": "YYYY-MM-DD", "archivedBy": "mark" | "task", "reason": "…",   // archived entries only
 *         "note": "…" }                                        // the task's one line on why it chose the blog
 *     ]
 *   }
 *
 * Status is the whole model. `pinned` and `active` feeds are in the roll and
 * get fetched; `archived` ones are kept so they are not proposed again and
 * can be restored from the page's Archive tab. The rotation policy (in
 * config.json under blogroll: `trialDays`, `targetSize`) touches only
 * `active` feeds: one that has been in the roll for `trialDays` with no
 * liked post is archived, and the task adds a new feed only while the roll
 * holds fewer than `targetSize`. A pin is permanent until unpinned.
 */

import { todayIn } from "./lib.mjs";
import * as store from "./store.mjs";

export const PATH = "blogroll.json";
export const STATUSES = ["pinned", "active", "archived"];

export function policy(config) {
  const b = config.blogroll || {};
  return {
    path: b.rollPath || PATH,
    targetSize: Number.isFinite(b.targetSize) ? b.targetSize : 40,
    trialDays: Number.isFinite(b.trialDays) ? b.trialDays : 42,
    timezone: b.timezone || config.wikis?.timezone || config.artwork?.timezone || "UTC",
  };
}

export const inRoll = f => f && f.status !== "archived";

/** Same feed or same site, ignoring scheme, trailing slashes, and case. */
export function normUrl(u) {
  return String(u || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
}
export function sameFeed(a, b) {
  const fa = normUrl(a.feed), fb = normUrl(b.feed), sa = normUrl(a.site), sb = normUrl(b.site);
  return (fa && fa === fb) || (sa && sa === sb);
}
export function findFeed(roll, entry) {
  return roll.feeds.find(f => sameFeed(f, entry) || (entry.name && f.name === entry.name));
}

/** Keeps only the keys an entry may carry, in a stable order, with a valid status. */
export function normalizeEntry(f) {
  const out = {
    name: String(f.name || "").trim(),
    author: String(f.author || f.name || "").trim(),
    site: String(f.site || "").trim(),
    feed: String(f.feed || "").trim(),
  };
  if (Array.isArray(f.altFeeds) && f.altFeeds.length) out.altFeeds = f.altFeeds.map(String);
  if (f.proxyFallback === false) out.proxyFallback = false;
  out.topics = Array.isArray(f.topics) ? f.topics.map(String) : [];
  out.status = STATUSES.includes(f.status) ? f.status : "active";
  if (f.added) out.added = String(f.added);
  if (f.addedBy) out.addedBy = String(f.addedBy);
  if (f.note) out.note = String(f.note);
  if (out.status === "archived") {
    if (f.archived) out.archived = String(f.archived);
    if (f.archivedBy) out.archivedBy = String(f.archivedBy);
    if (f.reason) out.reason = String(f.reason);
  }
  return out;
}

export function normalizeRoll(doc) {
  const feeds = (Array.isArray(doc?.feeds) ? doc.feeds : []).map(normalizeEntry).filter(f => f.name && f.feed);
  return { version: 1, updated: doc?.updated || null, feeds };
}

/** A roll from the old config.json feed list: everything active, added today, by Mark. */
export function fromConfigFeeds(feeds, todayKey) {
  return normalizeRoll({
    feeds: (feeds || []).map(f => ({ ...f, status: "active", added: todayKey, addedBy: "mark" })),
  });
}

export function serialize(roll) {
  return JSON.stringify({ version: 1, updated: new Date().toISOString(), feeds: roll.feeds.map(normalizeEntry) }, null, 1) + "\n";
}

/**
 * The roll, from the store — or, when the store has no blogroll.json yet,
 * from config.json's `blogroll.feeds` (the seed a fresh fork starts from).
 * Throws when the store read fails outright, so the caller can keep the
 * published copy rather than fetch nothing.
 */
export async function load(config) {
  const p = policy(config);
  const doc = await store.json(config, p.path);
  if (doc) return { roll: normalizeRoll(doc), source: "store" };
  const seed = config.blogroll?.feeds;
  if (Array.isArray(seed) && seed.length) {
    return { roll: fromConfigFeeds(seed, todayIn(p.timezone).key), source: "config" };
  }
  return { roll: normalizeRoll(null), source: "none" };
}

/** Writes the roll to the local store checkout (the CLI's write path). */
export async function save(config, roll) {
  return store.write(config, policy(config).path, serialize(roll));
}

/* ------------------------------ policy ------------------------------- */

export function daysBetween(fromKey, toKey) {
  const a = Date.parse(`${fromKey}T00:00:00Z`), b = Date.parse(`${toKey}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.floor((b - a) / 86400000);
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/**
 * Liked posts per feed: matched by the feed name the like recorded, and,
 * failing that, by the post's host against the feed's site — so a renamed
 * feed keeps its likes.
 */
export function likesByFeed(roll, likeItems) {
  const posts = (likeItems || []).filter(it => it?.kind === "post");
  const byName = new Map(roll.feeds.map(f => [f.name, f]));
  const byHost = new Map(roll.feeds.filter(f => host(f.site)).map(f => [host(f.site), f]));
  const counts = new Map();
  for (const p of posts) {
    const f = byName.get(p.feed) || byHost.get(host(p.url || p.key));
    if (f) counts.set(f.name, (counts.get(f.name) || 0) + 1);
  }
  return counts;
}

/** Active feeds that have served their trial with no liked post. */
export function rotationDue(roll, likeItems, config, todayKey) {
  const p = policy(config);
  const likes = likesByFeed(roll, likeItems);
  return roll.feeds.filter(f => {
    if (f.status !== "active" || !f.added) return false;
    const days = daysBetween(f.added, todayKey);
    return days != null && days >= p.trialDays && !(likes.get(f.name) > 0);
  });
}

/** Archives the due feeds in place; returns the names it archived. */
export function applyRotation(roll, due, config, todayKey) {
  const p = policy(config);
  const names = [];
  for (const f of due) {
    f.status = "archived";
    f.archived = todayKey;
    f.archivedBy = "task";
    f.reason = `no liked posts in ${p.trialDays} days`;
    names.push(f.name);
  }
  return names;
}

/** Slots the task may fill: target minus what is in the roll now. */
export function slotsFree(roll, config) {
  return Math.max(0, policy(config).targetSize - roll.feeds.filter(inRoll).length);
}

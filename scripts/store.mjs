/**
 * The store: the `data` branch of this repository, where everything editorial
 * lives — the morning task's album and wiki/artwork picks, the recommendation
 * history, the Spotify library export, and likes.json (the unified likes).
 *
 * Two ways to read it, tried in order:
 *   1. A local checkout. The workflow checks the `data` branch out into
 *      `store/` beside the code (actions/checkout with `ref: data`), so in
 *      Actions every read is a plain file read. Locally, `git worktree add
 *      store data` gives the same thing; STORE_DIR overrides the location.
 *   2. raw.githubusercontent.com. The repository is public, so the branch is
 *      readable without a token; this is what a local build with no checkout
 *      gets. Directory listings go through the git trees API (also anonymous,
 *      but rate-limited to 60 requests an hour per IP — fine for one build).
 *
 * Readers never throw for a missing file: `text()` and `json()` return null
 * when there is nothing at that path, and throw only on a real failure, so a
 * builder can tell "the task hasn't published yet" from "GitHub is down".
 */

import { readFile, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText, fetchJson } from "./lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function settings(config) {
  const s = config.store || {};
  return {
    repo: s.repo || "mschachner/ultrafilter",
    branch: s.branch || "data",
    dir: process.env.STORE_DIR || resolve(ROOT, s.dir || "store"),
  };
}

let localChecked = null;
async function hasLocal(dir) {
  if (localChecked?.dir === dir) return localChecked.ok;
  let ok = false;
  try { await access(dir); ok = true; } catch {}
  localChecked = { dir, ok };
  if (ok) console.error(`      store — reading ${dir}`);   // stderr: candidates.mjs prints JSON on stdout
  return ok;
}

/** The store's contents at `path` as text, or null when there is no such file. */
export async function text(config, path) {
  const s = settings(config);
  if (await hasLocal(s.dir)) {
    try { return await readFile(resolve(s.dir, path), "utf8"); }
    catch (err) { if (err.code === "ENOENT") return null; throw err; }
  }
  try {
    return await fetchText(`https://raw.githubusercontent.com/${s.repo}/${s.branch}/${path}?t=${Date.now()}`,
      { "Cache-Control": "no-cache" });
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export async function json(config, path) {
  const t = await text(config, path);
  return t == null ? null : JSON.parse(t);
}

/** File names directly under `dir` in the store (not paths); [] when absent. */
export async function list(config, dir) {
  const s = settings(config);
  if (await hasLocal(s.dir)) {
    try { return (await readdir(resolve(s.dir, dir), { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name); }
    catch (err) { if (err.code === "ENOENT") return []; throw err; }
  }
  try {
    const tree = await fetchJson(
      `https://api.github.com/repos/${s.repo}/git/trees/${encodeURIComponent(s.branch)}:${encodeURIComponent(dir)}`,
      { Accept: "application/vnd.github+json" });
    return (tree.tree || []).filter(e => e.type === "blob").map(e => e.path);
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

/** Where the store is being read from, for the build log. */
export function describe(config) {
  const s = settings(config);
  return localChecked?.ok ? s.dir : `${s.repo}@${s.branch} (raw)`;
}

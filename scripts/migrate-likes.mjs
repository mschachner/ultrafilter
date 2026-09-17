#!/usr/bin/env node
/**
 * One-shot: turns the store's listening_log.csv (the albums-only log the
 * previous listening.js kept) into likes.json, the unified likes file.
 * Album rows become album items; nothing else changes. Run from the
 * repository root against a checkout of the `data` branch:
 *
 *   node scripts/migrate-likes.mjs store
 *
 * Refuses to overwrite an existing likes.json; delete it first if you mean
 * to redo the conversion.
 */

import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { itemsFromListeningLog } from "./sections/likes.mjs";

const dir = process.argv[2];
if (!dir) { console.error("usage: migrate-likes.mjs <store dir>"); process.exit(2); }
const out = resolve(dir, "likes.json");
try { await access(out); console.error(`${out} already exists — not overwriting`); process.exit(1); } catch {}

let csv = "";
try { csv = await readFile(resolve(dir, "listening_log.csv"), "utf8"); }
catch { console.log("no listening_log.csv — starting with an empty likes.json"); }
const items = itemsFromListeningLog(csv);
await writeFile(out, JSON.stringify({ version: 1, updated: new Date().toISOString(), items }, null, 1) + "\n", "utf8");
console.log(`wrote ${out}: ${items.length} album marks (${items.filter(i => i.liked).length} liked)`);

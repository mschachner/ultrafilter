/**
 * Likes — the client side. One module, shared by both pages, behind every
 * heart on the site: the "Listened" checkbox and heart on album cards, and
 * the plain hearts on the artwork plate, wiki entries, and blogroll posts.
 * Marks are kept in localStorage and, when a token is configured, committed
 * as likes.json to this repository's `data` branch through the GitHub
 * contents API — where the site build reads them back (baking album marks
 * into the album payloads, publishing the file as data/likes.json, and
 * weighting the daily draws), and where the morning task reads them when it
 * chooses the day's albums, artwork, and wiki picks.
 *
 * Every like is an item { kind, key, ...what the page knew about it, when }:
 *   album    key "artist::album" — artist, album, genres, listened (first
 *            mark, YYYY-MM-DD), liked. The only kind with two states: the
 *            item exists once listened, and liked is a flag on it.
 *   artwork  key "Q…" — title, url, artist, artistId, interest
 *   wiki     key = url — source (tab id), title, url, topic (Wikipedia only)
 *   post     key = url — title, url, feed, topics
 * For the last three, the item's existence is the like.
 *
 * State precedence, most authoritative first:
 *   1. local overrides — marks made in this browser, kept until the commit
 *      to GitHub succeeds (then the server copy agrees and the override is
 *      dropped); a removal is kept as a tombstone the same way;
 *   2. the live file — likes.json fetched on load: through the API with the
 *      token when there is one, else from raw.githubusercontent.com (the
 *      repository is public), a few minutes behind at most;
 *   3. baked state — data/likes.json as the last build published it.
 *
 * The token is the same fine-grained PAT the add-a-blog dialog uses
 * (`ultrafilter:ghToken`: Contents read & write on this repository), pasted
 * once and kept in this browser's localStorage. It never appears in the page
 * source or the deployed site. Shift-click any "Listened" checkbox or any
 * heart to reopen the sync settings.
 */

const UF = (() => {
  const PATH = "likes.json";
  const BRANCH = "data";
  const LS_MARKS = "ultrafilter:likes-overrides";
  const LS_TOKEN = "ultrafilter:ghToken";
  const LS_REPO = "ultrafilter:ghRepo";
  const LS_OPTOUT = "ultrafilter:likes-local-only";
  // The previous, albums-only client kept its marks here; they are folded in once.
  const LS_OLD_MARKS = "uf-listening-overrides";

  /* ------------------------------- state -------------------------------- */

  const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const albumKey = (artist, album) => `${norm(artist)}::${norm(album)}`;
  const fullKey = (kind, key) => `${kind}:${key}`;
  const today = () => new Date().toLocaleDateString("en-CA");   // local YYYY-MM-DD

  const baked = new Map();     // fullKey -> item, from data/likes.json
  let live = null;             // fullKey -> item, from GitHub
  let onChange = () => {};     // page hook: re-render indicators
  const meta = new Map();      // fullKey -> what the page knows, for hearts it rendered

  const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };
  const store = {
    get marks() { try { return JSON.parse(localStorage.getItem(LS_MARKS)) || {}; } catch { return {}; } },
    set marks(v) { lsSet(LS_MARKS, JSON.stringify(v)); },
    get token() { return lsGet(LS_TOKEN); },
    set token(v) { lsSet(LS_TOKEN, v); },
    get optout() { return lsGet(LS_OPTOUT) === "1"; },
    set optout(v) { lsSet(LS_OPTOUT, v ? "1" : ""); },
  };

  // On GitHub Pages the repository is readable off the URL; anywhere else
  // (localhost, a custom domain) the add-a-blog dialog's stored value serves.
  function repoFromUrl() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    const seg = location.pathname.split("/").filter(Boolean)[0];
    return m && seg ? `${m[1]}/${seg}` : "";
  }
  const currentRepo = () => repoFromUrl() || lsGet(LS_REPO);
  const apiUrl = () => `https://api.github.com/repos/${currentRepo()}/contents/${PATH}`;

  // Fold the old albums-only overrides into the new store, once.
  {
    const old = lsGet(LS_OLD_MARKS);
    if (old) {
      try {
        const marks = store.marks;
        for (const [k, m] of Object.entries(JSON.parse(old) || {})) {
          const fk = fullKey("album", k);
          if (marks[fk] !== undefined) continue;
          marks[fk] = m.listened
            ? { kind: "album", key: k, artist: m.artist, album: m.album, listened: m.date, liked: Boolean(m.liked), when: m.date }
            : null;
        }
        store.marks = marks;
      } catch {}
      lsSet(LS_OLD_MARKS, "");
    }
  }

  function seed(items) {
    for (const it of items || []) {
      if (!it?.kind || !it?.key) continue;
      const fk = fullKey(it.kind, it.key);
      if (!baked.has(fk)) baked.set(fk, it);
    }
  }
  /** Album flags from a page payload that carries listened/liked (baked by the build). */
  function seedAlbums(entries) {
    for (const e of entries || []) {
      if (!e?.artist || !e?.album || !e.listened) continue;
      const k = albumKey(e.artist, e.album), fk = fullKey("album", k);
      if (!baked.has(fk)) baked.set(fk, { kind: "album", key: k, artist: e.artist, album: e.album,
        genres: e.genres || [], liked: Boolean(e.liked) });
    }
  }

  /** The current item for (kind, key), or null. */
  function state(kind, key) {
    const fk = fullKey(kind, key);
    const marks = store.marks;
    if (fk in marks) return marks[fk];            // null here is a tombstone
    const src = live || baked;
    return src.get(fk) || null;
  }
  const isLiked = (kind, key) => {
    const it = state(kind, key);
    return Boolean(it && (kind === "album" ? it.liked : true));
  };
  function albumState(artist, album) {
    const it = state("album", albumKey(artist, album));
    return { listened: Boolean(it), liked: Boolean(it?.liked) };
  }
  /** Every current item of one kind, overrides applied. */
  function of(kind) {
    const out = new Map();
    for (const [fk, it] of live || baked) if (it?.kind === kind) out.set(fk, it);
    for (const [fk, it] of Object.entries(store.marks)) {
      if (!fk.startsWith(`${kind}:`)) continue;
      if (it) out.set(fk, it); else out.delete(fk);
    }
    return [...out.values()];
  }

  /* ------------------------------ markup --------------------------------- */

  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3C6.4 16.3 3 13 3 9.3 3 6.7 5 4.8 7.4 4.8c1.8 0 3.4 1 4.6 2.7 1.2-1.7 2.8-2.7 4.6-2.7C19 4.8 21 6.7 21 9.3c0 3.7-3.4 7-9 11z"/></svg>`;

  /** The album control: Listened checkbox, then a heart once checked. */
  function control(artist, album, extra = {}) {
    const k = albumKey(artist, album);
    meta.set(fullKey("album", k), { artist, album, ...extra });
    const s = albumState(artist, album);
    return `<div class="ll-ctl${s.listened ? " ll-on" : ""}${s.liked ? " ll-loved" : ""}"
      data-ll-artist="${esc(artist)}" data-ll-album="${esc(album)}">
      <label class="ll-listen">
        <input type="checkbox" class="ll-box" ${s.listened ? "checked" : ""}
          aria-label="Listened to ${esc(album)}">
        <span class="ll-tick">${CHECK}</span><span class="ll-lab">Listened</span>
      </label>
      <button type="button" class="ll-heart" aria-pressed="${s.liked}"
        aria-label="Liked ${esc(album)}" ${s.listened ? "" : "hidden"}>
        ${HEART}<span class="ll-ring"></span>
      </button>
    </div>`;
  }

  /** Read-only indicators, for archive tiles. */
  function badges(artist, album) {
    const s = albumState(artist, album);
    if (!s.listened) return "";
    return `<span class="ll-badges" aria-hidden="true">
      <span class="ll-bdg-tick">${CHECK}</span>${s.liked ? `<span class="ll-bdg-heart">${HEART}</span>` : ""}
    </span>`;
  }

  /**
   * A plain heart for anything else. `info` is what the like records
   * (title, url, source, topic…); `size` is "sm" (inline in a row) or "lg".
   */
  function heart(kind, key, info = {}, size = "sm") {
    if (!key) return "";
    meta.set(fullKey(kind, key), info);
    const on = isLiked(kind, key);
    const what = info.title ? ` ${info.title}` : "";
    return `<button type="button" class="uf-heart uf-${size}" data-uf-kind="${esc(kind)}" data-uf-key="${esc(key)}"
      aria-pressed="${on}" aria-label="${on ? "Unlike" : "Like"}${esc(what)}" title="${on ? "Liked" : "Like"}">
      ${HEART}<span class="ll-ring"></span></button>`;
  }

  /** Brings every rendered control in line with current state, without
   *  re-rendering (so in-flight animations survive). */
  function syncCtls() {
    document.querySelectorAll(".ll-ctl").forEach(ctl => {
      const s = albumState(ctl.dataset.llArtist, ctl.dataset.llAlbum);
      const box = ctl.querySelector(".ll-box");
      const h = ctl.querySelector(".ll-heart");
      if (box.checked !== s.listened) box.checked = s.listened;
      ctl.classList.toggle("ll-on", s.listened);
      ctl.classList.toggle("ll-loved", s.liked);
      h.hidden = !s.listened;
      h.setAttribute("aria-pressed", String(s.liked));
    });
    document.querySelectorAll(".uf-heart").forEach(h => {
      const on = isLiked(h.dataset.ufKind, h.dataset.ufKey);
      h.setAttribute("aria-pressed", String(on));
      h.title = on ? "Liked" : "Like";
    });
  }

  /* ----------------------------- interaction ----------------------------- */

  /** Records an item (or, with null, its removal) locally and queues the push. */
  function set(kind, key, item) {
    const marks = store.marks;
    marks[fullKey(kind, key)] = item ? { ...item, kind, key, when: today() } : null;
    store.marks = marks;
    onChange();
    schedulePush();
  }

  function setAlbum(artist, album, listened, liked) {
    const k = albumKey(artist, album);
    const info = meta.get(fullKey("album", k)) || {};
    const prev = state("album", k);
    set("album", k, listened ? {
      artist, album,
      genres: info.genres || prev?.genres || [],
      listened: prev?.listened || today(),
      liked: Boolean(listened && liked),
    } : null);
  }

  function pop(el) {
    el.classList.remove("ll-pop"); void el.offsetWidth;   // restart the animation
    el.classList.add("ll-pop");
  }

  function bind(root) {
    root.addEventListener("click", e => {
      // Plain hearts (artwork, wiki entries, posts).
      const h = e.target.closest(".uf-heart");
      if (h) {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) return openDialog();
        const { ufKind: kind, ufKey: key } = h.dataset;
        const liked = h.getAttribute("aria-pressed") !== "true";
        h.setAttribute("aria-pressed", liked);
        if (liked) pop(h);
        set(kind, key, liked ? { ...(meta.get(fullKey(kind, key)) || {}) } : null);
        maybeOffer();
        return;
      }

      const ctl = e.target.closest(".ll-ctl");
      if (!ctl) return;
      e.stopPropagation();                     // cards/tiles have their own click handlers
      const { llArtist: artist, llAlbum: album } = ctl.dataset;

      if (e.target.closest(".ll-listen")) {
        if (e.shiftKey) { e.preventDefault(); openDialog(); }
        return;   // the change listener below does the work
      }

      const heartBtn = e.target.closest(".ll-heart");
      if (heartBtn) {
        const liked = heartBtn.getAttribute("aria-pressed") !== "true";
        heartBtn.setAttribute("aria-pressed", liked);
        ctl.classList.toggle("ll-loved", liked);
        if (liked) pop(heartBtn);
        setAlbum(artist, album, true, liked);
      }
    });

    root.addEventListener("change", e => {
      if (!e.target.classList?.contains("ll-box")) return;
      const ctl = e.target.closest(".ll-ctl");
      const { llArtist: artist, llAlbum: album } = ctl.dataset;
      const on = e.target.checked;
      const heartBtn = ctl.querySelector(".ll-heart");
      ctl.classList.toggle("ll-on", on);
      if (on) { heartBtn.hidden = false; heartBtn.classList.add("ll-enter"); }
      else {
        heartBtn.hidden = true;
        heartBtn.classList.remove("ll-enter");
        ctl.classList.remove("ll-loved");
        heartBtn.setAttribute("aria-pressed", "false");
      }
      setAlbum(artist, album, on, on && ctl.classList.contains("ll-loved"));
      maybeOffer();
    });
  }

  /* ------------------------------ write-back ----------------------------- */

  const gh = token => ({
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  });

  // UTF-8 <-> base64.
  const b64e = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));

  const toMap = items => new Map((items || []).filter(it => it?.kind && it?.key).map(it => [fullKey(it.kind, it.key), it]));
  // Stable order in the file: by kind, then when, then key — so diffs read.
  const KIND_ORDER = { album: 0, artwork: 1, wiki: 2, post: 3 };
  const serialize = map => {
    const items = [...map.values()].sort((a, b) =>
      (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
      String(a.when || "").localeCompare(String(b.when || "")) || String(a.key).localeCompare(String(b.key)));
    return JSON.stringify({ version: 1, updated: new Date().toISOString(), items }, null, 1) + "\n";
  };

  let pushing = Promise.resolve();
  let pushQueued = false;
  let liveGen = 0;   // bumped whenever push() writes `live`, so a slow
                     // load-time refresh() can't overwrite fresher state

  function schedulePush() {
    if (!store.token || !currentRepo() || pushQueued) return;
    pushQueued = true;
    pushing = pushing.then(() => { pushQueued = false; return push(); }).catch(() => {});
  }

  /** Applies every local override to the server copy, then drops them. */
  async function push(attempt = 1) {
    const token = store.token;
    const applied = store.marks;
    const keys = Object.keys(applied);
    if (!token || !keys.length) return;

    // Current server copy (404 = no file yet).
    let sha = null, map = new Map();
    const res = await fetch(`${apiUrl()}?ref=${BRANCH}&t=${Date.now()}`, { headers: gh(token) });
    if (res.ok) {
      const doc = await res.json();
      sha = doc.sha;
      try { map = toMap(JSON.parse(b64d(doc.content)).items); } catch { map = new Map(); }
    } else if (res.status === 401 || res.status === 403) {
      throw fail("the token was refused — shift-click a heart to update it");
    } else if (res.status !== 404) {
      throw fail(`reading ${PATH} failed (HTTP ${res.status})`);
    }

    for (const fk of keys) {
      const m = applied[fk];
      if (!m) { map.delete(fk); continue; }
      const prev = map.get(fk);
      // An album's first-listened date is whichever is older.
      map.set(fk, m.kind === "album" && prev?.listened && (!m.listened || prev.listened < m.listened)
        ? { ...m, listened: prev.listened } : m);
    }

    if (!sha && !map.size) {   // nothing to record and no file to trim
      const marks = store.marks;
      for (const k of keys) delete marks[k];
      store.marks = marks;
      return;
    }

    const put = await fetch(apiUrl(), {
      method: "PUT",
      headers: gh(token),
      body: JSON.stringify({
        message: "Update likes",
        content: b64e(serialize(map)),
        branch: BRANCH,
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.status === 409 || put.status === 422) {
      if (attempt < 3) return push(attempt + 1);       // raced another writer; refetch and retry
      throw fail("the file changed underneath us; your marks are kept locally");
    }
    if (put.status === 401 || put.status === 403) {
      throw fail("the token was refused — shift-click a heart to update it");
    }
    if (put.status === 404) {
      throw fail(`GitHub can't see ${currentRepo()}'s ${BRANCH} branch — check the token's repository access`);
    }
    if (!put.ok) throw fail(`saving failed (HTTP ${put.status})`);

    // Server now agrees with everything we sent; drop those overrides.
    const marks = store.marks;
    for (const k of keys) {
      if (JSON.stringify(marks[k]) === JSON.stringify(applied[k])) delete marks[k];
    }
    store.marks = marks;
    live = map;
    liveGen++;
    onChange();
  }

  function fail(msg) {
    toast(`Likes: ${msg}`);
    return new Error(msg);
  }

  /** Fresh copy of the file: through the API with a token, else raw. */
  async function refresh() {
    const repo = currentRepo();
    if (!repo) return;
    const token = store.token;
    const gen = liveGen;
    try {
      const res = token
        ? await fetch(`${apiUrl()}?ref=${BRANCH}&t=${Date.now()}`,
            { headers: { ...gh(token), Accept: "application/vnd.github.raw+json" } })
        : await fetch(`https://raw.githubusercontent.com/${repo}/${BRANCH}/${PATH}?t=${Date.now()}`,
            { cache: "no-store" });
      if (gen !== liveGen) return;   // a push landed while we were fetching
      if (res.status === 404) { live = new Map(); onChange(); return; }
      if (!res.ok) return;
      const doc = await res.json();
      if (gen !== liveGen) return;
      live = toMap(doc.items);
      onChange();
    } catch { /* offline is fine; baked state stands */ }
  }

  /* ------------------------------ dialog & toast ------------------------- */

  let offered = false;
  function maybeOffer() {
    if (store.token || store.optout || offered) return;
    offered = true;
    openDialog(true);
  }

  function openDialog(firstRun = false) {
    document.getElementById("ll-dialog")?.remove();
    const div = document.createElement("div");
    div.id = "ll-dialog";
    const repo = currentRepo();
    div.innerHTML = `<div class="ll-panel" role="dialog" aria-modal="true" aria-label="Likes sync">
      <h3>Sync your likes?</h3>
      <p>${firstRun ? "That mark is saved in this browser. " : ""}With a GitHub token it is also
      committed to <code>${esc(repo || "this repository")}</code> (the <code>${BRANCH}</code> branch),
      so it follows you across devices and the morning picks learn from it.</p>
      <p class="ll-fine">Fine-grained PAT, <b>Contents read &amp; write</b> on that one repository —
      the same token the add-a-blog dialog uses. It stays in this browser's local storage.
      Shift-click any heart to reopen this.</p>
      ${repo ? "" : `<input type="text" id="ll-repo" placeholder="owner/repository" autocomplete="off" value="${esc(lsGet(LS_REPO))}">`}
      <input type="password" id="ll-token" placeholder="github_pat_…" autocomplete="off"
        value="${esc(store.token)}">
      <div class="ll-row">
        <button type="button" id="ll-save">Save</button>
        <button type="button" id="ll-skip">${store.token ? "Forget token" : "Keep it local"}</button>
      </div>
    </div>`;
    document.body.appendChild(div);
    const close = () => div.remove();
    div.addEventListener("click", e => { if (e.target === div) close(); });
    div.querySelector("#ll-save").addEventListener("click", () => {
      const r = div.querySelector("#ll-repo");
      if (r) lsSet(LS_REPO, r.value.trim());
      const v = div.querySelector("#ll-token").value.trim();
      if (v) { store.token = v; store.optout = false; refresh().then(schedulePush); }
      close();
    });
    div.querySelector("#ll-skip").addEventListener("click", () => {
      if (store.token) store.token = ""; else store.optout = true;
      close();
    });
    div.querySelector("#ll-token").focus();
  }

  let toastTimer;
  function toast(msg) {
    let t = document.getElementById("ll-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "ll-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("ll-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("ll-show"), 5000);
  }

  /* -------------------------------- styles ------------------------------- */

  const css = `
  .ll-ctl { display: flex; align-items: center; gap: .55rem; margin-top: .55rem;
    font-family: var(--mono, monospace); font-size: .68rem; color: rgba(240,235,225,.85);
    line-height: 1; user-select: none; -webkit-user-select: none; }
  .ll-listen { display: inline-flex; align-items: center; gap: .4rem; cursor: pointer; }
  .ll-box { position: absolute; opacity: 0; pointer-events: none; }
  .ll-tick { display: inline-flex; align-items: center; justify-content: center;
    width: 1rem; height: 1rem; border: 1px solid rgba(240,235,225,.55); border-radius: .25rem;
    color: transparent; transition: background .15s ease, border-color .15s ease; }
  .ll-tick svg { width: .72rem; height: .72rem;
    stroke-dasharray: 16; stroke-dashoffset: 16; }
  .ll-listen:hover .ll-tick { border-color: rgba(240,235,225,.9); }
  .ll-box:focus-visible + .ll-tick { outline: 2px solid rgba(240,235,225,.8); outline-offset: 2px; }
  .ll-on .ll-tick { background: rgba(240,235,225,.92); border-color: rgba(240,235,225,.92);
    color: var(--acc, #3F5164); }
  .ll-on .ll-tick svg { animation: ll-draw .3s ease-out forwards; }
  @keyframes ll-draw { to { stroke-dashoffset: 0; } }
  .ll-lab { letter-spacing: .04em; }

  .ll-heart[hidden] { display: none; }
  .ll-heart, .uf-heart { position: relative; display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; padding: 0; border: 0; background: none; cursor: pointer;
    color: rgba(240,235,225,.5); border-radius: 999px; }
  .ll-heart svg, .uf-heart svg { width: 1.05rem; height: 1.05rem; fill: none; stroke: currentColor;
    stroke-width: 1.6; transition: color .15s ease, fill .15s ease, transform .15s ease; }
  .ll-heart:hover svg { color: rgba(240,235,225,.95); transform: scale(1.12); }
  .ll-heart.ll-enter svg { animation: ll-in .35s cubic-bezier(.34,1.56,.64,1) both; }
  @keyframes ll-in { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .ll-loved .ll-heart svg, .ll-heart[aria-pressed="true"] svg, .uf-heart[aria-pressed="true"] svg {
    fill: #E8788A; stroke: #E8788A; color: #E8788A; }
  .ll-heart.ll-pop svg, .uf-heart.ll-pop svg { animation: ll-beat .45s cubic-bezier(.34,1.56,.64,1); }
  @keyframes ll-beat { 0% { transform: scale(1); } 30% { transform: scale(1.45); }
    55% { transform: scale(.92); } 100% { transform: scale(1); } }
  .ll-ring { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
  .ll-heart.ll-pop .ll-ring, .uf-heart.ll-pop .ll-ring { animation: ll-ring .5s ease-out; }
  @keyframes ll-ring { 0% { box-shadow: 0 0 0 0 rgba(232,120,138,.7); opacity: 1; }
    100% { box-shadow: 0 0 0 .8rem rgba(232,120,138,0); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .ll-heart svg, .uf-heart svg, .ll-tick svg { animation: none !important; transition: none; } }

  /* Plain hearts sit on the page ground, in the theme's muted ink. */
  .uf-heart { color: var(--faint, #9AA1A6); flex: none; vertical-align: middle; }
  .uf-heart:hover { background: var(--hover, transparent); }
  .uf-heart:hover svg { color: var(--ink, #20262B); transform: scale(1.12); }
  .uf-heart:focus-visible { outline: 2px solid var(--accent, #4756A8); outline-offset: 1px; }
  .uf-sm { width: 1.3rem; height: 1.3rem; }
  .uf-sm svg { width: .9rem; height: .9rem; }
  .uf-lg svg { width: 1.15rem; height: 1.15rem; }

  .ll-badges { display: inline-flex; gap: .3rem; align-items: center; }
  .ll-badges svg { width: .7rem; height: .7rem; display: block; }
  .ll-bdg-tick { color: rgba(240,235,225,.9); }
  .ll-bdg-heart { color: #E8788A; }
  .ll-bdg-heart svg { fill: currentColor; }

  #ll-dialog { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.45);
    display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .ll-panel { background: var(--bg, #F7F3EB); color: var(--ink, #20262B);
    border: 1px solid var(--line, #E0D9CB); border-radius: .6rem; max-width: 26rem;
    padding: 1.1rem 1.25rem; font-family: var(--body, system-ui, sans-serif); font-size: .88rem;
    box-shadow: 0 12px 40px rgba(0,0,0,.35); }
  .ll-panel h3 { margin: 0 0 .5rem; font-family: var(--display, serif); font-size: 1.15rem; }
  .ll-panel p { margin: .4rem 0; line-height: 1.45; }
  .ll-panel .ll-fine { font-size: .78rem; color: var(--muted, #6B7278); }
  .ll-panel code { font-family: var(--mono, monospace); font-size: .8em; }
  .ll-panel input { width: 100%; box-sizing: border-box; margin: .5rem 0; padding: .45rem .55rem;
    font-family: var(--mono, monospace); font-size: .8rem; color: var(--ink, #20262B);
    background: transparent; border: 1px solid var(--line, #E0D9CB); border-radius: .35rem; }
  .ll-row { display: flex; gap: .6rem; justify-content: flex-end; margin-top: .5rem; }
  .ll-row button { font: inherit; font-size: .82rem; padding: .35rem .8rem; cursor: pointer;
    border-radius: .35rem; border: 1px solid var(--line, #E0D9CB);
    background: transparent; color: var(--ink, #20262B); }
  .ll-row #ll-save { background: var(--accent, #4756A8); border-color: var(--accent, #4756A8);
    color: #fff; }

  #ll-toast { position: fixed; left: 50%; bottom: 1.2rem; transform: translate(-50%, .5rem);
    z-index: 70; background: var(--ink, #20262B); color: var(--bg, #F7F3EB);
    font-family: var(--body, system-ui, sans-serif); font-size: .8rem;
    padding: .5rem .9rem; border-radius: .4rem; opacity: 0; pointer-events: none;
    transition: opacity .25s ease, transform .25s ease; max-width: 90vw; }
  #ll-toast.ll-show { opacity: 1; transform: translate(-50%, 0); }`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  return { albumKey, seed, seedAlbums, state, isLiked, albumState, of, control, badges, heart,
           bind, refresh, openDialog, schedulePush, syncCtls, set,
           set onChange(fn) { onChange = fn; } };
})();

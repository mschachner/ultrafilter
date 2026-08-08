/**
 * Listening log — the client side. Renders a "Listened" checkbox on every
 * album card and, once checked, a heart for marking the album liked; keeps
 * the marks in localStorage, and (when a token is configured) commits them
 * as listening_log.csv to the private spotify-recs repository through the
 * GitHub contents API, where the morning album task and the site build can
 * read them back.
 *
 * State precedence, most authoritative first:
 *   1. local overrides — marks made in this browser, kept until the commit
 *      to GitHub succeeds (then the server copy agrees and the override is
 *      dropped);
 *   2. the live log — listening_log.csv fetched straight from GitHub on
 *      load, when a token is present;
 *   3. baked state — the listened/liked flags the site build stamped into
 *      albums.json / archive.json, which is what token-less browsers see.
 *
 * The token is a fine-grained PAT (Contents read/write on spotify-recs
 * only), pasted once into the setup dialog and kept in this browser's
 * localStorage. It never appears in the page source or the deployed site.
 * Shift-click any "Listened" checkbox to reopen the sync settings.
 */

const LL = (() => {
  const REPO = "mschachner/spotify-recs";
  const PATH = "listening_log.csv";
  const API = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
  const LS_MARKS = "uf-listening-overrides";
  const LS_TOKEN = "uf-listening-token";
  const LS_OPTOUT = "uf-listening-local-only";

  /* ------------------------------- state -------------------------------- */

  const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const key = (artist, album) => `${norm(artist)}::${norm(album)}`;

  const baked = new Map();     // from page data
  let live = null;             // from GitHub, when a token is present
  let onChange = () => {};     // page hook: re-render indicators

  const store = {
    get marks() { try { return JSON.parse(localStorage.getItem(LS_MARKS)) || {}; } catch { return {}; } },
    set marks(v) { try { localStorage.setItem(LS_MARKS, JSON.stringify(v)); } catch {} },
    // Deliberately NOT falling back to the blogroll dialog's token
    // (ultrafilter:ghToken): that PAT is typically scoped to the site repo
    // only, and a token that can't see spotify-recs reads as 404 — which
    // would silently shadow the baked marks and fail every push.
    get token() {
      try { return localStorage.getItem(LS_TOKEN) || ""; } catch { return ""; }
    },
    set token(v) { try { v ? localStorage.setItem(LS_TOKEN, v) : localStorage.removeItem(LS_TOKEN); } catch {} },
    get optout() { try { return localStorage.getItem(LS_OPTOUT) === "1"; } catch { return false; } },
    set optout(v) { try { v ? localStorage.setItem(LS_OPTOUT, "1") : localStorage.removeItem(LS_OPTOUT); } catch {} },
  };

  function seed(entries) {
    for (const e of entries || []) {
      if (!e?.artist || !e?.album) continue;
      const k = key(e.artist, e.album);
      if (e.listened && !baked.has(k)) baked.set(k, { listened: true, liked: Boolean(e.liked) });
    }
  }

  function state(artist, album) {
    const k = key(artist, album);
    const o = store.marks[k];
    if (o) return { listened: Boolean(o.listened), liked: Boolean(o.liked) };
    const src = live || baked;
    const m = src.get(k);
    return { listened: Boolean(m?.listened), liked: Boolean(m?.liked) };
  }

  /* ------------------------------ markup --------------------------------- */

  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const CHECK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3C6.4 16.3 3 13 3 9.3 3 6.7 5 4.8 7.4 4.8c1.8 0 3.4 1 4.6 2.7 1.2-1.7 2.8-2.7 4.6-2.7C19 4.8 21 6.7 21 9.3c0 3.7-3.4 7-9 11z"/></svg>`;

  /** The full control, for cards and the detail sleeve. */
  function control(artist, album) {
    const s = state(artist, album);
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
    const s = state(artist, album);
    if (!s.listened) return "";
    return `<span class="ll-badges" aria-hidden="true">
      <span class="ll-bdg-tick">${CHECK}</span>${s.liked ? `<span class="ll-bdg-heart">${HEART}</span>` : ""}
    </span>`;
  }

  /** Brings every rendered control in line with current state, without
   *  re-rendering (so in-flight animations survive). */
  function syncCtls() {
    document.querySelectorAll(".ll-ctl").forEach(ctl => {
      const s = state(ctl.dataset.llArtist, ctl.dataset.llAlbum);
      const box = ctl.querySelector(".ll-box");
      const heart = ctl.querySelector(".ll-heart");
      if (box.checked !== s.listened) box.checked = s.listened;
      ctl.classList.toggle("ll-on", s.listened);
      ctl.classList.toggle("ll-loved", s.liked);
      heart.hidden = !s.listened;
      heart.setAttribute("aria-pressed", String(s.liked));
    });
  }

  /* ----------------------------- interaction ----------------------------- */

  function setMark(artist, album, listened, liked) {
    const marks = store.marks;
    marks[key(artist, album)] = {
      artist, album, listened, liked: listened && liked,
      date: new Date().toLocaleDateString("en-CA"),   // local YYYY-MM-DD
    };
    store.marks = marks;
    onChange();
    schedulePush();
  }

  function bind(root) {
    root.addEventListener("click", e => {
      const ctl = e.target.closest(".ll-ctl");
      if (!ctl) return;
      e.stopPropagation();                     // cards/tiles have their own click handlers
      const { llArtist: artist, llAlbum: album } = ctl.dataset;

      if (e.target.closest(".ll-listen")) {
        if (e.shiftKey) { e.preventDefault(); openDialog(); }
        return;   // the change listener below does the work
      }

      const heart = e.target.closest(".ll-heart");
      if (heart) {
        const liked = heart.getAttribute("aria-pressed") !== "true";
        heart.setAttribute("aria-pressed", liked);
        ctl.classList.toggle("ll-loved", liked);
        if (liked) {
          heart.classList.remove("ll-pop"); void heart.offsetWidth;   // restart
          heart.classList.add("ll-pop");
        }
        setMark(artist, album, true, liked);
      }
    });

    root.addEventListener("change", e => {
      if (!e.target.classList?.contains("ll-box")) return;
      const ctl = e.target.closest(".ll-ctl");
      const { llArtist: artist, llAlbum: album } = ctl.dataset;
      const on = e.target.checked;
      const heart = ctl.querySelector(".ll-heart");
      ctl.classList.toggle("ll-on", on);
      if (on) { heart.hidden = false; heart.classList.add("ll-enter"); }
      else {
        heart.hidden = true;
        heart.classList.remove("ll-enter");
        ctl.classList.remove("ll-loved");
        heart.setAttribute("aria-pressed", "false");
      }
      setMark(artist, album, on, on && ctl.classList.contains("ll-loved"));
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

  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(f => f !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(f => f !== "")) rows.push(row);
    return rows;
  }
  const csvField = s => /[",\n\r]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s);

  let pushing = Promise.resolve();
  let pushQueued = false;
  let liveGen = 0;   // bumped whenever push() writes `live`, so a slow
                     // load-time refresh() can't overwrite fresher state

  function schedulePush() {
    if (!store.token || pushQueued) return;
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
    let sha = null, rows = [], header = ["artist", "album", "first_listened", "liked"];
    const res = await fetch(`${API}?t=${Date.now()}`, { headers: gh(token) });
    if (res.ok) {
      const doc = await res.json();
      sha = doc.sha;
      const parsed = parseCsv(b64d(doc.content));
      if (parsed.length && parsed[0].includes("artist")) { header = parsed[0]; rows = parsed.slice(1); }
      else rows = parsed;
    } else if (res.status !== 404) {
      throw fail(`reading ${PATH} failed (HTTP ${res.status})`);
    }

    // Rows are rebuilt in canonical column order regardless of the order the
    // server copy happened to use, so a reordered file can't misalign fields.
    const col = name => header.indexOf(name);
    const byKey = new Map(rows.map(r => [key(r[col("artist")], r[col("album")]), {
      artist: r[col("artist")], album: r[col("album")],
      first_listened: r[col("first_listened")] || "", liked: r[col("liked")] || "false",
    }]));
    for (const k of keys) {
      const m = applied[k];
      if (!m.listened) { byKey.delete(k); continue; }
      byKey.set(k, {
        artist: m.artist, album: m.album,
        first_listened: byKey.get(k)?.first_listened || m.date,
        liked: String(Boolean(m.liked)),
      });
    }

    if (!sha && !byKey.size) {   // nothing to record and no file to trim
      const marks = store.marks;
      for (const k of keys) delete marks[k];
      store.marks = marks;
      return;
    }

    const body = [["artist", "album", "first_listened", "liked"],
      ...[...byKey.values()].map(r => [r.artist, r.album, r.first_listened, r.liked])]
      .map(r => r.map(csvField).join(",")).join("\n") + "\n";
    const put = await fetch(API, {
      method: "PUT",
      headers: gh(token),
      body: JSON.stringify({
        message: "Update listening log",
        content: b64e(body),
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.status === 409 || put.status === 422) {
      if (attempt < 3) return push(attempt + 1);       // raced another writer; refetch and retry
      throw fail("the log changed underneath us; your marks are kept locally");
    }
    if (put.status === 401 || put.status === 403) {
      throw fail("the token was refused — shift-click a checkbox to update it");
    }
    if (!put.ok) throw fail(`saving failed (HTTP ${put.status})`);

    // Server now agrees with everything we sent; drop those overrides.
    const marks = store.marks;
    for (const k of keys) {
      if (JSON.stringify(marks[k]) === JSON.stringify(applied[k])) delete marks[k];
    }
    store.marks = marks;
    live = new Map([...byKey.entries()].map(([k, r]) =>
      [k, { listened: true, liked: r.liked === "true" }]));
    liveGen++;
    onChange();
  }

  function fail(msg) {
    toast(`Listening log: ${msg}`);
    return new Error(msg);
  }

  /** Fresh copy of the log straight from GitHub, when we can read it. */
  async function refresh() {
    const token = store.token;
    if (!token) return;
    const gen = liveGen;
    try {
      const res = await fetch(`${API}?t=${Date.now()}`, {
        headers: { ...gh(token), Accept: "application/vnd.github.raw+json" },
      });
      if (gen !== liveGen) return;   // a push landed while we were fetching
      if (res.status === 404) { live = new Map(); onChange(); return; }
      if (!res.ok) return;
      const rows = parseCsv(await res.text());
      const header = rows.shift() || [];
      const col = name => header.indexOf(name);
      if (col("artist") === -1) return;
      if (gen !== liveGen) return;
      live = new Map(rows.map(r => [
        key(r[col("artist")], r[col("album")]),
        { listened: true, liked: r[col("liked")] === "true" },
      ]));
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
    div.innerHTML = `<div class="ll-panel" role="dialog" aria-modal="true" aria-label="Listening log sync">
      <h3>Sync your listening log?</h3>
      <p>${firstRun ? "That mark is saved in this browser. " : ""}With a GitHub token it can also be
      committed to <code>${REPO}</code>, so it follows you across devices and the album picker
      learns what you liked.</p>
      <p class="ll-fine">Fine-grained PAT, <b>Contents read &amp; write</b> on that one repository.
      It stays in this browser's local storage. Shift-click any checkbox to reopen this.</p>
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
  .ll-heart { position: relative; display: inline-flex; align-items: center; justify-content: center;
    width: 1.5rem; height: 1.5rem; padding: 0; border: 0; background: none; cursor: pointer;
    color: rgba(240,235,225,.5); }
  .ll-heart svg { width: 1.05rem; height: 1.05rem; fill: none; stroke: currentColor;
    stroke-width: 1.6; transition: color .15s ease, fill .15s ease, transform .15s ease; }
  .ll-heart:hover svg { color: rgba(240,235,225,.95); transform: scale(1.12); }
  .ll-heart.ll-enter svg { animation: ll-in .35s cubic-bezier(.34,1.56,.64,1) both; }
  @keyframes ll-in { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .ll-loved .ll-heart svg, .ll-heart[aria-pressed="true"] svg {
    fill: #E8788A; stroke: #E8788A; color: #E8788A; }
  .ll-heart.ll-pop svg { animation: ll-beat .45s cubic-bezier(.34,1.56,.64,1); }
  @keyframes ll-beat { 0% { transform: scale(1); } 30% { transform: scale(1.45); }
    55% { transform: scale(.92); } 100% { transform: scale(1); } }
  .ll-ring { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
  .ll-heart.ll-pop .ll-ring { animation: ll-ring .5s ease-out; }
  @keyframes ll-ring { 0% { box-shadow: 0 0 0 0 rgba(232,120,138,.7); opacity: 1; }
    100% { box-shadow: 0 0 0 .8rem rgba(232,120,138,0); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .ll-heart svg, .ll-tick svg { animation: none !important; transition: none; } }

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

  return { key, seed, state, control, badges, bind, refresh, openDialog, schedulePush, syncCtls,
    set onChange(fn) { onChange = fn; } };
})();

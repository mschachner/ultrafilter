# Ultrafilter

A personal daily feed on GitHub Pages, in five sections: a hand-picked
blogroll, the weather, a tabbed wikis section (Wikipedia's featured
article and quality picks, and a few entries a day from the nLab, the
Stanford Encyclopedia of Philosophy, Cantor's Attic, and the OEIS, plus the
week's MathOverflow questions and the newest arXiv listings), the day's
three album picks, and a daily artwork.

The architecture is one-directional. A scheduled GitHub Action builds every
section's data file and deploys the site (page + data) straight to Pages —
nothing is committed back to `main`, so it only ever contains your own
commits. Everything editorial lives on a second, orphan branch of the same
repository, `data` — the *store*: the morning task's album, artwork, and
wiki picks, the recommendation history, the Spotify library export, and
`likes.json`, the record of every heart on the site. A scheduled Claude task
writes its picks there each morning; the page writes likes there; the build
reads the branch (checked out beside the code) and publishes. Pushes to
`data` don't trigger a rebuild, so a like never redeploys the site — the next
scheduled build folds it in. Weather is the one exception to build-time
fetching — the page queries Open-Meteo directly on load, so the temperature
on screen is current rather than build-time.

Each section's data is built independently, and a section whose build fails
falls back to the copy currently published on the live site, so one flaky
upstream can't blank the rest of the page. The same mechanism keeps the
daily sections stable: a rebuild that finds today's wikis payload
already published reuses it instead of re-rolling the picks.

## Sections

### Blogroll

Link-only: titles, dates, and links out to the original — no reader view.
The page shows the newest 15 posts; a *Show more* button reveals the rest.
Fetching happens on GitHub's servers rather than in your browser, which
solves two problems a browser version would have: no CORS restrictions, and
requests can carry a normal browser `User-Agent`, which gets past publishers
that reject anonymous fetchers.

Which blogs are fetched is the *roll* — `blogroll.json` in the store
(see [The roll](#the-roll) below), not `config.json`, which keeps only the
topics, the fetch settings, and the rotation policy.

Two optional per-feed keys in the roll help with awkward publishers:

- `"altFeeds": ["https://example.org/?feed=rss2"]` — other URLs to try if the
  primary one fails. Useful when a site exposes the same feed at more than one
  path and a firewall only guards one of them.
- `"proxyFallback": false` — skip the indirect sources for this feed. By
  default, a feed that fails every direct URL is retried via `r.jina.ai` and
  `api.allorigins.win` (read-through proxies), and finally via Feedly's
  public API, whose crawler has already fetched and parsed the feed —
  immune to publisher-side blocks, at the cost of being Feedly's copy rather
  than the publisher's. The ledger marks these as `via proxy` / `via feedly`.

A source only counts as working if its response actually parses as a feed —
a `200` that turns out to be a challenge page (or a proxy that rewrites the
XML) falls through to the next source like any other failure.

### Weather

Fetched client-side from [Open-Meteo](https://open-meteo.com/) (free, no
API key) and rendered in the masthead next to the date. The build only
passes the `weather` block of `config.json` through to the page: place
name, coordinates, timezone, units (`temperatureUnit`, `windSpeedUnit`),
forecast days. Note that the coordinates are readable by anyone who finds
the page.

### Wikis

One section, several tabs — one per source — sharing a layout: a lead
entry (title, a one-line description, the opening of the entry) beside a
short column of side picks. The tab strip remembers the last tab chosen
per browser (`ultrafilter:wikiTab`). All tabs are built into one file,
`data/wikis.json`, but each tab builds and fails independently: a tab whose
source is down keeps its previously published contents (marked `stale` in
the heading and in the ledger, which counts fresh tabs and names the
others), so one dead site never blanks the rest. The order of tabs, and
which are built at all, is `wikis.tabs` in `config.json`; per-tab settings
sit beside it under the tab's id.

The random-draw tabs are keyed to the local date and re-rolled once a day,
however often the build runs. On top of the draw sit the morning task's
picks (see *The morning task* below): on Wikipedia the featured article
always leads and the three side picks are the task's; on every other tab
the task's pick is the lead and the side picks are random. The die beside
the heading re-rolls the side picks of the open tab only — the lead stays.
Only Wikipedia answers browser requests, so only its die fetches anew, with
the interest areas weighted by your Wikipedia likes; the other sources' die
draws three at random from the pool the build fetched (`poolSize` entries
per tab). A tab's published payload is reused on the same day only when it
reflects the same picks, so the 9:45 UTC build picks up what the task
published after the earlier run.

- **Wikipedia.** The featured article comes from Wikimedia's featured-content
  API. The side picks are the task's when it has published them (each
  resolved through the REST summary endpoint, so the text is Wikipedia's);
  any slot left over is a random member of English Wikipedia's **Good
  articles** category, filtered by `articletopic:` (the ORES topic taxonomy)
  to the interest areas in `config.json`. Which areas are drawn from is a
  weighted choice seeded by the date — an area's weight is 1 plus the
  number of liked Wikipedia entries recorded against it. Each entry in
  `wikipedia.topics` maps an interest area to one or more
  [articletopic values](https://www.mediawiki.org/wiki/Help:CirrusSearch#articletopic);
  add or reweight areas there. The die re-rolls the three side picks live.
- **nLab.** The nLab has no random page and no API, but it does list every
  page name at `/nlab/all_pages`. The build shuffles that list with a seed
  fixed by the date, fetches pages in that order, and keeps the ones with a
  real *Idea* section (falling back to *Definition*), skipping people,
  reference, and meta pages. Formulas come through as their TeX, rendered
  down to Unicode where it's just Greek letters and common symbols.
- **SEP.** Entries from the Stanford Encyclopedia of Philosophy's table of
  contents, shuffled the same way; the extract is the entry's preamble and
  the description its publication line.
- **Cantor's Attic.** The original wiki at cantorsattic.info now sits behind
  a Cloudflare challenge; the maintained copy is a static site built from
  [neugierde/cantors-attic](https://github.com/neugierde/cantors-attic), one
  Markdown file per page. The build lists those through the GitHub tree API
  and reads each page's raw Markdown (front matter for the title, first
  paragraph for the extract); links go to the rendered site.
- **OEIS.** Random A-numbers, looked up one at a time through the JSON search
  API (anonymous search can't page past its first hundred hits, so there is
  no other way to sample the whole database). Dead and trivial entries are
  skipped and the draw prefers sequences the editors flagged `nice` or
  `core`. `maxNumber` is the top of the range to draw from — nudge it up as
  the OEIS grows. The extract is the first terms, in the monospace face.
- **MathOverflow.** The most-voted questions of the past `days` under the
  configured `tags`, via the Stack Exchange API; a quiet week widens the
  window until there are at least `minimum` questions. Rebuilt every run.
- **arXiv.** The newest submissions in `categories`, from the arXiv API's
  Atom feed — sorted by submission date, so cross-lists and replacements
  appear alongside genuinely new papers. Rebuilt every run.

Adding a source means a small builder module in `scripts/sections/wikis/`
returning `{ items: [{ title, description, extract, url }], perPage }`, an
entry in the `TABS` table of `scripts/sections/wikis.mjs`, and its id in
`wikis.tabs`; the page renders any tab of that shape without changes. Two
optional exports let the morning task in: `resolve(url)` turns a picked URL
into an item through the same extractor (a tab without it ignores picks),
and `candidates(n, seed)` lists entries for the task to choose from.

### Artwork

One work a day, picked from Wikidata and described with Wikipedia's own
prose. When the morning task has published a pick for today (a Q-number in
`picks/latest.json`), that is the work: the build resolves it exactly as it
would a drawn one, so image, prose, and artist all come from Wikidata and
Wikipedia. Otherwise the day's work is drawn. Candidates are works matching
the movements (`P135` values), genres
(`P136` values), and optional inception window configured per interest
area in `config.json` — and they must have an English Wikipedia article,
which is what guarantees there's real text to show about the work. The
image comes from Commons (`P18`) when the work has one; otherwise the
article's own lead image is used — usually the fair-use reproduction,
which is the only image that exists for movements whose works are still
in copyright (Abstract Expressionism, Pop Art…), since those can never
carry a free Commons image. A work with neither image is passed over for
the next candidate in the day's order. The article's lead paragraph (and the artist's, when
the creator has an article) comes from the same REST summary endpoint the
Wikipedia tab uses. Which interest area supplies the day is a weighted
choice seeded by the date — an area's weight is its configured `weight`
plus the number of liked works recorded against it; within it the pick is
deterministic — candidates are ordered by a hash of the item and the date —
so rebuilds on the same day agree without any stored state, and
yesterday's work is avoided when there's a choice. The die beside the plate
re-rolls client-side, exactly like the Wikipedia tab's picks: a fresh seed,
straight from the browser (both APIs answer anonymous CORS requests; the
page carries a mirror of the builder's query, so changes to one mean
changes to the other). The die's draw is weighted the same way, and every
artist among your liked works is an area of its own — works by that artist
— weighted by how many of their works you've liked. Commons images hotlink through `Special:FilePath`
at a bounded width, so the page never pulls a full-resolution scan
(fair-use images from Wikipedia are deliberately low-resolution to begin
with and hotlink as-is); clicking the image opens a larger view.

Each entry in `artwork.interests` looks like:

```jsonc
{
  "id": "implandscape",
  "label": "Impressionist landscapes",  // shown above the plate
  "movements": ["Q40415"],              // P135 values — alternatives (OR)
  "genres": ["Q191163"],                // P136 values — alternatives (OR)
  "from": 1860, "to": 1930,             // optional inception window (P571)
  "weight": 3,                          // optional base weight in the draw (default 1)
  "classes": ["Q3305213", "Q11060274"], // optional; the default is painting
  "viaCreator": true,                   // optional; movements also match through the artist
  "creators": ["Q5593"]                 // optional; works by these artists (P170)
}
```

Wikidata tags far more artists with a movement than it tags individual
works — Surrealism has around 55 paintings with an English article tagged
directly, but around 280 by artists tagged as Surrealists. `viaCreator`
accepts a work whose creator (P170) carries the movement too, which is
what keeps small movements from repeating; the cost is a little precision
(a late Picasso still life counts as Cubism because Picasso does). The
published payload also remembers the last 20 picks and the day's draw
skips them when it has a choice.

Within `movements` (and within `genres`) the values are alternatives, but
listing *both* keys requires both to match — the example above means
Impressionist landscapes, not either. `weight` gives favourite areas more
days (and more rolls of the die) before any likes are counted. To add an area, find the
movement or genre on wikidata.org (search for "cubism", say — the Q-number
is right in the page title) and list it. Check which property Wikidata
actually uses for it before deciding between `movements` and `genres`:
ukiyo-e, for instance, is attached to works as a genre (P136), never as a
movement, so listing it under `movements` matches nothing and the section
goes stale on that day. An interest whose tradition isn't mainly paintings
can widen `classes`, as the ukiyo-e default does to include prints,
woodblock and woodcut prints, and print series; a `classes`-only interest
(no movements or genres) works too — the sculpture default is just every
notable sculpture from 1900 on.

### Albums

The "Daily album recommendations" Claude task publishes its three picks —
with blurbs — as `albums/latest.json` (plus a dated copy) in the store, next
to the recommendation-history CSV it already keeps. The build reads that
file straight from the store, then adds cover art to each entry from
Spotify's public oEmbed endpoint (no auth; a missing cover just renders as a
text-only card). On desktop browsers, album links first try the Spotify app
via its `spotify:` URI and fall back to the web player if nothing answers
within a beat — installation can't be detected outright. No file yet: the
section quietly reads `pending` in the ledger. Transient read failures keep
the previous day's picks, marked `stale`.

The archive of every pick lives on its own page, `albums.html` ("All
albums"), linked under the daily cards: sortable by recommendation
date, release year, or artist, and filterable by category, genre, and
search. Its data file, `data/archive.json`, is built by merging the dated
`albums/*.json` files with `recommendation_history.csv` — picks from
before the JSON era appear with facts and cover but no notes. The build
uses the currently-published archive as a cache, so it only reads what's
new. The two pages duplicate the theme CSS; a theme change means editing
both.

## The store

The `data` branch is an orphan branch of this repository — no history in
common with `main` — holding everything the site reads that isn't code or
config:

| Path | Written by | Read by |
| --- | --- | --- |
| `albums/YYYY-MM-DD.json`, `albums/latest.json` | the morning task | the albums and archive builders |
| `recommendation_history.csv` | the morning task | the archive builder, and the task itself (repeat prevention) |
| `picks/YYYY-MM-DD.json`, `picks/latest.json` | the morning task | the artwork and wikis builders |
| `likes.json` | the page (`likes.js`) | the build (every section), the morning task |
| `blogroll.json` | the page (the blogroll menu), the morning task | the blogroll builder |
| `Liked_Songs.csv`, `library_albums.csv`, `taste_profile.md` | you | the morning task |

The workflow checks the branch out into `store/` beside the code
(`actions/checkout` with `ref: data`), so in Actions every read is a plain
file read and no secret is involved — the job's own token covers its own
repository. `scripts/store.mjs` reads that directory when it exists and
otherwise falls back to `raw.githubusercontent.com` (the repository is
public), which is what a local build with no checkout gets; `STORE_DIR`
points it elsewhere. `store.repo`, `store.branch`, and `store.dir` in
`config.json` name the branch and the directory.

### Likes

Every album card carries a "Listened" checkbox, and a checked card grows a
heart for marking the album liked — on the daily cards, in the archive's
detail overlay, and as small badges on the archive tiles. Everything else
gets a plain heart: the artwork plate, every wiki entry (the lead and the
side picks, on every tab), and every blogroll post. The marks live in
`likes.json` in the store, one item per mark:

```jsonc
{ "version": 1, "items": [
  { "kind": "album",   "key": "stereolab::dots and loops", "artist": "Stereolab", "album": "Dots and Loops",
    "genres": ["post-rock"], "listened": "2026-09-10", "liked": true, "when": "2026-09-10" },
  { "kind": "artwork", "key": "Q…", "title": "…", "url": "…", "artist": "Max Ernst", "artistId": "Q154842",
    "interest": "surrealism", "when": "…" },
  { "kind": "wiki",    "key": "<url>", "source": "nlab", "title": "…", "url": "…", "topic": null, "when": "…" },
  { "kind": "post",    "key": "<url>", "title": "…", "url": "…", "feed": "Joel David Hamkins", "topics": ["math"], "when": "…" }
] }
```

Albums are the one kind with two states — an item exists once the album is
marked listened, and `liked` is a flag on it; for the rest, the item's
existence is the like, and unliking removes it. Each item records what a
later draw can weight on: an artwork's interest area and artist, a wiki
entry's source and (for Wikipedia) topic, a post's feed and topics, an
album's genres. This file is the one deliberate exception to the site's
one-directional architecture: the page *writes* as well as reads.
`likes.js` (shared by both pages) commits it to the `data` branch through
the GitHub contents API using the same fine-grained PAT the add-a-blog
dialog keeps (`ultrafilter:ghToken` — read-and-write **Contents** on this
repository), offered for pasting on your first mark and reopenable by
shift-clicking any heart or "Listened" checkbox. Since the token stays in
that browser's localStorage, one paste covers both dialogs.

Marks work without a token too — they just stay in that browser. With one,
state travels: the page reads the file live on load (through the API with a
token, else from `raw.githubusercontent.com`, a few minutes behind at most),
the build bakes album marks into `albums.json` and `archive.json` and
publishes the whole file as `data/likes.json` (all as public as the rest of
the deployed site — bear that in mind), and a mark made anywhere shows up
everywhere after the next build, or within minutes on any browser. Local
marks are kept until their commit succeeds, so an offline like isn't lost —
it lands next time the page is open.

What the likes do: the artwork draw and die lean towards liked interest
areas and liked artists; the Wikipedia draw and die lean towards liked
topics; the archive and daily cards show your marks; and the morning task
reads the whole file when it chooses the day's albums, artwork, and wiki
picks.

### The roll

`blogroll.json` is the list of blogs, with a status on each:

```jsonc
{ "version": 1, "updated": "…", "feeds": [
  { "name": "Joel David Hamkins", "author": "Joel David Hamkins", "site": "https://jdh.hamkins.org",
    "feed": "https://jdh.hamkins.org/feed/", "topics": ["math"],
    "status": "pinned",                                   // pinned | active | archived
    "added": "2026-09-18", "addedBy": "mark" },           // addedBy: mark | task
  { "name": "…", "…": "…", "status": "active", "added": "2026-10-02", "addedBy": "task",
    "note": "one line from the task on why it chose the blog" },
  { "name": "…", "…": "…", "status": "archived", "added": "…", "addedBy": "task",
    "archived": "2026-11-13", "archivedBy": "task", "reason": "no liked posts in 42 days" }
] }
```

`pinned` and `active` feeds are fetched; `archived` ones are kept so they
are never proposed again and can be restored. The blogroll is curated the
way the other sections are, and the status is the whole model:

- **Pinned** means permanent — a blog stays until you unpin or remove it.
- **Active** means on trial. `blogroll.trialDays` in `config.json` (42) is
  how long a blog gets: once it has been in the roll that long with no
  liked post, the morning task archives it. One liked post keeps it for
  good (until you remove it). Every blog that was in the roll when it moved
  to the store started a trial on that day, so pin the ones you mean to
  keep.
- **Archived** blogs sit on the menu's Archive tab. Restoring one starts a
  fresh trial from that day.

`blogroll.targetSize` (40) is how large the task keeps the roll: while the
roll holds fewer blogs than that, each run may add one verified feed, so
rotations free slots that new blogs fill.

**The menu.** The button by the Blogroll heading opens the roll: every blog
with its status, when it was added and by whom, how many of its posts you
have liked, and — for a blog on trial — how many days it has left. Pin,
unpin, remove, and (on the Archive tab) restore commit straight to
`blogroll.json` on the `data` branch through the contents API, with the
same token as the likes; without a token the menu still shows the roll,
and an action offers the token panel. A removal takes effect at once —
the page filters the archived blog's posts out itself — while a blog added
or restored appears with the next build. *Add a blog…* at the bottom opens
the add dialog (below).

**From the command line** the same operations are `scripts/roll-cli.mjs`,
run from a checkout of `main` with the store checked out beside it:

```sh
node scripts/roll-cli.mjs status                 # the digest the task reads: counts, free slots, each blog's trial and likes, the archive
node scripts/roll-cli.mjs rotate [--dry-run]     # archive the blogs whose trial ran out
node scripts/roll-cli.mjs check https://…        # find and verify the feed at an address (needs npm ci)
node scripts/roll-cli.mjs add https://… --topics math --note "…" [--by task|mark] [--pinned]
node scripts/roll-cli.mjs pin|unpin|remove|restore "Blog name"
node scripts/roll-cli.mjs init --from old-config.json   # first-time migration of a config.json feed list
```

They write `store/blogroll.json`; committing on `data` and pushing is up
to you (or the task). Pushes to `data` don't deploy, so a change shows on
the page after the next scheduled build — or run the workflow from the
Actions tab.

### The morning task

The "Daily album recommendations" scheduled Claude task runs at 9:00 UTC,
Sunday to Friday, in a session with this repository cloned. It checks out
the `data` branch, reads the library, the history, and `likes.json`, and
publishes two things, committed to `data` and pushed:

**Albums** — `albums/<date>.json`, copied to `albums/latest.json`, and three
rows appended to `recommendation_history.csv`:

```jsonc
{
  "date": "2026-07-29",
  "title": "Three albums for 29 July",
  "albums": [
    {
      "category": "focus",          // focus | familiar_artist | new_artist
      "header": "Focus",            // Focus | Enjoy | Explore
      "artist": "…",
      "album": "…",
      "year": 1974,
      "genres": ["…"],
      "spotify_url": "https://open.spotify.com/album/…",
      "link_is_search": false,      // true when only a search link could be verified
      "blurb": "…",                 // the bulletin's info paragraph
      "reception": "…"              // the verified reception sentence
    }
    // … three entries, in Focus, Enjoy, Explore order
  ]
}
```

**Picks** — `picks/<date>.json`, copied to `picks/latest.json`: one artwork
and, per wiki tab, a URL. Every key is optional; a tab or the artwork with
no pick falls back to its random draw, and picks are honoured only on their
own date.

```jsonc
{
  "date": "2026-09-18",
  "artwork": { "wikidata": "Q…", "title": "…", "interest": "surrealism" },   // interest: an id from config, optional
  "wikis": {
    "wikipedia": [ { "url": "https://en.wikipedia.org/wiki/…", "title": "…", "topic": "math" }, … ],  // three side picks
    "nlab":  { "url": "https://ncatlab.org/nlab/show/…", "title": "…" },       // the lead
    "sep":   { "url": "https://plato.stanford.edu/entries/…/", "title": "…" },
    "attic": { "url": "https://neugierde.github.io/cantors-attic/…", "title": "…" },
    "oeis":  { "url": "https://oeis.org/A…", "title": "…" },
    "mathoverflow": { "url": "https://mathoverflow.net/questions/…", "title": "…" },  // optional
    "arxiv": { "url": "https://arxiv.org/abs/…", "title": "…" }                        // optional
  }
}
```

The build resolves each URL with the tab's own extractor (and the artwork
through the same Wikidata and Wikipedia calls as a draw), so the text on
the page is the source's, never the task's. To make choosing tractable, the
task runs `scripts/candidates.mjs` from its checkout of `main`, with the
store beside it:

```sh
node scripts/candidates.mjs likes                                  # a digest of likes.json, plus what's been picked before
node scripts/candidates.mjs artwork --interest surrealism          # works in one area, fresh random order
node scripts/candidates.mjs artwork --creator Q154842              # works by one artist
node scripts/candidates.mjs wikis --tabs wikipedia,nlab,sep,attic,oeis --count 8
```

Each prints JSON; the task picks from the pools by judgment against the
likes, then writes the two files. MathOverflow and arXiv leads are optional
because those tabs are listing-driven — the task can name one from the
current listing when something clearly fits.

**The roll** — the task also maintains the blogroll on every run: it runs
`roll-cli.mjs rotate` (mechanical: the policy above, no judgment), and
then, if the roll has room, looks for one blog with a working feed that
fits what the likes show, verifies it with `roll-cli.mjs check`, and adds
it with `roll-cli.mjs add --by task`, with a one-line note on why. The
bulletin's *Also today* line reports what it added and rotated out.

## Themes

Fourteen theme families ship in `index.html`, each in a light *and* a dark
variant — mostly organic, calming palettes (Moss, Flax, Clay, Tidepool,
Dune) with a few that branch out (Cartographer, Observatory, Zine),
alongside the original faces (Broadsheet, the default; Preprint; Gallery;
Slate; Nocturne; Console). The palette button in the masthead picks the
family and a Light/Dark switch picks the mode; both persist per browser via
`localStorage` (`ultrafilter:theme`, `ultrafilter:mode`), and a first visit
follows the system's light/dark preference. All faces are system fonts;
some families lay a faint tiling texture over the ground colour, loaded
from [transparenttextures.com](https://www.transparenttextures.com/) — the
one external request theming makes, and if it can't be reached the plain
colour simply shows.

## Setup

1. **Create a repository** and copy these files into it (push to `main`).

2. **Turn on Pages.** Settings → Pages → Source: *GitHub Actions*. Your page
   will be at `https://<username>.github.io/<repo>/`.

3. **Create the store.** The workflow checks out a `data` branch, so it
   must exist before the first run — even empty:

   ```sh
   git checkout --orphan data && git rm -rf . && git commit --allow-empty -m "Store" && git push -u origin data
   git checkout main
   ```

   (This repository's `data` branch was made from the old `spotify-recs`
   repository's history instead — see `scripts/migrate-store.sh`.) No
   secret is needed: the job reads its own repository. The likes' write
   token is never stored in the repo — the page asks for it in the browser
   (see *Likes* above).

   Seed the roll while you're there: with the branch checked out into
   `store/` (`git worktree add store data`), `node scripts/roll-cli.mjs init
   --from <a JSON file with a blogroll.feeds list>` writes `blogroll.json`;
   commit and push it on `data`. A build with no roll in the store falls
   back to `blogroll.feeds` in `config.json` if you put a list there, and
   fails the section otherwise.

4. **Run it once by hand** (or just push). Actions tab → *Build and deploy* →
   *Run workflow*. Every run builds all sections and deploys the site with
   fresh data; until the first one finishes there's nothing at the URL.

After that it refreshes every two hours on its own, plus once at 9:45 UTC to
pick up the morning's albums shortly after the Claude task lands them.

### Putting it inside an existing site instead

The workflow deploys its build as the *entire* Pages site, so it wants a repo
of its own. To embed this page in a site repo you already have, don't reuse
the workflow as-is — it would replace your whole site. Either have your
site's own build pipeline run `scripts/build.mjs` and include the output
in its deploy, or fall back to committing `data/` to the branch your site
deploys from.

## Search engines

`index.html` carries `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">`.
Google and other major engines honor this and will keep the page out of their
results.

Two caveats worth being clear about:

- **This is not privacy.** A GitHub Pages site is publicly readable by anyone
  who knows the URL. `noindex` prevents listing, not access. If you need actual
  privacy, GitHub Pages is the wrong host — you'd want a private server with
  authentication, or just run the build locally and open the file from disk.
- **Don't add a `robots.txt` `Disallow` rule for this page.** It sounds like
  belt-and-braces but is counterproductive: `Disallow` stops crawlers from
  *fetching* the page, so they never see the `noindex` tag, and the URL can
  still appear in results if a link to it is discovered elsewhere. Allowing the
  crawl and serving `noindex` is the reliable combination.

## Maintaining it

Everything but the roll lives in `config.json`: the blogroll's topics and
policy (`targetSize`, `trialDays`, `rollPath`), the weather location, the
Wikipedia interest areas and the other wikis tabs' settings, the artwork
interest areas, the store's branch, and the albums file paths within it.
The blogs themselves are `blogroll.json` in the store — see [The
roll](#the-roll). Adding a blogroll topic means adding an entry to
`blogroll.topics` and referencing its `id` from any feed; the filter chips
and dot colors follow automatically. `site` is the deployed URL, which the
build uses to recover the currently-published data when a section's fresh
build fails.

Any push to `main` redeploys the site with freshly built data, so a config
change takes effect as soon as its push lands.

### Adding a blog from the page

*Add a blog…* in the blogroll menu adds a feed without leaving the site.
Paste the blog's address and the dialog finds the feed itself — as the
feed URL directly, via the page's `<link rel="alternate">`, or by probing
common paths (`/feed/`, `/atom.xml`, …), falling back to the same
read-through proxies the build uses when the publisher doesn't send CORS
headers. A source only counts once it actually parses as a feed, and the
name, author, and site prefill from it. Committing goes through the GitHub
contents API: the entry joins `blogroll.json` on the `data` branch as an
active blog added by you. Duplicates — including archived blogs, which you
restore from the menu instead — are refused by feed or site URL. Since a
push to `data` doesn't deploy, the dialog then asks Actions to run the
build; that needs the token to have **Actions** read-and-write as well,
and without it the blog's posts arrive with the next scheduled build.

One-time setup per browser: the dialog asks for a fine-grained PAT with
read-and-write **Contents** permission on this repository only, kept in
`localStorage` (`ultrafilter:ghToken`) — it never travels anywhere but
api.github.com. Off GitHub Pages (localhost, a custom domain) the dialog
also asks which repository to commit to, since it can't be read off the URL.

## Reading the ledger

The ledger in the page footer reports the last build: one entry per
section, with the per-feed detail expanding under the Blogroll entry. When
a feed fails, the error tells you what to do:

| What it says | What it means |
| --- | --- |
| `HTTP 404` | The feed URL is wrong or the blog moved. Find the new one. |
| `HTTP 403` | The publisher blocks automated fetching — frequently by IP range, since CI runners sit in cloud ranges that firewalls reject. The build retries such feeds through a read-through proxy automatically. |
| `no <item> or <entry> elements found` | That URL returned something that isn't a feed (a web page, or a proxy's rewrite of one). Each failed source is listed with its own error, separated by `\|`. |
| `HTTP 5xx` / `timeouts` | The blog's server had a bad moment. It'll likely fix itself. |
| `stale · <date>` | That section's fresh build failed, so the previously published data is still being served. |
| `pending` | The albums section has nothing to show yet — the task hasn't published a file to the store. |

During the build, the job fails loudly only if the blogroll ends up with no
posts from any source — a couple of stubborn publishers won't turn the whole
run red. A run that fails at that stage deploys nothing, so the previously
published site stays up untouched.

There is one deliberate exception: once a day, the 9:45 UTC run finishes
with a freshness check (`scripts/check-freshness.mjs`) *after* the deploy.
If the artwork or albums section, the likes file, or any wikis tab had to
fall back to stale data, that run is marked failed — the page has already
updated with everything that did build; the red run exists purely so
GitHub's run-failed email tells you a daily section is quietly stuck (a
failing Wikidata query, a store that couldn't be read) instead of it
rotting unnoticed.

## Running it locally

```sh
npm ci
git worktree add store data    # optional: the store as a local checkout (gitignored)
node scripts/build.mjs         # writes data/*.json
python3 -m http.server 8123    # then open http://localhost:8123/
```

Without the worktree the build reads the `data` branch from
`raw.githubusercontent.com`, which works but lags pushes by a few minutes.
Opening `index.html` directly from disk works in Safari but not Chrome,
which blocks `fetch` of local files; the tiny server above sidesteps that.
Likes made on localhost can still be committed: the sync dialog asks which
repository, since it can't be read off the URL.

## A note on scheduled workflows

GitHub disables cron-triggered workflows in repositories with no commits for
60 days, and emails you when it does. Since the build job deliberately never
commits, this *will* come up if you go two months without pushing anything:
the schedule pauses until you re-enable the workflow from the Actions tab (or
push again). The email is the tell; re-enabling is one click.

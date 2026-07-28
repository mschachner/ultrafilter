# Ultrafilter

A link-only aggregator for a hand-picked blogroll. A scheduled GitHub Action
fetches every feed, writes the results to `data/posts.json`, and deploys the
site (page + data) straight to GitHub Pages — nothing is committed back to the
repository, so `main` only ever contains your own commits. No reader view, no
post content — just titles, dates, and links out to the original.

Fetching happens on GitHub's servers rather than in your browser, which solves
two problems the browser version had: no CORS restrictions, and requests can
carry a normal browser `User-Agent`, which gets past publishers that reject
anonymous fetchers.

## Setup

1. **Create a repository** and copy these files into it (push to `main`).

2. **Turn on Pages.** Settings → Pages → Source: *GitHub Actions*. Your page
   will be at `https://<username>.github.io/<repo>/`.

3. **Run it once by hand** (or just push). Actions tab → *Refresh blogroll* →
   *Run workflow*. Every run fetches the feeds and deploys the site with fresh
   data; until the first one finishes there's nothing at the URL.

After that it refreshes every six hours on its own.

### Putting it inside an existing site instead

The workflow deploys its build as the *entire* Pages site, so it wants a repo
of its own. To embed the blogroll in a site repo you already have, don't reuse
this workflow as-is — it would replace your whole site. Either have your
site's own build pipeline run `scripts/build-feeds.mjs` and include the output
in its deploy, or fall back to the older approach where the workflow commits
`data/posts.json` to the branch your site deploys from.

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

## Maintaining the blogroll

Everything lives in `feeds.config.json`:

```jsonc
{
  "itemsPerFeed": 8,     // most recent N posts kept per feed
  "maxAgeDays": 400,     // anything older is dropped
  "topics": [ { "id": "math", "label": "Mathematics", "color": "#4756A8" } ],
  "feeds": [
    {
      "name": "Blog title",
      "author": "Who writes it",
      "site": "https://example.org",          // linked from the feed ledger
      "feed": "https://example.org/feed/",    // the actual RSS/Atom URL
      "topics": ["math"]                      // one or more topic ids
    }
  ]
}
```

Adding a topic means adding an entry to `topics` and referencing its `id` from
any feed. The filter chips and dot colors follow automatically.

Two optional per-feed keys help with awkward publishers:

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

Any push to `main` redeploys the site with freshly fetched feeds, so a config
change takes effect as soon as its push lands.

## Reading the feed ledger

The **Feeds** button on the page shows the result of the last run for every
feed. When something fails, the error tells you what to do:

| What it says | What it means |
| --- | --- |
| `HTTP 404` | The feed URL is wrong or the blog moved. Find the new one. |
| `HTTP 403` | The publisher blocks automated fetching — frequently by IP range, since CI runners sit in cloud ranges that firewalls reject. The build retries such feeds through a read-through proxy automatically. |
| `no <item> or <entry> elements found` | That URL returned something that isn't a feed (a web page, or a proxy's rewrite of one). Each failed source is listed with its own error, separated by `\|`. |
| `HTTP 5xx` / `timeouts` | The blog's server had a bad moment. It'll likely fix itself. |

The job fails loudly only if *every* feed breaks — a couple of stubborn
publishers won't turn the whole run red. A failed run deploys nothing, so the
previously published site stays up untouched.

## Running it locally

```sh
npm ci
node scripts/build-feeds.mjs   # writes data/posts.json
python3 -m http.server 8123    # then open http://localhost:8123/
```

Opening `index.html` directly from disk works in Safari but not Chrome, which
blocks `fetch` of local files; the tiny server above sidesteps that.

## A note on scheduled workflows

GitHub disables cron-triggered workflows in repositories with no commits for
60 days, and emails you when it does. Since the refresh job deliberately never
commits, this *will* come up if you go two months without pushing anything:
the schedule pauses until you re-enable the workflow from the Actions tab (or
push again). The email is the tell; re-enabling is one click.

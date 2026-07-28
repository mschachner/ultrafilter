# Ultrafilter

A link-only aggregator for a hand-picked blogroll. A scheduled GitHub Action
fetches every feed, writes the results to `data/posts.json`, and the page reads
that file. No reader view, no post content — just titles, dates, and links out
to the original.

Fetching happens on GitHub's servers rather than in your browser, which solves
two problems the browser version had: no CORS restrictions, and requests can
carry a normal browser `User-Agent`, which gets past publishers that reject
anonymous fetchers.

## Setup

1. **Create a repository** and copy these files into it (push to `main`).

2. **Turn on Pages.** Settings → Pages → Source: *Deploy from a branch* →
   Branch: `main`, folder: `/ (root)`. Your page will be at
   `https://<username>.github.io/<repo>/`.

3. **Allow the Action to commit.** Settings → Actions → General → Workflow
   permissions → *Read and write permissions*. Without this, the refresh job
   can fetch feeds but can't save the results.

4. **Run it once by hand.** Actions tab → *Refresh blogroll* → *Run workflow*.
   The first run populates `data/posts.json`; until then the page will tell you
   there's no data yet.

After that it refreshes every six hours on its own.

### Putting it inside an existing site instead

If you'd rather this live in a subdirectory of a site repo you already have,
copy everything into a subfolder (say `ultrafilter/`), then adjust two paths:
in the workflow, change `git add data/posts.json` to
`git add ultrafilter/data/posts.json` and add a `working-directory:` of
`ultrafilter` to the install and fetch steps. The workflow commits a single
file rather than deploying a build artifact, precisely so it can't disturb
whatever else your site does.

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

Push a change to `feeds.config.json` and the workflow reruns immediately — it
triggers on pushes to that file as well as on the schedule.

## Reading the feed ledger

The **Feeds** button on the page shows the result of the last run for every
feed. When something fails, the error tells you what to do:

| What it says | What it means |
| --- | --- |
| `HTTP 404` | The feed URL is wrong or the blog moved. Find the new one. |
| `HTTP 403` | The publisher is blocking automated fetching. Often unfixable. |
| `no <item> or <entry> elements found` | The URL returned a web page, not a feed. |
| `HTTP 5xx` / `timeouts` | The blog's server had a bad moment. It'll likely fix itself. |

The job fails loudly only if *every* feed breaks — a couple of stubborn
publishers won't turn the whole run red.

## Running it locally

```sh
npm ci
node scripts/build-feeds.mjs   # writes data/posts.json
python3 -m http.server 8123    # then open http://localhost:8123/
```

Opening `index.html` directly from disk works in Safari but not Chrome, which
blocks `fetch` of local files; the tiny server above sidesteps that.

## A note on scheduled workflows

GitHub disables cron-triggered workflows in repositories with no activity for
60 days, and emails you when it does. Since this repo commits to itself every
six hours, that shouldn't come up — but if refreshes ever stop silently, check
the Actions tab first.

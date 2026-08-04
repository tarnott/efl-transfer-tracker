# EFL Transfer Tracker

A self-updating website tracking every transfer across the top four divisions of
English football — Premier League, Championship, League One and League Two —
with data scraped once a day from FotMob.

## How it works

- `index.html` — the whole site (no build step). It loads `data/transfers.json`
  and falls back to embedded sample data until the first scrape has run.
- `fetch-transfers.mjs` — fetches the transfers tab for each of the four
  leagues from FotMob (league IDs 47, 48, 108, 109), normalises the records, and
  writes `data/transfers.json`. One gentle pass, 4 requests, 3s apart.
- `.github/workflows/daily-update.yml` — GitHub Actions cron that runs the
  scraper at 06:00 UTC daily, commits the fresh JSON, and republishes the site.

## Setup (one-time, ~5 minutes)

1. Create a new GitHub repository and push this folder to it.
2. In the repo: **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. In the repo: **Actions** tab → enable workflows → open "Daily transfer
   update" → **Run workflow** to do the first scrape immediately.
4. Your site is live at `https://<your-username>.github.io/<repo-name>/`
   and refreshes itself every morning.

## Testing locally

```bash
npm install
node fetch-transfers.mjs   # writes data/transfers.json
npx serve .                        # or any static server; open http://localhost:3000
```

(Opening index.html straight from disk also works, but browsers block `fetch`
of local JSON, so you'll see the sample data instead of your scraped file.)

## Caveats — read once

- **Unofficial API.** FotMob has no public API and its terms restrict automated
  use. This setup is deliberately low-volume (4 requests/day), but the feed can
  change or break without notice, and you use it at your own risk — best kept
  as a personal project rather than a promoted public site.
- **Auth dependency.** The `@max-xoo/fotmob` wrapper fetches FotMob's required
  `x-mas` auth token from a community-run service. If that service disappears,
  the scrape fails loudly in the Actions log (it never silently wipes your
  data — on total failure it keeps the previous day's JSON).
- **Fees.** FotMob reports fees in EUR; the scraper converts at a fixed rate set
  in `GBP_PER_EUR` at the top of `fetch-transfers.mjs`. Undisclosed
  fees stay `null` and display as "Undisc."
- **Schema drift.** The scraper parses defensively and logs the JSON keys it
  found when the shape doesn't match, so a FotMob redesign turns into a clear
  error message rather than corrupt data.

## Adjusting

- Change the scrape time: edit the `cron:` line in the workflow (UTC).
- Change divisions: edit `LEAGUES` in the scraper.
- Force a refresh any time: Actions → Daily transfer update → Run workflow.

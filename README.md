# BOC Eagles — Hitter Report

A self-contained, single-file web app (`index.html`) that replicates the
`HitterApp.R` Shiny dashboard, rebuilt to run entirely in the browser —
no R, no server. `index.html` is auto-generated from the files in `data/`
by a GitHub Actions workflow every time you push new data.

## Repo layout

```
data/               <- drop new TrackMan CSVs here
  called_strike.csv <- umpire called-strike probability lookup (fixed name)
  *Data.csv         <- any number of season files, any filename ending in .csv
                       (except called_strike.csv)
template/
  shell.html        <- page HTML/CSS shell (edit for styling/layout changes)
  app.js            <- all client-side logic: filters, stats, charts (edit for logic changes)
scripts/
  build.py          <- reads data/, engineers features, writes index.html
index.html          <- GENERATED — don't hand-edit, it gets overwritten on every build
.github/workflows/build.yml  <- the automation
```

## Adding new data

1. Drop the new CSV into `data/` (any name, as long as it ends in `.csv` and
   isn't `called_strike.csv`).
2. Commit and push to `main`.
3. GitHub Actions picks it up automatically, rebuilds `index.html`, and
   commits it back to the repo. Check the **Actions** tab for progress/logs.

You don't need to tell it what season the file is — the season label
(`2026 SPRING`, `2025 FALL`, etc.) is derived automatically from each pitch's
date (Jan–Jun = Spring, Jul–Aug = Summer, Sep–Dec = Fall), and the season
picker + date-range bounds in the sidebar update themselves from whatever
dates are actually present in the data. No hardcoded season list to maintain.

If a new file has slightly different columns than earlier files (a TrackMan
export version bump, for example), the build only uses columns common to
*every* file — it won't crash, it'll just drop columns that aren't shared.

## Running the build locally

```
pip install -r requirements.txt
python scripts/build.py
```

This regenerates `index.html` at the repo root. Open it directly in a
browser to preview.

## Hosting it live

The workflow builds `index.html` **and** publishes it to GitHub Pages
automatically on every push to `data/`. There's one one-time step GitHub
requires you to do by hand (it can't be set from a file in the repo):

1. Push this repo to GitHub first (with the `.github/workflows/build.yml`
   included).
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**
   (not "Deploy from a branch").

That's it — no branch to pick, no folder to choose. From then on, every
push to `data/` (or `template/`, `scripts/`) triggers the workflow, which:
1. Rebuilds `index.html` and commits it back to `main` (so the report is
   also always up to date if you just want to download/open the file
   directly), then
2. Publishes that same file to your Pages URL, shown at the top of the
   **Actions** run and under **Settings → Pages** —
   typically `https://<username>.github.io/<repo>/`.

Give the first run a minute or two after you flip the Pages source setting
and push — after that, updates typically show up within ~1-2 minutes of
pushing new data.

## Editing the report itself

- **Styling/layout/new tabs**: edit `template/shell.html`.
- **Stats formulas, chart logic, filters**: edit `template/app.js`.
- **Data pipeline / feature engineering**: edit `scripts/build.py`.

Any of these changes also trigger an automatic rebuild on push, since the
workflow watches `data/**`, `template/**`, and `scripts/**`.

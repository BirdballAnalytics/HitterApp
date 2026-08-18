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
  shell.html        <- page HTML/CSS shell + landing screen (edit for styling/layout changes)
  app.js            <- all client-side logic: filters, stats, charts, both Hitting and Pitching views
  logo_datauri.txt  <- the BC logo, base64-encoded, embedded into the header at build time
scripts/
  build.py          <- reads data/, engineers features, writes index.html
index.html          <- GENERATED — don't hand-edit, it gets overwritten on every build
.github/workflows/build.yml  <- the automation
```

## What's in the app

Opening the report shows a landing screen with four tiles: **Hitting**, **Pitching**,
**Scout**, and **Hitting Lab**.

- **Hitting** — Traditional Stats, Advanced Stats, Exit Velo Stats/Charts,
  IZ Whiff, Chase, Swing Decisions, Takes, **SDS**, Sequences.
- **Pitching** — Results, Results By Split, Metrics, Release/Extension, Strike% By Count,
  Locations, Heat Maps, IZ Whiff, Chase, Velo Over Time, Strike% Over Time.
- **Scout** — two sub-tabs:
  - **Scouting Report** — a one-page single-pitcher report styled after a TruMedia
    configurable report: Season Stats, a Pitch Break Chart, a TrackMan Data table
    per pitch (abbreviated pitch names — FB/SI/CT/CH/SL/CU/etc. — to keep it
    narrow), and location heat maps for Fastballs/Breaking Balls/Changeups/Damage
    against both LHH and RHH. "Download PDF" prints to one letter-landscape page.
  - **Cheat Sheet** — the whole pitching staff at a glance for a selected team,
    listed alphabetically. Each pitcher gets a dense dark row split into a
    "vs RHH" half and mirrored "vs LHH" half: a damage spray chart, three heat
    maps (Fastballs / Breaking-Balls-Off-Speed / Damage), a "Go!" quadrant
    (highlights whichever quarter of the zone this pitcher gets hit hardest
    in against that batter side, with IN/AWAY mapped correctly per handedness),
    a batter silhouette, and a usage list (in-zone pitch count + usage% per
    pitch). The center block has name, role (SP/RP), extension/release badges,
    primary-pitch and strike-rate lines, tendency tags (plate location, pull/
    oppo direction with field abbreviation), FB% splits by count, and an
    editable gameplan notes box per side — notes save automatically to your
    browser's local storage, per pitcher, so they persist across reloads
    (they don't sync anywhere or leave your browser).

  A few things worth knowing about the Cheat Sheet:
  - **Role (SP vs. RP) is inferred**, not read from the data — there's no
    explicit role field in the TrackMan export, so it's classified by pitches
    per outing (≥40 pitches/game average → SP). Spot-check it; a swingman or
    an unusually short/long outing could get misclassified.
  - **Opponent teams only have partial-season data** — the CSVs only contain
    pitches from games actually played against BC, not that team's full
    schedule, so an opponent's Cheat Sheet reflects a smaller sample than BC's
    own staff.
  - The mini spray chart is a simplified 2D stand-in (dots + a basic diamond
    guide) built from Bearing/Distance — not the full 3D physics-based spray
    chart from the Hitting tab, which wouldn't read at this compact a size.
  - This tab is intentionally multi-page when printed — a full staff doesn't
    fit on one sheet the way a single pitcher's Scouting Report does.

  The pitcher dropdown in Scouting Report and the team dropdown in Cheat Sheet
  both include BC alongside every opponent, so you can pull a self-scout the
  same way as an opponent's.

- **Hitting Lab** — a dark, more experimental hitting-visualization suite, adapted
  from a reference video ("Hitter HQ") of another team's tool. Five tabs:
  - **Space** — the 3D contact-point cloud with physics-based batted-ball arcs
    (this is the former standalone "Spray Chart" tab, moved here). Color by
    Exit Velo / Pitch / Result, click a point for a detail card, Hide Dots toggle.
  - **Heat** — toggles between **Zone** (a density heat map filtered by
    Pitches / Swing / Whiff / Chase / Damage) and **Contact Point** (the former
    standalone "Contact" tab — a 3D heat map of contact location colored by
    Exit Velo / Launch Angle / Barrel%, with Catcher/Pitcher/Side/Overhead
    camera presets).
  - **Spray** — a 2D Pull/Center/Oppo fan chart, colored by Exit Velo / Pull-Oppo
    / Result / Type. This is a different, simpler visualization than Space's 3D
    version — both exist because the reference video showed both.
  - **Trend** — exit velocity over time with a rolling-average trend line.
  - **Batted Ball** — a Ground Ball / Line Drive / Fly Ball breakdown table
    (count, rate, avg EV/LA, hard-hit%, BAA) plus a launch-angle histogram.

  **Trend and Batted Ball were not shown in the reference video** — no frame of
  either tab was available to work from, so both are a best-effort design based
  on what would make sense given the surrounding tabs, not a literal recreation.
  If you have reference images for either, send them and these can be rebuilt
  to match exactly.

Hitting/Pitching/Hitting Lab share the same season/date-range/game filters; the player
dropdown switches between "Hitter"/"Pitcher"/"Opposing Pitcher" automatically based on
which view you're in. A "Back to Selection" link in the sidebar returns to the landing
screen.

## SDS (Swing Decision Score)

The Hitting tile's **SDS** tab scores every qualifying pitch on how good the
hitter's swing/take decision was, using three cascaded random-forest models
(P(swing) → P(contact | swing) → P(hard-hit | contact)) trained on
velocity/movement/location, combined with the called-strike-probability
lookup. This is a Python port of a pair of R scripts (`compute_sds.r` /
`weekly_sds_score.r`, not part of this repo) — ported here because training
happens automatically as part of every GitHub Actions build
(`scripts/sds_model.py`), rather than needing you to separately run R and
commit trained model files. Every pitch gets a **Total SDS**, plus it's
broken out **by pitch type** and **by attack zone (Heart/Shadow/Chase/
Waste)**, using the same nested-zone definitions Baseball Savant uses (Heart
= inner ⅔ of the strike zone, Shadow = the band straddling the zone edge,
Chase = out to a box twice the zone's size, Waste = beyond that).

A few things worth knowing:

- **3-0 counts and "waste pitches"** (near-zero called-strike probability,
  not swung at) are excluded from SDS entirely — those rows show up
  everywhere else in the app as normal, they just don't get an SDS value.
- **SDS+ and Grade always compare against a fixed league baseline** — the
  mean/SD of SDS across the *entire* dataset, computed once at build time
  and embedded in the exported data (`sdsLeagueMean`/`sdsLeagueSd`). This is
  a deliberate fix versus the original R scripts, where the "weekly"
  scoring script recomputed its own league mean/SD from whatever narrow
  date range it happened to be scoring — meaning a player's grade could
  shift from week to week just because the comparison population changed,
  independent of anything they did. Now it's the same yardstick every time,
  regardless of what season/date range/games you have selected in the
  sidebar. **Mean SDS itself** (the raw number, before the +/Grade
  conversion) still reflects whatever's currently filtered, same as every
  other stat in the app — only the comparison baseline is held fixed.
- **The Player Leaderboard always shows every BC hitter**, regardless of
  who's selected in the sidebar's Hitter dropdown — that's what makes "every
  hitter gets a score" true. The By Pitch Type / By Location sections below
  it do respect the Hitter dropdown, the same as every other Hitting tab.
- **Model quality is printed at build time** (check the GitHub Actions log
  for a given run): swing and contact models both land around 0.73-0.77
  AUC on a held-out test set; the hard-hit-given-contact model is
  noticeably weaker (~0.59) — quality of contact turns out to be genuinely
  hard to predict from pitch characteristics alone, which tracks with
  general sports-analytics experience, not a bug.

## A note on rendering

Most charts use Plotly.js (loaded from cdnjs, see below). The zone heat maps
(IZ Whiff, Chase, Heat Maps, Scout Report's location grids, the Cheat Sheet's
tiny per-pitcher tiles) and the mini spray charts are hand-built SVG instead —
at very small sizes, a general-purpose charting library's own margin/legend
layout fights you more than it helps, so those are pixel-controlled directly.
Multi-panel scatter charts (Exit Velo Charts, Swing Decisions, Takes,
Pitching Locations, Metrics, Release/Extension, Velo/Strike Over Time) still
use Plotly for the scatter itself, but their legends are plain HTML/CSS below
the chart rather than Plotly's built-in legend, so they can't collide with
the plot no matter how many pitch types show up.

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

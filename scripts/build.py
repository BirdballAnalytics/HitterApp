"""
BOC Eagles Hitter Report — build script
Run by GitHub Actions (or locally) whenever files in data/ change.

What it does:
  1. Auto-discovers every TrackMan CSV in data/ (any *.csv except called_strike.csv)
  2. Combines them on their shared columns (so a new season's file with slightly
     different columns doesn't break the build)
  3. Replicates the feature engineering from the original R app (ChecksCSV)
  4. Derives a Season label + date range from each row's Date (no hardcoded
     season list, so new seasons "just show up")
  5. Emits a compact row-array JSON and stitches it + template/app.js into
     template/shell.html to produce the final index.html at the repo root.

Usage:
    python scripts/build.py
"""
import glob
import json
import os
import re

import numpy as np
import pandas as pd

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO_ROOT, "data")
TEMPLATE_DIR = os.path.join(REPO_ROOT, "template")
OUT_HTML = os.path.join(REPO_ROOT, "index.html")

TEAM = "BOC_EAG"
CALLED_STRIKE_FILE = "called_strike.csv"


def load_season_file(path):
    df = pd.read_csv(path, low_memory=False)
    df["RelHeight"] = pd.to_numeric(df["RelHeight"], errors="coerce")
    df["Balls"] = pd.to_numeric(df["Balls"], errors="coerce")
    df["Strikes"] = pd.to_numeric(df["Strikes"], errors="coerce")
    df["PlateLocHeight"] = df["PlateLocHeight"].round(1)
    df["PlateLocSide"] = df["PlateLocSide"].round(1)
    return df


def discover_data_files():
    all_csvs = sorted(glob.glob(os.path.join(DATA_DIR, "*.csv")))
    season_files = [f for f in all_csvs if os.path.basename(f) != CALLED_STRIKE_FILE]
    if not season_files:
        raise SystemExit(f"No season data CSVs found in {DATA_DIR}")
    return season_files


def season_label(date):
    """Derive '<year> SPRING/SUMMER/FALL' from a pitch's date.
    College baseball calendar: Jan-Jun = Spring, Jul-Aug = Summer ball,
    Sep-Dec = Fall practice season."""
    if pd.isna(date):
        return None
    m = date.month
    if m <= 6:
        tag = "SPRING"
    elif m <= 8:
        tag = "SUMMER"
    else:
        tag = "FALL"
    return f"{date.year} {tag}"


def build():
    season_files = discover_data_files()
    print(f"Found {len(season_files)} season file(s):")
    for f in season_files:
        print("  -", os.path.basename(f))

    frames = [load_season_file(f) for f in season_files]
    common_cols = list(set.intersection(*(set(f.columns) for f in frames)))
    df = pd.concat([f[common_cols] for f in frames], ignore_index=True)

    df["Count"] = (
        df["Balls"].astype("Int64").astype(str) + "-" + df["Strikes"].astype("Int64").astype(str)
    )

    called_strike_path = os.path.join(DATA_DIR, CALLED_STRIKE_FILE)
    if os.path.exists(called_strike_path):
        ump = pd.read_csv(called_strike_path)
        df["RoundedPLH"] = df["PlateLocHeight"].round(1)
        df["RoundedPLS"] = df["PlateLocSide"].round(1)
        df = df.merge(
            ump,
            left_on=["RoundedPLH", "RoundedPLS"],
            right_on=["PlateLocHeight", "PlateLocSide"],
            how="left",
            suffixes=("", "_ump"),
        )
    else:
        print(f"WARNING: {CALLED_STRIKE_FILE} not found — called_strike_prob will be blank")
        df["called_strike_prob"] = np.nan

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df["Season"] = df["Date"].apply(season_label)

    # ---------------- feature engineering (mirrors ChecksCSV in HitterApp.R) ----------------
    df["OpponentTeam"] = np.where(df["BatterTeam"] == TEAM, df["PitcherTeam"], df["BatterTeam"])
    df["Game"] = np.where(
        df["GameID"].notna(),
        df["Date"].dt.strftime("%Y-%m-%d") + " vs " + df["OpponentTeam"].astype(str) + " (Game " + df["GameID"].astype(str) + ")",
        df["Date"].dt.strftime("%Y-%m-%d") + " vs " + df["OpponentTeam"].astype(str),
    )

    hit_results = {"Single", "Double", "Triple", "HomeRun"}
    xbh_results = {"Double", "Triple", "HomeRun"}

    df["HCheck"] = df["PlayResult"].isin(hit_results)
    df["XBHCheck"] = df["PlayResult"].isin(xbh_results)
    df["OutCheck"] = (df["OutsOnPlay"].astype(str) == "1") | (df["KorBB"] == "Strikeout")
    df["ErrorCheck"] = df["PlayResult"] == "Error"
    df["GBCheck"] = df["TaggedHitType"] == "GroundBall"
    df["FlyBallCheck"] = df["TaggedHitType"].isin(["FlyBall", "Popup"])
    df["LDCheck"] = df["TaggedHitType"] == "LineDrive"
    df["BBECheck"] = df["TaggedHitType"].isin(["GroundBall", "LineDrive", "FlyBall", "Popup"])

    df["InPlayCheck"] = df["PitchCall"] == "InPlay"
    contact_calls = ["InPlay", "FoulBall", "FoulBallNotFieldable", "FoulBallFieldable"]
    df["ContactCheck"] = df["PitchCall"].isin(contact_calls)
    swing_calls = ["StrikeSwinging", "InPlay", "FoulBall", "FoulBallNotFieldable", "FoulBallFieldable"]
    df["SwingCheck"] = df["PitchCall"].isin(swing_calls)
    df["WhiffCheck"] = df["PitchCall"] == "StrikeSwinging"
    df["CSWCheck"] = df["PitchCall"].isin(["StrikeSwinging", "StrikeCalled"])
    strike_calls = ["StrikeSwinging", "FoulBall", "FoulBallNotFieldable", "FoulBallFieldable", "InPlay", "StrikeCalled"]
    df["StrikeCheck"] = df["PitchCall"].isin(strike_calls)
    df["TakeCheck"] = df["PitchCall"].isin(["StrikeCalled", "BallCalled"])
    df["CalledStrikeCheck"] = df["PitchCall"] == "StrikeCalled"
    df["CalledBallCheck"] = df["PitchCall"] == "BallCalled"
    df["BallCheck"] = df["PitchCall"].isin(["BallCalled", "HitByPitch"])
    df["FoulCheck"] = df["PitchCall"] == "FoulBall"

    df["ZoneCheck"] = df["PlateLocHeight"].between(1.75, 3.38) & df["PlateLocSide"].between(-0.85, 0.85)
    df["BufferCheck"] = (
        (df["PlateLocHeight"].between(1.4, 1.8) | df["PlateLocHeight"].between(3.0, 3.5))
        & (df["PlateLocSide"].between(-1.1, -0.6) | df["PlateLocSide"].between(0.6, 1.1))
    )

    df["SweetSpotCheck"] = df["Angle"].between(10, 30)
    df["HardHitCheck"] = df["ExitSpeed"].between(95, 120)
    df["BarrelCheck"] = df["SweetSpotCheck"] & df["HardHitCheck"]
    df["BuntCheck"] = df["ExitSpeed"] <= 40

    df["SingleCheck"] = df["PlayResult"] == "Single"
    df["DoubleCheck"] = df["PlayResult"] == "Double"
    df["TripleCheck"] = df["PlayResult"] == "Triple"
    df["HRCheck"] = df["PlayResult"] == "HomeRun"
    df["SacCheck"] = df["PlayResult"] == "Sacrifice"
    df["HBPCheck"] = df["PitchCall"] == "HitByPitch"
    df["StrikeoutCheck"] = df["KorBB"] == "Strikeout"
    df["WalkCheck"] = df["KorBB"] == "Walk"
    df["LeadOffCheck"] = df["PAofInning"].astype(str) == "1"
    df["FPCheck"] = df["PitchofPA"].astype(str) == "1"

    fb_types = ["Sinker", "Fastball", "FourSeamFastBall", "TwoSeamFastBall", "Cutter"]
    os_types = ["ChangeUp", "Changeup", "Splitter"]
    bb_types = ["Slider", "Curveball"]
    df["FBCheck"] = df["TaggedPitchType"].isin(fb_types)
    df["OSCheck"] = df["TaggedPitchType"].isin(os_types)
    df["BBCheck"] = df["TaggedPitchType"].isin(bb_types)
    df["OffSpeedCheck"] = df["TaggedPitchType"].isin(os_types + bb_types)

    df["ABCheck"] = df["HCheck"].astype(int) + df["OutCheck"].astype(int) - df["SacCheck"].astype(int)
    df["PACheck"] = df["ABCheck"] + df["WalkCheck"].astype(int) + df["SacCheck"].astype(int)
    df["IPCheck"] = df["PlayResult"] == "Out"

    def hit_prob(row):
        ev, ang = row["ExitSpeed"], row["Angle"]
        if pd.isna(ev) or pd.isna(ang):
            return 0.0
        if ev >= 98 and 12 <= ang <= 44:
            return 1.0
        if 93 <= ev < 98 and 6 <= ang <= 38:
            return 1.0
        if 90 <= ev < 93 and 0 < ang <= 30:
            return 0.5
        if 75 <= ev < 90 and 0 <= ang <= 30:
            return 0.5
        if ev >= 90 and -10 <= ang < 0:
            return 0.5
        return 0.0

    df["HitProbabilityCheck"] = df.apply(hit_prob, axis=1)

    def slugging(row):
        ev, ang = row["ExitSpeed"], row["Angle"]
        if pd.isna(ev) or pd.isna(ang):
            return 0.0
        if ev >= 98 and 24 <= ang <= 35:
            return 4.0
        if ev >= 95 and 12 <= ang <= 24:
            return 2.0
        if 85 <= ev < 95 and 12 <= ang <= 35:
            return 1.5
        if ev >= 90 and -5 <= ang < 12:
            return 1.0
        if 85 <= ev < 90 and -5 <= ang < 12:
            return 0.5
        return 0.0

    df["SluggingCheck"] = df.apply(slugging, axis=1)

    def woba(row):
        if row["PlayResult"] in ("Out", "Sacrifice", "Error", "FieldersChoice"):
            return 0.0
        if row["PitchCall"] == "HitByPitch":
            return 0.59
        if row["KorBB"] == "Walk":
            return 0.59
        return {"Single": 0.883, "Double": 1.244, "Triple": 1.569, "HomeRun": 2.004}.get(row["PlayResult"], np.nan)

    df["WOBACheck"] = df.apply(woba, axis=1)

    def xwoba(row):
        ev, ang = row["ExitSpeed"], row["Angle"]
        if pd.isna(ev) or pd.isna(ang):
            return np.nan
        if ev >= 98 and 24 <= ang <= 35:
            return 2.004
        if 95 <= ev < 100 and 18 <= ang < 29:
            return 1.569
        if ev >= 90 and 12 <= ang <= 35:
            return 1.244
        if ev >= 90 and -5 <= ang < 12:
            return 0.883
        if 85 <= ev < 90 and -5 <= ang < 12:
            return 0.883
        return np.nan

    df["xwOBACheck"] = df.apply(xwoba, axis=1)

    df["HitCheck"] = np.where(
        df["PlayResult"].isin(["Out", "Sacrifice", "FieldersChoice"]),
        0,
        np.where(df["PlayResult"].isin(["Single", "Double", "Triple", "HomeRun", "Error"]), 1, np.nan),
    )

    df["TaggedPitchType"] = df["TaggedPitchType"].replace({"TwoSeamFastBall": "TwoSeam"})
    df["PitchDisplay"] = df["TaggedPitchType"].replace({"FourSeamFastBall": "Fastball"})

    df["ExitSpeedCategory"] = pd.cut(
        df["ExitSpeed"], bins=[-1, 74.99, 94.99, 1000], labels=["0-74", "75-95", "95+"]
    )

    print(f"Total rows: {len(df)}")
    print("Seasons found:", sorted(df["Season"].dropna().unique().tolist()))

    export(df)


def export(df):
    def r1(x):
        try:
            if pd.isna(x):
                return None
            return round(float(x), 2)
        except (TypeError, ValueError):
            return None

    def s(x):
        return None if pd.isna(x) else str(x)

    def b(x):
        return 1 if bool(x) else 0

    def n(x):
        try:
            if pd.isna(x):
                return None
            return round(float(x), 3)
        except (TypeError, ValueError):
            return None

    cols = [
        "Date", "Season", "Batter", "BatterTeam", "BatterSide", "Pitcher", "PitcherThrows", "PitcherTeam",
        "Game", "GameID", "Balls", "Strikes", "Pitch", "PitchCall", "KorBB", "HitType", "PlayResult",
        "RelSpeed", "IVB", "HB", "PLH", "PLS", "EV", "LA", "Dir", "Dist", "Bearing",
        "CPX", "CPY", "CPZ", "CSProb",
        "H", "XBH", "Out", "Err", "GB", "FB_hit", "LD", "BBE",
        "InPlay", "Contact", "Swing", "Whiff", "CSW", "Strike", "Take", "CS", "CB", "Ball", "Foul",
        "Zone", "Buffer", "SweetSpot", "HardHit", "Barrel", "Bunt",
        "Single", "Double", "Triple", "HR", "Sac", "HBP", "SO", "BB", "LeadOff", "FP",
        "FBc", "OSc", "BBc", "OffSpeed",
        "AB", "PA", "IP", "HitProb", "Slug", "wOBA", "xwOBA", "HitCk",
    ]

    rows = []
    for _, r in df.iterrows():
        rows.append([
            s(r["Date"].strftime("%Y-%m-%d") if pd.notna(r["Date"]) else None),
            s(r["Season"]),
            s(r["Batter"]), s(r["BatterTeam"]), s(r["BatterSide"]),
            s(r["Pitcher"]), s(r["PitcherThrows"]), s(r["PitcherTeam"]),
            s(r["Game"]), s(r["GameID"]),
            n(r["Balls"]), n(r["Strikes"]),
            s(r["PitchDisplay"]), s(r["PitchCall"]), s(r["KorBB"]), s(r["TaggedHitType"]), s(r["PlayResult"]),
            r1(r["RelSpeed"]), r1(r["InducedVertBreak"]), r1(r["HorzBreak"]),
            r1(r["PlateLocHeight"]), r1(r["PlateLocSide"]),
            r1(r["ExitSpeed"]), r1(r["Angle"]), r1(r["Direction"]), r1(r["Distance"]), r1(r["Bearing"]),
            r1(r["ContactPositionX"]), r1(r["ContactPositionY"]), r1(r["ContactPositionZ"]),
            r1(r["called_strike_prob"]) if "called_strike_prob" in df.columns else None,
            b(r["HCheck"]), b(r["XBHCheck"]), b(r["OutCheck"]), b(r["ErrorCheck"]),
            b(r["GBCheck"]), b(r["FlyBallCheck"]), b(r["LDCheck"]), b(r["BBECheck"]),
            b(r["InPlayCheck"]), b(r["ContactCheck"]), b(r["SwingCheck"]), b(r["WhiffCheck"]),
            b(r["CSWCheck"]), b(r["StrikeCheck"]), b(r["TakeCheck"]), b(r["CalledStrikeCheck"]),
            b(r["CalledBallCheck"]), b(r["BallCheck"]), b(r["FoulCheck"]),
            b(r["ZoneCheck"]), b(r["BufferCheck"]),
            b(r["SweetSpotCheck"]), b(r["HardHitCheck"]), b(r["BarrelCheck"]), b(r["BuntCheck"]),
            b(r["SingleCheck"]), b(r["DoubleCheck"]), b(r["TripleCheck"]), b(r["HRCheck"]),
            b(r["SacCheck"]), b(r["HBPCheck"]), b(r["StrikeoutCheck"]), b(r["WalkCheck"]),
            b(r["LeadOffCheck"]), b(r["FPCheck"]),
            b(r["FBCheck"]), b(r["OSCheck"]), b(r["BBCheck"]), b(r["OffSpeedCheck"]),
            int(r["ABCheck"]) if pd.notna(r["ABCheck"]) else 0,
            int(r["PACheck"]) if pd.notna(r["PACheck"]) else 0,
            b(r["IPCheck"]),
            n(r["HitProbabilityCheck"]), n(r["SluggingCheck"]), n(r["WOBACheck"]), n(r["xwOBACheck"]),
            n(r["HitCheck"]) if pd.notna(r["HitCheck"]) else None,
        ])

    payload = {"cols": cols, "rows": rows, "team": TEAM}
    data_json = json.dumps(payload, separators=(",", ":"))
    print(f"data.json payload: {len(rows)} rows x {len(cols)} cols, {len(data_json)/1e6:.2f} MB")

    assemble_html(data_json)


def assemble_html(data_json):
    with open(os.path.join(TEMPLATE_DIR, "shell.html"), "r") as f:
        shell = f.read()
    with open(os.path.join(TEMPLATE_DIR, "app.js"), "r") as f:
        app_js = f.read()

    html = shell.replace("__DATA_JSON__", data_json)
    # __APP_JS__ replaced via function to avoid backslash/group-reference issues in app_js
    html = re.sub(r"__APP_JS__", lambda _: app_js, html, count=1)

    with open(OUT_HTML, "w") as f:
        f.write(html)
    print(f"Wrote {OUT_HTML} ({os.path.getsize(OUT_HTML)/1e6:.2f} MB)")


if __name__ == "__main__":
    build()

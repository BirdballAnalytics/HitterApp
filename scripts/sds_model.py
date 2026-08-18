"""
Swing Decision Score (SDS) — Python port of compute_sds.r / weekly_sds_score.r.

Why this lives in the Python build pipeline rather than the browser: the
original R implementation trains three cascaded random-forest classifiers
(swing -> contact-given-swing -> hard-hit-given-contact) via `ranger`.
There's no equivalent of that in client-side JavaScript, and there
shouldn't be — training a model in a visitor's browser on every page load
would be slow and pointless. Since this whole site already gets rebuilt
fresh by GitHub Actions on every data push, it's a natural fit to train
here in Python (scikit-learn) instead, and just bake the resulting
per-pitch SDS value into the exported JSON. The frontend only ever
displays/aggregates a number that's already been computed.

This also fixes the issues flagged in the original R scripts:
  - The min-max scaling and the league mean/SD are computed ONCE here,
    from the full combined dataset, and used consistently -- there's no
    separate "weekly scoring" step with its own (inconsistent, narrower)
    scaling the way weekly_sds_score.r had.
  - swing/contact/hard-hit reuse the SAME boolean flags the rest of the
    app already computes (SwingCheck/ContactCheck/HardHitCheck in
    build.py), rather than a second, slightly different definition.
  - The swing-branch reward term is P_contact_given_swing *
    P_hardhit_given_contact (the model's belief about a swing that
    already happened), not re-multiplied by P_swing the way the original
    formula accidentally did.
  - The train/test split is actually evaluated (AUC printed at build
    time) instead of being created and never used.
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.neighbors import NearestNeighbors

SEED = 2025
RF_TREES = 500
HARD_HIT_THRESHOLD = 95
TWO_STRIKE_WEIGHT = 1.5

# Rulebook-ish strike zone -- baseline for both the dynamic (count-dependent)
# in_zone model feature AND the fixed Heart/Shadow/Chase/Waste attack zones.
STRIKE_TOP = 3.5
STRIKE_BOTTOM = 1.5
STRIKE_LEFT = -0.95
STRIKE_RIGHT = 0.95

PREDICTORS = ["EffectiveVelo", "InducedVertBreak", "HorzBreak",
              "PlateLocHeight", "PlateLocSide", "in_zone_dynamic"]


def _dynamic_in_zone(df):
    zone_factor = np.select(
        [df["Strikes"] == 0, df["Strikes"] == 1, df["Strikes"] == 2],
        [0.9, 1.0, 1.15], default=1.0,
    )
    return (
        (df["PlateLocHeight"] >= STRIKE_BOTTOM * zone_factor)
        & (df["PlateLocHeight"] <= STRIKE_TOP * zone_factor)
        & (df["PlateLocSide"] >= STRIKE_LEFT * zone_factor)
        & (df["PlateLocSide"] <= STRIKE_RIGHT * zone_factor)
    ).astype(int)


def _attack_zone(df):
    """Heart / Shadow / Chase / Waste, matching Baseball Savant's
    methodology: Heart = inner 2/3 of the zone (per dimension), Shadow =
    the band straddling the zone edge out to 4/3 of the zone's
    half-dimensions, Chase = out to a box twice the zone's size, Waste =
    beyond that. Uses the FIXED zone (unlike in_zone above), since
    attack zones don't change by count."""
    cx = (STRIKE_LEFT + STRIKE_RIGHT) / 2
    cy = (STRIKE_BOTTOM + STRIKE_TOP) / 2
    half_w = (STRIKE_RIGHT - STRIKE_LEFT) / 2
    half_h = (STRIKE_TOP - STRIKE_BOTTOM) / 2
    dx = (df["PlateLocSide"] - cx).abs() / half_w
    dy = (df["PlateLocHeight"] - cy).abs() / half_h
    d = np.maximum(dx, dy)
    zone = pd.Series(np.select(
        [d <= 2 / 3, d <= 4 / 3, d <= 2],
        ["Heart", "Shadow", "Chase"], default="Waste",
    ), index=df.index)
    zone[df["PlateLocSide"].isna() | df["PlateLocHeight"].isna()] = None
    return zone


def _fill_called_strike_nn(df, ump):
    """1-nearest-neighbor fallback fill for any pitch whose rounded
    location didn't find an exact match in the called-strike lookup —
    same idea as the R scripts' FNN::get.knnx call."""
    missing = df["called_strike_prob"].isna()
    if not missing.any():
        return df
    n_missing = int(missing.sum())
    print(f"  {n_missing} rows missing called_strike_prob after exact rounded join; filling by nearest-neighbor search.")
    cs_coords = ump.dropna(subset=["PlateLocHeight", "PlateLocSide", "called_strike_prob"]).drop_duplicates(
        subset=["PlateLocHeight", "PlateLocSide"]
    )
    query_mask = missing & df["RoundedPLH"].notna() & df["RoundedPLS"].notna()
    if query_mask.sum() == 0 or len(cs_coords) == 0:
        return df
    nn = NearestNeighbors(n_neighbors=1).fit(cs_coords[["PlateLocHeight", "PlateLocSide"]].values)
    query = df.loc[query_mask, ["RoundedPLH", "RoundedPLS"]].values
    _, idx = nn.kneighbors(query)
    df.loc[query_mask, "called_strike_prob"] = cs_coords["called_strike_prob"].values[idx.flatten()]
    return df


def _ranger_style_prob1(model, X):
    """predict_proba for class 1, robust to a model that only ever saw
    one class in training (edge case with very small samples)."""
    classes = list(model.classes_)
    proba = model.predict_proba(X)
    if 1 in classes:
        return proba[:, classes.index(1)]
    return np.zeros(len(X))


def compute_sds(df, ump_lookup):
    """Adds 'SDS' (0-100, NaN where not applicable) and 'AttackZone'
    columns to df. Returns (df, league_mean_sds, league_sd_sds) — the
    league baseline is computed once here and should be reused as a
    FIXED reference everywhere downstream (the frontend included), the
    same fix applied on the R side: recomputing it from whatever subset
    happens to be currently filtered/visible defeats the point of a
    stable comparison baseline.
    """
    print("Training SDS models (swing -> contact -> hard-hit cascade)...")
    work = df.copy()

    # called_strike_prob: exact-rounded join already done upstream in
    # build.py (see called_strike_prob merge); this just adds the NN
    # fallback fill for any pitches that didn't find an exact match.
    work = _fill_called_strike_nn(work, ump_lookup)

    work["in_zone_dynamic"] = _dynamic_in_zone(work)
    work["AttackZone"] = _attack_zone(work)

    # Reuse the SAME swing/contact/hard-hit flags the rest of the app
    # already computes -- single definition, not a second copy.
    work["swing"] = work["SwingCheck"].astype(int)
    work["contact"] = work["ContactCheck"].astype(int)
    work["hard_hit"] = work["HardHitCheck"].astype(int)

    # Exclude 3-0 counts and "waste pitches" (near-zero called-strike
    # probability that weren't swung at) from the modeling/scoring
    # population, same as the R scripts. These rows simply get SDS = NaN
    # in the export rather than being dropped from the dataset entirely
    # (unlike the R scripts, this dataset feeds every other tab too).
    eligible = ~((work["Balls"] == 3) & (work["Strikes"] == 0))
    eligible &= ~((work["called_strike_prob"] < 0.01) & (work["swing"] == 0))

    model_df = work.loc[eligible].copy()
    predictors_present = [p for p in PREDICTORS if p in model_df.columns]
    model_df = model_df.dropna(subset=predictors_present + ["swing", "contact", "hard_hit", "called_strike_prob"])

    if len(model_df) < 200:
        print("  Not enough eligible rows to train SDS models -- skipping SDS for this build.")
        df["SDS"] = np.nan
        df["AttackZone"] = _attack_zone(df)
        return df, np.nan, np.nan

    train, test = train_test_split(
        model_df, test_size=0.5, random_state=SEED, stratify=model_df["swing"]
    )

    def rf(**kw):
        return RandomForestClassifier(n_estimators=RF_TREES, random_state=SEED, n_jobs=-1, **kw)

    # 1) Swing model
    swing_model = rf().fit(train[predictors_present], train["swing"])

    # 2) Contact model -- trained on swings only
    train_swings = train[train["swing"] == 1]
    contact_model = rf().fit(train_swings[predictors_present], train_swings["contact"])

    # 3) Hard-hit model -- trained on contact, excluding 2-strike counts
    train_contact = train_swings[train_swings["contact"] == 1]
    train_contact_hh = train_contact[train_contact["Strikes"] != 2]
    hardhit_model = rf().fit(train_contact_hh[predictors_present], train_contact_hh["hard_hit"])

    # ---- Evaluate on the held-out test set (previously created, never used) ----
    print("  --- Held-out test set performance ---")
    swing_pred = _ranger_style_prob1(swing_model, test[predictors_present])
    try:
        auc = roc_auc_score(test["swing"], swing_pred)
        print(f"  Swing model    AUC: {auc:.3f}  (n={len(test)})")
    except ValueError:
        print("  Swing model    AUC: skipped (only one class present)")

    test_swings = test[test["swing"] == 1]
    if len(test_swings) >= 10:
        contact_pred = _ranger_style_prob1(contact_model, test_swings[predictors_present])
        try:
            auc = roc_auc_score(test_swings["contact"], contact_pred)
            print(f"  Contact model  AUC: {auc:.3f}  (n={len(test_swings)} swings)")
        except ValueError:
            print("  Contact model  AUC: skipped (only one class present)")

    test_contact_rows = test_swings[(test_swings["contact"] == 1) & (test_swings["Strikes"] != 2)]
    if len(test_contact_rows) >= 10:
        hh_pred = _ranger_style_prob1(hardhit_model, test_contact_rows[predictors_present])
        try:
            auc = roc_auc_score(test_contact_rows["hard_hit"], hh_pred)
            print(f"  Hard-hit model AUC: {auc:.3f}  (n={len(test_contact_rows)} contact, non-2K)")
        except ValueError:
            print("  Hard-hit model AUC: skipped (only one class present)")
    print("  --------------------------------------")

    # ---- Predict on the full eligible population ----
    X_full = model_df[predictors_present]
    model_df["P_swing"] = _ranger_style_prob1(swing_model, X_full)
    model_df["P_contact_given_swing"] = _ranger_style_prob1(contact_model, X_full)
    model_df["P_hardhit_given_contact"] = _ranger_style_prob1(hardhit_model, X_full)

    # FIX vs. the original R formula: the swing-branch term used to be
    # P_swing * P_contact_given_swing * P_hardhit_given_contact -- i.e. it
    # re-multiplied by P_swing even though these are rows where swing==1
    # is already a known fact. That's P(swing & contact & hard-hit), not
    # a meaningful reward conditioned on a swing that already happened.
    # Uses P_contact_given_swing * P_hardhit_given_contact instead.
    model_df["P_contact_hardhit_given_swing"] = (
        model_df["P_contact_given_swing"] * model_df["P_hardhit_given_contact"]
    )
    model_df["raw_score"] = np.where(
        model_df["swing"] == 1,
        model_df["called_strike_prob"] + model_df["P_contact_hardhit_given_swing"],
        (1 - model_df["called_strike_prob"]) * (1 - model_df["P_swing"]),
    )
    model_df["raw_score"] = np.where(
        model_df["Strikes"] == 2, model_df["raw_score"] * TWO_STRIKE_WEIGHT, model_df["raw_score"]
    )

    min_raw, max_raw = model_df["raw_score"].min(), model_df["raw_score"].max()
    if max_raw - min_raw == 0:
        max_raw = min_raw + 1e-6
    model_df["SDS"] = 100 * (model_df["raw_score"] - min_raw) / (max_raw - min_raw)

    league_mean_sds = float(model_df["SDS"].mean())
    league_sd_sds = float(model_df["SDS"].std())
    print(f"  League SDS: mean={league_mean_sds:.2f}, sd={league_sd_sds:.2f}, n={len(model_df)}")

    df = df.copy()
    df["SDS"] = model_df["SDS"].reindex(df.index)
    df["AttackZone"] = _attack_zone(df)
    return df, league_mean_sds, league_sd_sds

"""Plot coverage/quality/score histograms from Stage B parquet output."""

from __future__ import annotations

import os
from typing import Iterable, List

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

plt.style.use("seaborn-v0_8")
plt.rcParams.update({
    "figure.facecolor": "white",
    "axes.facecolor": "#f5f5f5",
    "axes.edgecolor": "#d8d8d8",
    "axes.titleweight": "bold",
})

PARQUET_PATH = os.path.join(os.path.dirname(__file__), "data", "courses_scores.parquet")
OUTPUT_DIR = os.path.join(os.path.dirname(PARQUET_PATH), "plots")
REQUIRED_COLUMNS: List[str] = ["aspect", "coverage", "quality", "score"]
METRICS: List[str] = ["coverage", "quality", "score"]
BINS = 40
BAR_COLOR = "#3C6997"
MEAN_COLOR = "#D45087"
MEDIAN_COLOR = "#2A9D8F"


def _ensure_columns(df: pd.DataFrame, columns: Iterable[str]) -> List[str]:
    missing = [col for col in columns if col not in df.columns]
    if missing:
        joined = ", ".join(missing)
        raise SystemExit(f"Missing column(s) in parquet: {joined}")
    return list(columns)


def _plot_hist(series: pd.Series, title: str, out_path: str, bins: int) -> None:
    data = series.dropna().values.astype(float)
    if data.size == 0:
        print(f"[warn] Series '{series.name}' has no numeric data after dropping NaNs; skipping")
        return

    mean_val = float(np.mean(data))
    median_val = float(np.median(data))
    std_val = float(np.std(data))

    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.hist(data, bins=bins, color=BAR_COLOR, alpha=0.85, edgecolor="white")
    ax.axvline(mean_val, color=MEAN_COLOR, linewidth=2, linestyle="--", label=f"Mean: {mean_val:.3f}")
    ax.axvline(median_val, color=MEDIAN_COLOR, linewidth=2, linestyle="-.", label=f"Median: {median_val:.3f}")

    ax.set_title(title)
    ax.set_xlabel(series.name)
    ax.set_ylabel("Course count")

    stats_text = f"n={data.size}\nμ={mean_val:.3f}\nσ={std_val:.3f}"
    ax.text(
        0.98,
        0.95,
        stats_text,
        transform=ax.transAxes,
        va="top",
        ha="right",
        fontsize=9,
        bbox={"boxstyle": "round,pad=0.35", "fc": "white", "ec": "#cccccc", "alpha": 0.9},
    )

    ax.legend(loc="upper left", frameon=False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.tick_params(axis="both", which="major", labelsize=9)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f"[ok] Saved plot -> {out_path}")
    plt.close(fig)


def main() -> None:
    parquet_path = os.path.realpath(PARQUET_PATH)
    if not os.path.exists(parquet_path):
        raise SystemExit(f"Parquet file not found: {parquet_path}")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    df = pd.read_parquet(parquet_path)
    _ensure_columns(df, REQUIRED_COLUMNS)

    aspects = sorted(df["aspect"].dropna().unique())
    if not aspects:
        raise SystemExit("No aspect values found in parquet.")

    for aspect in aspects:
        subset = df[df["aspect"] == aspect]
        if subset.empty:
            continue
        for metric in METRICS:
            out_path = os.path.join(OUTPUT_DIR, f"{aspect}_{metric}.png")
            title = f"{aspect}: distribution of {metric}"
            _plot_hist(subset[metric], title=title, out_path=out_path, bins=BINS)


if __name__ == "__main__":
    main()

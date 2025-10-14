#!/usr/bin/env python3
"""Generate program tree JSON files from coursebook_programs.csv.

The resulting structure groups program names by degree and level so the
client can drive cascading selects for degree → level → program.

Usage
-----
python build_programs_tree.py \
    --input data/coursebook_programs.csv \
    --output data/programs_tree.json \
    --client-output ../client/public/programs_tree.json
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple


ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "data" / "coursebook_programs.csv"
DEFAULT_OUTPUT = ROOT / "data" / "programs_tree.json"
DEFAULT_CLIENT_OUTPUT = ROOT.parent / "client" / "public" / "programs_tree.json"

LEVEL_RE = re.compile(r"^(ba|ma)(\d+)$", re.IGNORECASE)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the degree/level→program tree from the CSV export."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Path to coursebook_programs.csv (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Destination for the data copy (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--client-output",
        type=Path,
        default=DEFAULT_CLIENT_OUTPUT,
        help="Optional location for a second copy (defaults to client/public/programs_tree.json).",
    )
    return parser.parse_args(argv)


def normalize_program_name(name: str) -> str:
    return name.strip()


def determine_bucket(level: str, program_name: str) -> Optional[Tuple[str, str]]:
    level = (level or "").strip()
    name = (program_name or "").strip()
    if not level or not name:
        return None

    lower_level = level.lower()
    lower_name = name.lower()

    match = LEVEL_RE.match(level)
    if match:
        degree = match.group(1).upper()
        normalized_level = f"{degree}{match.group(2)}"
        return degree, normalized_level

    if "master project" in lower_level:
        season = "Fall" if any(token in lower_level for token in ("fall", "autumn")) else "Spring"
        return "MA", f"MA Project {season}"

    if level == "Doctoral School":
        return "PhD", "Doctoral School"

    if "semester" in lower_level and any(token in lower_level for token in ("spring", "autumn", "fall")):
        if "minor" in lower_name:
            season = "Fall" if any(token in lower_level for token in ("fall", "autumn")) else "Spring"
            return "MA", f"Minor {season} Semester"
        return None

    if level.lower().startswith("admission"):
        # Admission programmes are not currently surfaced in the UI.
        return None

    return None


def build_tree(rows: Iterable[Dict[str, str]]) -> Dict[str, Dict[str, Set[str]]]:
    tree: Dict[str, Dict[str, Set[str]]] = defaultdict(lambda: defaultdict(set))
    for row in rows:
        program_name = normalize_program_name(row.get("program_name", ""))
        if not program_name:
            continue
        bucket = determine_bucket(row.get("level", ""), program_name)
        if not bucket:
            continue
        degree, level = bucket
        tree[degree][level].add(program_name)
    return tree


def natural_level_key(level: str) -> Tuple[int, str, int]:
    match = LEVEL_RE.match(level)
    if match:
        degree = match.group(1).upper()
        number = int(match.group(2))
        order = 0 if degree == "BA" else 1
        return (order, degree, number)
    if level.startswith("MA Project"):
        return (2, level, 0)
    if level.startswith("Minor"):
        return (3, level, 0)
    return (4, level, 0)


def finalize(tree: Dict[str, Dict[str, Set[str]]]) -> Dict[str, Dict[str, List[str]]]:
    result: Dict[str, Dict[str, List[str]]] = {}
    degree_order = {"BA": 0, "MA": 1, "PhD": 2}
    for degree in sorted(tree.keys(), key=lambda d: (degree_order.get(d, 99), d)):
        levels = tree[degree]
        if not levels:
            continue
        result[degree] = {}
        for level in sorted(levels.keys(), key=natural_level_key):
            names = sorted(levels[level], key=lambda s: s.casefold())
            if names:
                result[degree][level] = names
    return result


def write_json(path: Path, data: Dict[str, Dict[str, List[str]]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def read_rows(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    rows = read_rows(args.input)
    tree = finalize(build_tree(rows))
    write_json(args.output, tree)
    if args.client_output:
        write_json(args.client_output, tree)
    print(f"[ok] Wrote programs tree with {sum(len(v) for v in tree.values())} buckets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

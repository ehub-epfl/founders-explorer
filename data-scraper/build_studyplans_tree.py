#!/usr/bin/env python3
"""Generate study plan tree JSON files from coursebook_studyplans.csv.

The resulting structure groups faculties by study cycle (BA / MA / MA Minor)
so the client can drive cascading selects without the study block layer.

Usage
-----
python build_studyplans_tree.py \
    --input data/coursebook_studyplans.csv \
    --output data/studyplans_tree.json \
    --client-output ../client/public/studyplans_tree.json
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set


ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "data" / "coursebook_studyplans.csv"
DEFAULT_OUTPUT = ROOT / "data" / "studyplans_tree.json"
DEFAULT_CLIENT_OUTPUT = ROOT.parent / "client" / "public" / "studyplans_tree.json"

def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the study cycle→faculty tree from the CSV export."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Path to coursebook_studyplans.csv (default: {DEFAULT_INPUT})",
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
        help="Optional location for a second copy (defaults to client/public/studyplans_tree.json).",
    )
    return parser.parse_args(argv)


def normalize_value(value: str) -> str:
    return (value or "").strip()


def map_study_program(study_program: str) -> Optional[str]:
    key = normalize_value(study_program).lower()
    if not key:
        return None
    if "minor" in key:
        return "MA Minor"
    if key == "propedeutics":
        return "Propedeutics"
    if key == "propedeutics and bachelor cycle":
        return "BA"
    if key in {"ba", "bachelor", "bachelor cycle"}:
        return "BA"
    if "propedeutics" in key and "bachelor cycle" in key:
        return "BA"
    if key in {"ma", "master"}:
        return "MA"
    if "master cycle" in key:
        return "MA"
    if "doctoral" in key or key == "phd":
        return "Doctoral School"
    return None


def build_tree(rows: Iterable[Dict[str, str]]) -> Dict[str, Set[str]]:
    tree: Dict[str, Set[str]] = defaultdict(set)
    for row in rows:
        cycle = map_study_program(row.get("study_program", ""))
        if not cycle:
            continue
        faculty = normalize_value(row.get("study_faculty", ""))
        if not faculty:
            continue
        tree[cycle].add(faculty)
    return tree


def finalize(tree: Dict[str, Set[str]]) -> Dict[str, List[str]]:
    result: Dict[str, List[str]] = {}
    cycle_order = {"Propedeutics": 0, "BA": 1, "MA": 2, "MA Minor": 3, "Doctoral School": 4}
    for cycle in sorted(tree.keys(), key=lambda c: (cycle_order.get(c, 99), c)):
        faculties = sorted(tree[cycle], key=lambda f: f.casefold())
        if not faculties:
            continue
        result[cycle] = faculties
    return result


def write_json(path: Path, data: Dict[str, List[str]]) -> None:
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
    entries = sum(len(faculties) for faculties in tree.values())
    print(f"[ok] Wrote study plans tree with {entries} faculty entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

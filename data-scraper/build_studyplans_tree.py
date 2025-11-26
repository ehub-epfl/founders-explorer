#!/usr/bin/env python3
"""Generate study plan tree JSON from coursebook_url.json.

We keep a two-level shape: first level `study_program`, second level a list of
`study_plan` labels (which come from `study_faculty` in the source).

Usage
-----
python build_studyplans_tree.py \
    --input data/coursebook_url.json \
    --output data/studyplans_tree.json \
    --client-output ../client/public/studyplans_tree.json
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set


ROOT = Path(__file__).resolve().parent
DEFAULT_INPUT = ROOT / "data" / "coursebook_url.json"
DEFAULT_OUTPUT = ROOT / "data" / "studyplans_tree.json"
DEFAULT_CLIENT_OUTPUT = ROOT.parent / "client" / "public" / "studyplans_tree.json"

def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build study_program → study_plan list from coursebook_url.json."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Path to coursebook_url.json (default: {DEFAULT_INPUT})",
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


def build_tree(entries: Iterable[Dict[str, str]]) -> Dict[str, Set[str]]:
    tree: Dict[str, Set[str]] = defaultdict(set)
    for entry in entries:
        program = normalize_value(entry.get("study_program", ""))
        study_plan = normalize_value(entry.get("study_faculty", ""))
        if not program or not study_plan:
            continue
        tree[program].add(study_plan)
    return tree


def finalize(tree: Dict[str, Set[str]]) -> Dict[str, List[str]]:
    result: Dict[str, List[str]] = {}
    for program in sorted(tree.keys(), key=lambda c: c.casefold()):
        plans = sorted(tree[program], key=lambda f: f.casefold())
        if not plans:
            continue
        result[program] = plans
    return result


def write_json(path: Path, data: Dict[str, List[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def read_entries(path: Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, list) else []


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    entries = read_entries(args.input)
    tree = finalize(build_tree(entries))
    write_json(args.output, tree)
    if args.client_output:
        write_json(args.client_output, tree)
    count = sum(len(plans) for plans in tree.values())
    print(f"[ok] Wrote study plans tree with {count} study plan entries.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

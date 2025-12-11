#!/usr/bin/env python3
"""Summarize people_profiles introduction_snippet into a short paragraph.

Reads data-scraper/data/people_profiles.csv and writes a CSV with an added
column introduction_summary that contains a concise 1–3 sentence summary of
introduction_snippet. Uses a local Ollama model (configurable) to generate
summaries. When no LLM is available or the snippet is empty, leaves the
summary blank.

Examples
- Default IO:
    python3 data-scraper/llm_tools/summarize_people_profiles.py
- Overwrite in place:
    python3 data-scraper/llm_tools/summarize_people_profiles.py --inplace
- Limit number processed for testing:
    python3 data-scraper/llm_tools/summarize_people_profiles.py --limit 50
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import os
import json
import time
import hashlib
import threading
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import ollama  # type: ignore
except Exception:  # pragma: no cover
    ollama = None  # lazy check later


DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DEFAULT_INPUT = DATA_DIR / "people_profiles.csv"
DEFAULT_OUTPUT = DATA_DIR / "people_profiles_with_summary.csv"

# Keep the prompts as explicit constants so any change
# automatically produces a different cache key.
SUMMARY_SYSTEM_PROMPT = (
    "You are a concise assistant that writes clear, neutral summaries."
)
SUMMARY_USER_PREFIX = (
    "Summarize the following person introduction into a SINGLE short paragraph (2–3 sentences).\n"
    "Focus on research areas, roles, labs, and notable themes.\n"
    "Return plain text only (no bullets, no markdown).\n\n"
    "INTRODUCTION:\n"
)


def _log(msg: str) -> None:
    print(f"[summary] {msg}")


def summarize_text(text: str, model: str, keep_alive: str = "5m", stream: bool = False, retries: int = 2, max_chars: int = 6000) -> str:
    """Ask the local Ollama model to summarize text into a short paragraph.

    Returns a plain-text paragraph, or empty string on failure.
    """
    if not text or not text.strip():
        return ""
    if ollama is None:
        _log("ollama not available; leaving summary empty")
        return ""

    # Trim very long inputs to keep context small (speeds up generation)
    text = text.strip()
    if len(text) > max_chars:
        text = text[:max_chars]

    system = SUMMARY_SYSTEM_PROMPT
    user = SUMMARY_USER_PREFIX + text

    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]

    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            if stream:
                chunks: List[str] = []
                for chunk in ollama.chat(model=model, messages=messages, stream=True, keep_alive=keep_alive):
                    content = chunk["message"]["content"]
                    print(content, end="", flush=True)
                    chunks.append(content)
                print()
                return "".join(chunks).strip()
            else:
                resp = ollama.chat(model=model, messages=messages, keep_alive=keep_alive)
                return (resp.get("message", {}).get("content", "") or "").strip()
        except Exception as exc:  # pragma: no cover
            last_err = exc
            # simple backoff
            time.sleep(0.6 * (attempt + 1))
    _log(f"ollama error: {last_err}")
    return ""


def read_rows(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        _log(f"input not found: {path}")
        sys.exit(1)
    # Allow very large CSV fields (some introduction_snippet values are big)
    try:
        csv.field_size_limit(max(csv.field_size_limit(), 10 * 1024 * 1024))
    except Exception:
        try:
            csv.field_size_limit(10 * 1024 * 1024)
        except Exception:
            pass
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader)


def write_rows(rows: Iterable[Dict[str, str]], fieldnames: List[str], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)


# ---------- Lightweight persistent cache (speeds up reruns) ----------
_CACHE_LOCK = threading.Lock()

def _norm_text(s: str) -> str:
    return (s or "").strip()

def _hash_call(model: str, text: str, name: str) -> str:
    """Generate a cache key that is sensitive to content, prompt, model and teacher name."""
    pieces = [
        (model or "").strip(),
        SUMMARY_SYSTEM_PROMPT.strip(),
        SUMMARY_USER_PREFIX.strip(),
        _norm_text(text),
        _norm_text(name),
    ]
    return hashlib.sha256("\n".join(pieces).encode("utf-8")).hexdigest()

def _load_cache(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    cache: Dict[str, str] = {}
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    k = obj.get("k"); v = obj.get("v", "")
                    if k:
                        cache[k] = v
                except Exception:
                    continue
        return cache
    except Exception:
        return {}

def _append_cache(path: Path, key: str, val: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _CACHE_LOCK:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"k": key, "v": val}, ensure_ascii=False) + "\n")


def add_summaries(
    rows: List[Dict[str, str]],
    model: str,
    overwrite: bool = False,
    limit: Optional[int] = None,
    workers: int = 1,
    use_cache: bool = True,
) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []

    # Determine how many rows we will actually process
    total = len(rows) if limit is None else min(len(rows), limit)

    cache_path = DATA_DIR / "cache" / "people_summaries.jsonl"
    cache: Dict[str, str] = _load_cache(cache_path) if use_cache else {}

    # Build worklist with indices preserved for stable ordering
    tasks: List[Tuple[int, Dict[str, str], str, str]] = []  # (idx, row, cache_key, intro)
    for i, row in enumerate(rows[:total]):
        intro = _norm_text(row.get("introduction_snippet", ""))
        name_for_prefix = _norm_text(row.get("name") or row.get("person_name") or "")
        existing = _norm_text(row.get("introduction_summary", ""))
        if existing and not overwrite:
            # keep as is (no work)
            out.append(row)
            continue
        if not intro:
            row["introduction_summary"] = ""
            out.append(row)
            continue
        key = _hash_call(model, intro, name_for_prefix)
        if use_cache and key in cache:
            row["introduction_summary"] = cache[key]
            out.append(row)
            continue
        tasks.append((len(out), row, key, intro))
        out.append(row)  # placeholder to keep order

    # Early return if nothing to do
    if not tasks:
        # still need to append any remaining rows beyond `total`
        for row in rows[total:]:
            out.append(row)
        # progress line
        sys.stdout.write(f"\r[{total}/{total}] 100.0%\n")
        sys.stdout.flush()
        return out

    # If ollama not available, skip heavy work
    if ollama is None:
        for _, row, _, _ in tasks:
            row["introduction_summary"] = row.get("introduction_summary", "")
        for row in rows[total:]:
            out.append(row)
        sys.stdout.write(f"\r[{total}/{total}] 100.0%\n")
        sys.stdout.flush()
        return out

    # Run generation, possibly in parallel
    max_workers = max(1, int(workers or 1))

    def _do_summary(intro_text: str, display_name: str) -> str:
        base = summarize_text(intro_text, model=model, stream=False)
        base = _norm_text(base)
        name = _norm_text(display_name)
        if not base or not name:
            return base

        # Already starts with the name (e.g. "Davide Bavato is ...") -> keep as-is.
        if base.lower().startswith(name.lower()):
            return base

        # Common pattern from the model: "He/She/They ..." → replace pronoun with the name.
        m = re.match(r"^(they|he|she)\b(.*)", base, flags=re.IGNORECASE)
        if m:
            # Preserve the rest of the sentence exactly as the model wrote it.
            replaced = f"{name}{m.group(2)}"
            return _norm_text(replaced)

        # Fallback: prepend the name as a short lead-in sentence.
        # This avoids ungrammatical constructs like "Name is the purpose of..."
        return f"{name}. {base}"

    completed = 0
    if max_workers == 1:
        for idx, row, key, intro in tasks:
            name_for_prefix = _norm_text(row.get("name") or row.get("person_name") or "")
            summary = _do_summary(intro, name_for_prefix)
            row["introduction_summary"] = summary
            if use_cache:
                _append_cache(cache_path, key, summary)
            completed += 1
            pct = (completed / len(tasks)) * 100.0
            sys.stdout.write(f"\r[{completed}/{len(tasks)}] {pct:5.1f}%")
            sys.stdout.flush()
    else:
        lock = threading.Lock()
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            future_map = {
                ex.submit(
                    _do_summary,
                    intro,
                    _norm_text(row.get("name") or row.get("person_name") or ""),
                ): (idx, row, key)
                for idx, row, key, intro in tasks
            }
            for fut in as_completed(future_map):
                idx, row, key = future_map[fut]
                try:
                    summary = fut.result()
                except Exception as exc:  # pragma: no cover
                    summary = ""
                row["introduction_summary"] = summary
                if use_cache:
                    _append_cache(cache_path, key, summary)
                completed += 1
                pct = (completed / len(tasks)) * 100.0
                sys.stdout.write(f"\r[{completed}/{len(tasks)}] {pct:5.1f}%")
                sys.stdout.flush()
    sys.stdout.write("\n")
    sys.stdout.flush()

    # Append any remaining rows not in the first `total` cutoff
    for row in rows[total:]:
        out.append(row)

    return out


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Summarize people_profiles introduction_snippet into introduction_summary")
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT, help=f"Input CSV (default: {DEFAULT_INPUT})")
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"Output CSV (default: {DEFAULT_OUTPUT})")
    p.add_argument("--model", type=str, default="gpt-oss:120b-cloud", help="Ollama model name")
    p.add_argument("--overwrite", action="store_true", help="Overwrite non-empty introduction_summary values")
    p.add_argument("--inplace", action="store_true", help="Write back to input path instead of separate file")
    p.add_argument("--limit", type=int, default=None, help="Only process the first N rows")
    p.add_argument("--workers", type=int, default=4, help="Number of concurrent summaries (default: 4)")
    p.add_argument("--no-cache", action="store_true", help="Disable on-disk cache of summaries")
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    input_path = args.input
    output_path = args.input if args.inplace else args.output

    _log(f"reading: {input_path}")
    rows = read_rows(input_path)

    # Ensure target column exists in fieldnames
    fieldnames = list(rows[0].keys()) if rows else [
        "name", "card_url", "email", "title", "lab_url", "introduction_snippet", "photo_url"
    ]
    if "introduction_summary" not in fieldnames:
        fieldnames.append("introduction_summary")

    _log(f"summarizing with model: {args.model} | workers: {args.workers} | cache: {not args.no_cache}")
    new_rows = add_summaries(
        rows,
        model=args.model,
        overwrite=args.overwrite,
        limit=args.limit,
        workers=args.workers,
        use_cache=(not args.no_cache),
    )

    # Reorder keys for consistent output
    ordered_rows: List[Dict[str, str]] = []
    for r in new_rows:
        out_row = {k: r.get(k, "") for k in fieldnames}
        ordered_rows.append(out_row)

    write_rows(ordered_rows, fieldnames, output_path)
    _log(f"wrote: {output_path}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

#!/usr/bin/env python3
"""Generate course ratings (0–5) using a large language model."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Iterable, Mapping, Optional

from llm_client import LLMClient, build_messages, default_system_prompt


RATING_PROMPT = """You will be given a course description.

Return a JSON object with the following keys, every value a number between 0 and 5:
  - "course_key"
  - "relevance"
  - "skills"
  - "product"
  - "venture"
  - "foundations"
  - "rationale": a concise justification (≤30 words)

Interpret the scores as follows:
0 = not applicable at all, 5 = exceptionally strong.

Always respond with valid JSON."""


def iter_courses(path: Path, limit: Optional[int] = None) -> Iterable[Mapping[str, str]]:
    with path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for idx, row in enumerate(reader, start=1):
            yield row
            if limit is not None and idx >= limit:
                break


def build_user_prompt(course: Mapping[str, str]) -> str:
    payload = {
        "course_key": course.get("course_key", ""),
        "course_name": course.get("course_name", ""),
        "section": course.get("section", ""),
        "language": course.get("language", ""),
        "description": course.get("description", ""),
        "keywords": course.get("keywords", ""),
        "teachers": course.get("teacher", ""),
    }
    return f"Rate the following course:\n\n{json.dumps(payload, ensure_ascii=False, indent=2)}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rate courses using an LLM.")
    parser.add_argument("--input", type=Path, required=True, help="Path to coursebook_courses.csv")
    parser.add_argument("--output", type=Path, required=True, help="Output ratings JSON")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--system-prompt", type=str, default=default_system_prompt())
    parser.add_argument("--prompt", type=str, default=RATING_PROMPT)
    parser.add_argument("--temperature", type=float, default=0.15)
    parser.add_argument("--max-tokens", type=int, default=600)
    return parser.parse_args()


def rate_courses(args: argparse.Namespace):
    client = LLMClient()
    ratings = []
    try:
        for course in iter_courses(args.input, args.limit):
            user_prompt = f"{args.prompt}\n\n{build_user_prompt(course)}"
            messages = build_messages(args.system_prompt, user_prompt)
            raw = client.generate(messages, temperature=args.temperature, max_tokens=args.max_tokens)
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Model returned invalid JSON for {course.get('course_key')}:\n{raw}") from exc
            ratings.append(payload)
    finally:
        client.close()
    return ratings


def main() -> int:
    args = parse_args()
    data = rate_courses(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] Wrote {len(data)} course ratings to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

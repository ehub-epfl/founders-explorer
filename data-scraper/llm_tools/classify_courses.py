#!/usr/bin/env python3
"""Classify coursebook entries using a large language model."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Iterable, List, Mapping, Optional

from llm_client import LLMClient, ChatMessage, build_messages, default_system_prompt


CLASSIFICATION_PROMPT = """You will be given a course description.

Return a JSON object with the following keys:
  - "course_key": the original identifier sent in the prompt.
  - "tags": an array of concise thematic tags (3–6 items, lowercase).
  - "recommended_level": choose one of ["introductory", "intermediate", "advanced"].
  - "audience": a short sentence (≤15 words) describing who benefits the most.
  - "justification": one sentence explaining the tags.

Your response MUST be valid JSON. Do not include Markdown fences or commentary."""


def iter_courses(path: Path, limit: Optional[int] = None) -> Iterable[Mapping[str, str]]:
    with path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for idx, row in enumerate(reader, start=1):
            yield row
            if limit is not None and idx >= limit:
                break


def build_user_prompt(course: Mapping[str, str]) -> str:
    fields = {
        "course_key": course.get("course_key", ""),
        "course_name": course.get("course_name", ""),
        "section": course.get("section", ""),
        "language": course.get("language", ""),
        "description": course.get("description", ""),
        "keywords": course.get("keywords", ""),
        "teachers": course.get("teacher", ""),
    }
    formatted = json.dumps(fields, ensure_ascii=False, indent=2)
    return f"Classify the following course:\n\n{formatted}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Classify courses using an LLM.")
    parser.add_argument("--input", type=Path, required=True, help="Path to coursebook_courses.csv")
    parser.add_argument("--output", type=Path, required=True, help="Where to store the JSON output")
    parser.add_argument("--limit", type=int, default=None, help="Optional limit for testing")
    parser.add_argument("--system-prompt", type=str, default=default_system_prompt())
    parser.add_argument("--prompt", type=str, default=CLASSIFICATION_PROMPT)
    parser.add_argument("--temperature", type=float, default=0.2)
    parser.add_argument("--max-tokens", type=int, default=800)
    return parser.parse_args()


def classify_courses(args: argparse.Namespace) -> List[Mapping[str, object]]:
    client = LLMClient()
    results: List[Mapping[str, object]] = []
    try:
        for course in iter_courses(args.input, limit=args.limit):
            user_prompt = f"{args.prompt}\n\n{build_user_prompt(course)}"
            messages = build_messages(args.system_prompt, user_prompt)
            raw = client.generate(messages, temperature=args.temperature, max_tokens=args.max_tokens)
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Model returned invalid JSON for course {course.get('course_key')}:\n{raw}") from exc
            results.append(payload)
    finally:
        client.close()
    return results


def main() -> int:
    args = parse_args()
    results = classify_courses(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] Wrote {len(results)} course classifications to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

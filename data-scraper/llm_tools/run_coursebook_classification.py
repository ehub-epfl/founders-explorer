"""Batch-run the entrepreneurship classifier across the coursebook dataset.

The script reads ``data/coursebook_courses.csv`` and sends each course description
through the Ollama model defined in ``test_snippet.ask``. Results are collected
into ``data/coursebook_entre_scores.csv`` containing per-course label scores and
evidence snippets.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, Optional

import hashlib
import threading

import ollama

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT.parent.joinpath("data")
INPUT_CSV = DATA_DIR.joinpath("coursebook_courses.csv")
OUTPUT_CSV = DATA_DIR.joinpath("coursebook_entre_scores.csv")
CACHE_DIR = DATA_DIR.joinpath("cache")
COURSEBOOK_CACHE = CACHE_DIR.joinpath("coursebook_entre.jsonl")

MODEL = "gpt-oss:120b-cloud"
SYSTEM_PROMPT = "You are a precise assistant. Return valid JSON and follow instructions strictly."


TITLE_KEYWORDS = [
    "entrepreneur",
    "entrepreneurial",
    "entrepreneurship",
    "startup",
    "start-up",
    "venture",
    "innovation",
    "innovator",
    "business model",
    "lean startup",
    "pitch",
    "incubator",
    "accelerator",
    "commercialization",
    "market validation",
    "customer discovery",
    "spin-off",
    "spin off",
]


PROMPT_TEMPLATE = """
You are a strict course classifier. Read the COURSE DESCRIPTION and return ONLY valid JSON.

CONTEXT
{meta_block}

TASKS
1) Gate: rate how related the course is to Entrepreneurship on a 0–100 scale (integer). Name this "entre_score".
2) If (and only if) entre_score > 0, rate each sublabel below on a 0–100 (integers). Multi-label is allowed.
3) Evidence: for any label with score ≥ 50, extract 1–3 short verbatim snippets (max 20 words each) from the course text that triggered the score. Do not invent text.

SCORING RUBRIC (high-level guidance)
- 90–100: central focus / taught in depth
- 70–89: major component / repeated emphasis
- 50–69: clearly covered but not the main focus
- 30–49: weak/occasional mention; borderline
- 1–29: incidental/irrelevant
- 0: absent

HIERARCHY RULE
- If entre_score < 60, downscale all sublabel scores by multiplying by (entre_score / 60), then round.

LABEL SET (use English keywords but match concepts in any language)
- PD (Personal development / soft skills): negotiation, persuasion, bargaining, trust building, self-leadership, emotional regulation, resilience, feedback, culture, cross-cultural collaboration, stakeholder communication, presentation, visualization, storytelling, narrative, conflict resolution/management, decision making, time/stress management, creativity, brainstorming, critical thinking, self-efficacy, listening, communication, coping with failure, non-verbal communication, systemic thinking, proactive, personal initiative, ethics.
- PB (Product building): product development, requirements/specification, concepting, design thinking, discovery, prototyping, testing, reliability, manufacturability, product management, project management (for building), feasibility, UX/UI, make/build projects, real-world challenges, fabrication, makerspace, discovery learning labs, inventing, device/drug development, practical/innovative solutions, cost–benefit, emerging tech, translational, practical application, regulatory/compliance, clinical evaluation, hands-on.
- VB-MKT (Venture marketing): go-to-market (GTM), segmentation/targeting, customer acquisition, sales funnel, pricing, channels, branding, marketing plan.
- VB-FIN (Venture finance): fundraising, due diligence, term sheet, venture capital, valuation, angel investing, managerial accounting, financial statements, P&L, cash flow, cap table, impact investing.
- VB-STRAT (Strategy/management): platforms, network effects, Blue Ocean, SWOT, competitive advantage, organizational structure, firm strategy, corporate innovation.
- VB-OPS (Operations): supply chain, inventory, logistics, demand forecasting, suppliers, contracts, project phases.
- VB-IP (IP/legal/tech-transfer): IP strategy, patent portfolio, freedom-to-operate, licensing, option agreements, tech transfer, industry partnership, regulatory/compliance.
- INTRO (Intro/process-based entrepreneurship): entrepreneurial mindset/identity/approach, opportunity identification/evaluation, customer discovery/interviews, lean startup, business model canvas, unit economics, MVP, pitch/pitch deck, coaching, demo day, business concept, startup/venturing, from lab to market, commercialization, social/sustainable entrepreneurship, startup ecosystem, founders, funding.

OUTPUT FORMAT (JSON only; no extra text)
{{
  "entre_score": <0-100 integer>,
  "labels": {{
    "PD": <0-100 integer>,
    "PB": <0-100 integer>,
    "VB-MKT": <0-100 integer>,
    "VB-FIN": <0-100 integer>,
    "VB-STRAT": <0-100 integer>,
    "VB-OPS": <0-100 integer>,
    "VB-IP": <0-100 integer>,
    "INTRO": <0-100 integer>
  }},
  "evidence": {{
    "PD": ["..."],
    "PB": ["..."],
    "VB-MKT": ["..."],
    "VB-FIN": ["..."],
    "VB-STRAT": ["..."],
    "VB-OPS": ["..."],
    "VB-IP": ["..."],
    "INTRO": ["..."]
  }}
}}

RULES
- Analyze only the provided course text; do not use outside knowledge.
- If a label is not supported, set its score to 0 and leave its evidence as an empty list.
- Keep evidence snippets short and verbatim; do not add commentary.
- Return valid JSON and nothing else.

COURSE DESCRIPTION:
<<<{course_description}>>>

"""


_CACHE_LOCK = threading.Lock()


def _norm_text(s: str) -> str:
    return (s or "").strip()


def _load_cache(path: Path) -> Dict[str, Dict[str, object]]:
    if not path.exists():
        return {}
    cache: Dict[str, Dict[str, object]] = {}
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    k = obj.get("k")
                    v = obj.get("v")
                    if k and isinstance(v, dict):
                        cache[k] = v
                except Exception:
                    continue
    except Exception:
        return {}
    return cache


def _append_cache(path: Path, key: str, val: Dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with _CACHE_LOCK:
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"k": key, "v": val}, ensure_ascii=False) + "\n")


def _make_cache_key(
    model: str,
    system_prompt: str,
    course_description: str,
    course_title: str,
    section: str,
    keyword_matches: Iterable[str],
) -> str:
    """Hash the full prompt state so identical calls are reused.

    This is sensitive to the course content, any metadata injected
    into the prompt, the system prompt, and the model name.
    """
    # Build the exact user prompt that we pass into Ollama.
    prompt = build_prompt(
        course_description,
        course_title,
        section,
        keyword_matches,
    )
    pieces = [
        (model or "").strip(),
        _norm_text(system_prompt),
        _norm_text(prompt),
    ]
    return hashlib.sha256("\n".join(pieces).encode("utf-8")).hexdigest()


def extract_title_keywords(title: str) -> Iterable[str]:
    norm_title = (title or "").lower()
    matches = []
    for kw in TITLE_KEYWORDS:
        if kw in norm_title:
            matches.append(kw)
    return matches


def build_prompt(
    course_description: str,
    course_title: str,
    section: str,
    keyword_matches: Iterable[str],
) -> str:
    meta_lines = []
    course_title = (course_title or "").strip()
    section = (section or "").strip()
    keyword_matches = list(keyword_matches)

    if course_title:
        meta_lines.append(f"COURSE TITLE: {course_title}")
    if section:
        meta_lines.append(f"SECTION: {section}")
    if keyword_matches:
        joined = ", ".join(sorted(set(keyword_matches)))
        meta_lines.append(
            "TITLE KEYWORD SIGNALS: "
            f"{joined}. Treat this as supporting evidence that the course may relate to entrepreneurship."
        )
    if section == "MTE":
        meta_lines.append(
            "SECTION BONUS: This course is in section MTE; lean towards entrepreneurship relevance if the description allows."
        )

    meta_block = "\n".join(meta_lines) if meta_lines else "COURSE TITLE: (not provided)"

    return PROMPT_TEMPLATE.format(
        course_description=(course_description or "").strip(),
        meta_block=meta_block,
    )


def pre_edit(text: str) -> str:
    return text.strip()


def ask(
    model: str,
    course_description: str,
    course_title: str,
    section: str,
    keyword_matches: Iterable[str],
    system: Optional[str] = None,
    keep_alive: str = "5m",
) -> str:
    """Send the course description to Ollama and return the raw JSON response text."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append(
        {
            "role": "user",
            "content": pre_edit(
                build_prompt(
                    course_description,
                    course_title,
                    section,
                    keyword_matches,
                )
            ),
        }
    )

    response = ollama.chat(model=model, messages=messages, keep_alive=keep_alive)
    content = response.get("message", {}).get("content")
    if not content:
        raise ValueError("Model returned an empty response")
    return content


def read_courses(path: Path) -> Iterable[Dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Missing input CSV: {path}")
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row


def format_evidence(evidence: Dict[str, Iterable[str]]) -> str:
    """Serialize the evidence dict as a compact JSON string for CSV storage."""
    return json.dumps(evidence, ensure_ascii=False)


def classify_course(
    course: Dict[str, str],
    cache: Optional[Dict[str, Dict[str, object]]] = None,
    cache_path: Optional[Path] = None,
) -> Dict[str, object]:
    description = course.get("description") or ""
    course_title = course.get("course_name") or ""
    section = course.get("section") or ""
    keyword_matches = list(extract_title_keywords(course_title))

    # Reuse previous Ollama results when the content, prompt and model match.
    cache_key = _make_cache_key(
        MODEL,
        SYSTEM_PROMPT,
        description,
        course_title,
        section,
        keyword_matches,
    )
    if cache is not None and cache_key in cache:
        return dict(cache[cache_key])

    response_text = ask(
        MODEL,
        description,
        course_title,
        section,
        keyword_matches,
        SYSTEM_PROMPT,
    )
    try:
        payload = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model returned invalid JSON: {exc}\n{response_text}") from exc

    labels = payload.get("labels") or {}
    evidence = payload.get("evidence") or {}

    result: Dict[str, object] = {
        "entre_score": payload.get("entre_score", 0),
        "PD": labels.get("PD", 0),
        "PB": labels.get("PB", 0),
        "VB-MKT": labels.get("VB-MKT", 0),
        "VB-FIN": labels.get("VB-FIN", 0),
        # Store the VB-STRAT score under the VB-START column requested by the user.
        "VB-START": labels.get("VB-STRAT", 0),
        "VB-OPS": labels.get("VB-OPS", 0),
        "VB-IP": labels.get("VB-IP", 0),
        "INTRO": labels.get("INTRO", 0),
        "evidence": format_evidence(evidence),
    }

    if keyword_matches:
        entre_score = int(result.get("entre_score", 0) or 0)
        result["entre_score"] = min(100, entre_score + 10)

    if section == "MTE":
        entre_score = int(result.get("entre_score", 0) or 0)
        result["entre_score"] = min(100, entre_score + 5)

    if cache is not None and cache_path is not None:
        cache[cache_key] = result
        _append_cache(cache_path, cache_key, result)

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Run entrepreneurship classification across coursebook data.")
    parser.add_argument(
        "--start-line",
        type=int,
        default=1,
        help="1-based line number in coursebook_courses.csv to start from. "
        "Defaults to 1 and truncates the output CSV. When >1, the script appends to the existing CSV.",
    )
    args = parser.parse_args()
    start_line = max(1, args.start_line)

    courses = list(read_courses(INPUT_CSV))
    if not courses:
        print(f"No courses found in {INPUT_CSV}", file=sys.stderr)
        sys.exit(1)

    fieldnames = [
        "course_key",
        "entre_score",
        "PD",
        "PB",
        "VB-MKT",
        "VB-FIN",
        "VB-START",
        "VB-OPS",
        "VB-IP",
        "INTRO",
        "evidence",
    ]

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    output_mode = "w" if start_line == 1 else "a"

    if start_line == 1 and OUTPUT_CSV.exists():
        OUTPUT_CSV.unlink()

    should_write_header = start_line == 1 or not OUTPUT_CSV.exists()
    cache = _load_cache(COURSEBOOK_CACHE)

    with OUTPUT_CSV.open(output_mode, encoding="utf-8", newline="") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        if should_write_header:
            writer.writeheader()
            f_out.flush()

        for idx, course in enumerate(courses, start=1):
            if idx < start_line:
                continue
            description = course.get("description", "")
            course_key = course.get("course_key", f"row-{idx}")

            print(f"[{idx}/{len(courses)}] Classifying {course_key}...", flush=True)

            if not (description or "").strip():
                writer.writerow(
                    {
                        "course_key": course_key,
                        "entre_score": "",
                        "PD": "",
                        "PB": "",
                        "VB-MKT": "",
                        "VB-FIN": "",
                        "VB-START": "",
                        "VB-OPS": "",
                        "VB-IP": "",
                        "INTRO": "",
                        "evidence": "",
                    }
                )
                f_out.flush()
                continue

            try:
                result = classify_course(course, cache=cache, cache_path=COURSEBOOK_CACHE)
            except Exception as exc:  # pragma: no cover - defensive logging
                print(f"[warn] Failed to classify {course_key}: {exc}", file=sys.stderr)
                continue

            writer.writerow(
                {
                    "course_key": course_key,
                    **result,
                }
            )
            f_out.flush()

            # Polite pause to avoid overwhelming the local Ollama server.
            time.sleep(0.2)


if __name__ == "__main__":
    main()

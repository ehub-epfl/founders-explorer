#!/usr/bin/env python3
"""Fetch detailed coursebook entries and export course/program metadata to CSV."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Sequence
from urllib.parse import urljoin

import requests
from lxml import html as lh

COURSEBOOK_JSON = Path(__file__).with_name("data").joinpath("coursebook_url.json")
COURSES_CSV = Path(__file__).with_name("data").joinpath("coursebook_courses.csv")
PROGRAMS_CSV = Path(__file__).with_name("data").joinpath("coursebook_programs.csv")

REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

SECTION_RE = re.compile(r"Section\s+([A-Z0-9]+)", re.IGNORECASE)
COURSE_ID_RE = re.compile(r"^\s*([^/\s][^/]*)\s*/")
YEAR_RANGE_RE = re.compile(r"\b\d{4}\s*-\s*\d{4}\b")
SCHEDULE_LINE_RE = re.compile(
    r"^(?P<day>[A-Za-zÀ-ÿ]+),\s*(?P<start>\d{1,2})h\s*-\s*(?P<end>\d{1,2})h:\s*(?P<rest>.+)$",
    re.IGNORECASE,
)
CREDITS_PATTERNS = (
    re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:credits?|crédits?|ects?)", re.IGNORECASE),
    re.compile(r"coefficient\s*/?\s*(?:credits?|crédits?)\s*(\d+(?:[.,]\d+)?)", re.IGNORECASE),
    re.compile(r"coefficient\s*(\d+(?:[.,]\d+)?)", re.IGNORECASE),
)
WORKLOAD_WEEK_KEYWORDS = (
    "per week",
    "per-week",
    "weekly",
    "hebdo",
    "hebdomadaire",
    "hebdom.",
    "hebdom",
    "par semaine",
)
SEMESTER_WEEKS = 14


def load_program_urls() -> List[str]:
    """Load the program URLs from the JSON file."""
    if not COURSEBOOK_JSON.exists():
        print(f"[error] Missing {COURSEBOOK_JSON}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(COURSEBOOK_JSON.read_text(encoding="utf-8"))
    urls: List[str] = []
    for entry in data:
        href = entry.get("href")
        if href:
            urls.append(str(href))
    return urls


def fetch_html(url: str) -> str:
    """Fetch the raw HTML for a given URL."""
    try:
        resp = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
        resp.raise_for_status()
        return resp.text or ""
    except Exception as exc:  # pragma: no cover
        print(f"[warn] Failed to fetch {url}: {exc}", file=sys.stderr)
        return ""


def parse_course_entries(base_url: str, html_text: str) -> Iterable[Dict[str, str]]:
    """Parse the accordion course listings from the page HTML."""
    if not html_text.strip():
        return []

    tree = lh.fromstring(html_text)
    entries: List[Dict[str, str]] = []

    course_nodes = tree.xpath('//div[contains(@class, "line")]//div[contains(@class, "cours") and @data-title]')
    if not course_nodes:
        # Fallback: look for cours-name anchors directly.
        course_nodes = tree.xpath('//div[contains(@class, "cours-name")]/a/..')

    for node in course_nodes:
        anchor = node.xpath('.//div[contains(@class, "cours-name")]/a')
        if not anchor:
            continue
        anchor = anchor[0]
        href = anchor.get("href") or ""
        href = href.strip()
        if not href:
            continue
        course_url = urljoin(base_url, href)

        cours_info_node = node.xpath('.//div[contains(@class, "cours-info")]')
        course_id = ""
        section = ""
        if cours_info_node:
            info_text = cours_info_node[0].text_content().strip()
            if info_text:
                match_id = COURSE_ID_RE.match(info_text)
                if match_id:
                    course_id = normalize_ws(match_id.group(1))
                match = SECTION_RE.search(info_text)
                if match:
                    section = match.group(1).upper()

        if not course_id:
            # Skip entries that do not expose a course identifier in the listing.
            continue

        entries.append(
            {
                "course_id": course_id,
                "section": section,
                "course_url": course_url,
            }
        )

    return entries


def dedupe(entries: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    """Remove duplicates by course_url while preserving order."""
    seen = set()
    unique: List[Dict[str, str]] = []
    for entry in entries:
        url = entry.get("course_url")
        if not url or url in seen:
            continue
        seen.add(url)
        unique.append(entry)
    return unique


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def make_course_key(course_id: str, course_url: str) -> str:
    course_id = (course_id or "").strip()
    if course_id:
        return course_id
    digest = hashlib.sha1(course_url.encode("utf-8")).hexdigest()
    return f"course-{digest[:12]}"


_BASE_SITE = "https://edu.epfl.ch/"


def extract_teachers(tree) -> List[Dict[str, str]]:
    teachers: List[Dict[str, str]] = []

    def append_teacher(name: str, url: str = "") -> None:
        name_norm = normalize_ws(name)
        url_norm = normalize_ws(url)
        if not name_norm:
            return
        entry = {"name": name_norm}
        if url_norm:
            entry["url"] = urljoin(_BASE_SITE, url_norm)
        if entry not in teachers:
            teachers.append(entry)

    for node in tree.xpath('//p[strong[contains(normalize-space(.), "Teacher")]]'):
        anchors = node.xpath('.//a')
        if anchors:
            for anchor in anchors:
                name = anchor.text_content()
                href = anchor.get("href", "")
                append_teacher(name, href)
        else:
            raw = node.text_content().replace("Teacher:", "")
            append_teacher(raw)
    return teachers


def _parse_float_token(token: str) -> float | None:
    try:
        return float(token.replace(",", "."))
    except (AttributeError, ValueError):
        return None


def _text_contains_per_week(text_lc: str) -> bool:
    if any(keyword in text_lc for keyword in WORKLOAD_WEEK_KEYWORDS):
        return True
    semester_weeks_str = str(SEMESTER_WEEKS)
    if "x" in text_lc and semester_weeks_str in text_lc and ("week" in text_lc or "semaine" in text_lc):
        return True
    return False


def extract_workload(detail) -> float | None:
    # Only consider the primary information list inside this program block.
    info_list = None
    direct_list = detail.xpath('./ul[contains(@class, "list-bullet")]')
    if direct_list:
        info_list = direct_list[0]
    else:
        nested_list = detail.xpath('.//ul[contains(@class, "list-bullet")]')
        if nested_list:
            info_list = nested_list[0]
    if info_list is None:
        return None

    total = 0.0
    found = False
    for li in info_list.xpath("./li"):
        text = normalize_ws(li.text_content())
        if not text:
            continue
        text_lc = text.lower()

        # Determine if the line expresses a weekly pattern ("per week", "x 14 weeks", etc.)
        per_week = _text_contains_per_week(text_lc)

        # Prefer numbers that explicitly refer to hours
        hours_match = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:hour|heure)(?:\(s\)|s)?", text_lc)

        value = None
        if hours_match:
            value = _parse_float_token(hours_match.group(1))
        else:
            # Only allow generic numbers when a weekly pattern is clearly present
            if per_week:
                generic_match = re.search(r"(\d+(?:[.,]\d+)?)", text_lc)
                if generic_match:
                    value = _parse_float_token(generic_match.group(1))

        # Skip lines that don't provide a valid workload number (e.g., "Number of places: 216")
        if value is None:
            continue

        if per_week:
            total += value
        else:
            total += value / SEMESTER_WEEKS

        found = True
    if not found:
        return None
    return round(total, 2)


def extract_language(tree) -> str:
    for node in tree.xpath('//p[strong[contains(normalize-space(.), "Language")]]'):
        text = node.text_content()
        text = text.replace("Language:", "")
        cleaned = normalize_ws(text)
        if cleaned:
            return cleaned
    return ""


def _format_hour(hour: str) -> str:
    try:
        value = int(hour)
    except (TypeError, ValueError):
        return normalize_ws(str(hour))
    return f"{value:02d}:00"


def extract_schedule(tree) -> str:
    container = tree.xpath('//div[contains(@class, "course-schedule")]')
    if not container:
        return ""
    schedule_nodes = container[0].xpath('.//div[contains(@class, "coursebook-week-caption") and contains(@class, "sr-only")]//p')
    entries: List[str] = []
    for node in schedule_nodes:
        text = normalize_ws(node.text_content().replace("\xa0", " "))
        if not text:
            continue
        match = SCHEDULE_LINE_RE.match(text)
        if not match:
            entries.append(text)
            continue
        day = normalize_ws(match.group("day"))
        start = _format_hour(match.group("start"))
        end = _format_hour(match.group("end"))
        raw_detail = normalize_ws(match.group("rest"))
        rest = raw_detail
        locations = [
            normalize_ws(loc)
            for loc in node.xpath('.//a/text()')
            if normalize_ws(loc)
        ]
        for loc in locations:
            rest = normalize_ws(rest.replace(loc, ""))
        detail = normalize_ws(rest.rstrip(",")) or raw_detail
        entry = f"{day} {start}–{end}: {detail}"
        entries.append(entry)
    return "\n".join(entries)


def extract_credits(tree) -> str:
    summary_nodes = tree.xpath('//div[contains(@class, "course-summary")]//p')
    for node in summary_nodes:
        text = normalize_ws(node.text_content())
        if not text:
            continue
        for pattern in CREDITS_PATTERNS:
            match = pattern.search(text)
            if match:
                raw = match.group(1).replace(",", ".")
                try:
                    numeric = float(raw)
                    if numeric.is_integer():
                        return str(int(numeric))
                    return str(numeric)
                except ValueError:
                    return raw
    return ""


def extract_section_text(tree, headings: Sequence[str] | str) -> str:
    if isinstance(headings, str):
        candidates = [headings]
    else:
        candidates = list(headings)
    node = None
    for heading in candidates:
        xpath_expr = f'//div[h2[contains(@class, "h5") and normalize-space()="{heading}"]]'
        section_nodes = tree.xpath(xpath_expr)
        if section_nodes:
            node = section_nodes[0]
            break
    if node is None:
        return ""
    parts: List[str] = []
    for txt in node.xpath('text()'):
        cleaned = normalize_ws(txt)
        if cleaned:
            parts.append(cleaned)
    for child in node.xpath('./*[not(self::h2) and local-name()!="button"]'):
        text = normalize_ws(child.text_content())
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def extract_keywords(tree) -> str:
    node = None
    for heading in ("Keywords", "Mots-clés"):
        xpath_expr = f'//div[h2[contains(@class, "h5") and normalize-space()="{heading}"]]'
        section_nodes = tree.xpath(xpath_expr)
        if section_nodes:
            node = section_nodes[0]
            break
    if node is None:
        return ""
    keywords: List[str] = []
    for text_node in node.xpath('.//text()'):
        cleaned = normalize_ws(text_node)
        if not cleaned:
            continue
        if cleaned.lower() in {"keywords", "mots-clés"}:
            continue
        if cleaned not in keywords:
            keywords.append(cleaned)
    return "; ".join(keywords)


def parse_program_sections(tree, course_key: str) -> List[Dict[str, str]]:
    container = tree.xpath('//div[contains(@class, "study-plans")]')
    if not container:
        return []
    programs: List[Dict[str, str]] = []
    for button in container[0].xpath('.//button[contains(@class, "collapse-title")]'):
        raw_texts = [normalize_ws(t) for t in button.xpath('./text()') if normalize_ws(t)]
        program_name = raw_texts[0] if raw_texts else normalize_ws(button.xpath('string()'))

        semester_label = ""
        span_texts = [normalize_ws(t) for t in button.xpath('.//span/text()') if normalize_ws(t)]
        if span_texts:
            semester_label = span_texts[0]

        combined_label_parts = []
        if program_name:
            combined_label_parts.append(program_name)
        if semester_label:
            combined_label_parts.append(semester_label)
        combined_label = normalize_ws(" ".join(combined_label_parts))
        if combined_label:
            year_match = YEAR_RANGE_RE.search(combined_label)
            if year_match:
                prefix = normalize_ws(combined_label[: year_match.start()])
                suffix = normalize_ws(combined_label[year_match.end() :])
                if prefix:
                    program_name = prefix
                if suffix:
                    semester_label = suffix

        if normalize_ws(program_name).lower() == "edoc general and external courses":
            semester_label = "Doctoral School"

        program_code = normalize_ws(button.get("data-target", "")).lstrip("#")
        detail = None
        if program_code:
            detail_nodes = container[0].xpath(f'.//div[@id="{program_code}"]')
            detail = detail_nodes[0] if detail_nodes else None
        exam_form = ""
        course_type = ""
        semester_term = ""
        workload_value = None
        if detail is not None:
            workload_value = extract_workload(detail)
            for li in detail.xpath(".//li"):
                label_nodes = li.xpath("./strong/text()")
                if not label_nodes:
                    continue
                label = normalize_ws(label_nodes[0]).rstrip(":")
                value = normalize_ws(li.text_content().replace(label_nodes[0], "", 1).replace(":", "", 1))
                label_lc = label.lower()
                if label_lc in {"exam form", "forme d'examen"}:
                    exam_form = value
                elif label_lc == "type":
                    course_type = value
                elif label_lc in {"semester", "semestre"}:
                    semester_term = value
        programs.append(
            {
                "course_key": course_key,
                "program_name": program_name,
                "level": semester_label,
                "semester": semester_term,
                "exam_form": exam_form,
                "type": course_type,
                "workload": workload_value,
            }
        )
    return programs


def parse_course_detail(course: Dict[str, str], html_text: str) -> Dict[str, str]:
    if not html_text.strip():
        return {
            "teacher": [],
            "language": "",
            "description": "",
            "programs": [],
            "course_name": "",
        }
    tree = lh.fromstring(html_text)
    teacher = extract_teachers(tree)
    language = extract_language(tree)
    schedule = extract_schedule(tree)
    credits = extract_credits(tree)
    summary = extract_section_text(tree, ("Summary", "Résumé"))
    content = extract_section_text(tree, ("Content", "Contenu"))
    description_parts = [part for part in (summary, content) if part]
    description = "\n\n".join(description_parts)
    keywords = extract_keywords(tree)
    course_name_nodes = tree.xpath('//main[@id="main"]//header//h1/text()')
    course_name = ""
    if course_name_nodes:
        course_name = normalize_ws(course_name_nodes[0])
    course_key = make_course_key(course.get("course_id", ""), course.get("course_url", ""))
    programs = parse_program_sections(tree, course_key)
    return {
        "teacher": teacher,
        "language": language,
        "schedule": schedule,
        "description": description,
        "keywords": keywords,
        "credits": credits,
        "programs": programs,
        "course_name": course_name,
    }


def write_courses_csv(entries: Iterable[Dict[str, str]]) -> None:
    COURSES_CSV.parent.mkdir(parents=True, exist_ok=True)
    rows = [entry for entry in entries]
    with COURSES_CSV.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "course_key",
                "course_name",
                "section",
                "course_url",
                "teacher",
                "language",
                "credits",
                "workload",
                "semester",
                "type",
                "schedule",
                "description",
                "keywords",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"[ok] Wrote {len(rows)} courses to {COURSES_CSV}")


_BACHELOR_SEM_RE = re.compile(r"bachelor\s+semester\s*(\d+)", re.IGNORECASE)
_MASTER_SEM_RE = re.compile(r"master\s+semester\s*(\d+)", re.IGNORECASE)


def simplify_semester(label: str) -> str:
    label = normalize_ws(label)
    if not label:
        return ""
    if label.lower().startswith("2025-2026"):
        label = normalize_ws(label[len("2025-2026"):])
    match = _BACHELOR_SEM_RE.search(label)
    if match:
        num = match.group(1)
        return f"BA{num}" if num else "BA"
    match = _MASTER_SEM_RE.search(label)
    if match:
        num = match.group(1)
        return f"MA{num}" if num else "MA"
    return label


_PAREN_CONTENT = re.compile(r"\s*\([^)]*\)")


def normalize_semester_term(label: str) -> str:
    label = normalize_ws(label)
    if not label:
        return ""
    lower = label.lower()
    mapping = {
        "fall": "Fall",
        "autumn": "Fall",
        "automne": "Fall",
        "spring": "Spring",
        "printemps": "Spring",
        "winter": "Winter",
        "hiver": "Winter",
        "summer": "Summer",
        "été": "Summer",
        "ete": "Summer",
    }
    for key, value in mapping.items():
        if lower == key:
            return value
    # handle phrases like "Fall semester"
    for key, value in mapping.items():
        if key in lower:
            return value
    return label


def clean_exam_form(label: str) -> str:
    label = normalize_ws(label)
    if not label:
        return ""
    label = _PAREN_CONTENT.sub("", label)
    return normalize_ws(label)


def format_workload_value(value: float | None) -> str:
    if value is None:
        return ""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return ""
    return f"{numeric:.2f}".rstrip("0").rstrip(".")


def write_programs_csv(entries: Iterable[Dict[str, str]], valid_keys: Iterable[str]) -> None:
    COURSES_CSV.parent.mkdir(parents=True, exist_ok=True)
    keep = {key for key in valid_keys}
    rows = [entry for entry in entries if entry.get("course_key") in keep]
    for row in rows:
        row["level"] = simplify_semester(row.get("level", ""))
        row["semester"] = normalize_semester_term(row.get("semester", ""))
        row["exam_form"] = clean_exam_form(row.get("exam_form", ""))
        row["workload"] = format_workload_value(row.get("workload"))
    with PROGRAMS_CSV.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "course_key",
                "program_name",
                "level",
                "semester",
                "exam_form",
                "type",
                "workload",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"[ok] Wrote {len(rows)} program entries to {PROGRAMS_CSV}")


def main() -> None:
    program_urls = load_program_urls()
    if not program_urls:
        print("[warn] No program URLs found to crawl", file=sys.stderr)
        return

    collected: List[Dict[str, str]] = []
    for idx, url in enumerate(program_urls, start=1):
        print(f"[info] Fetching program ({idx}/{len(program_urls)}): {url}")
        html_text = fetch_html(url)
        courses = list(parse_course_entries(url, html_text))
        print(f"[info] Found {len(courses)} courses in {url}")
        collected.extend(courses)

    unique_courses = dedupe(collected)

    enriched_courses: List[Dict[str, str]] = []
    program_rows: List[Dict[str, str]] = []
    seen_course_keys: set[str] = set()
    for idx, course in enumerate(unique_courses, start=1):
        course_key = make_course_key(course.get("course_id", ""), course.get("course_url", ""))
        if course_key in seen_course_keys:
            print(f"[info] Skipping duplicate course_key {course_key}")
            continue
        seen_course_keys.add(course_key)
        print(f"[info] Fetching course ({idx}/{len(unique_courses)}): {course.get('course_url')}")
        detail_html = fetch_html(course.get("course_url", ""))
        detail_info = parse_course_detail(course, detail_html)
        program_entries = detail_info.get("programs", [])
        semester_values = {
            normalize_semester_term(p.get("semester", ""))
            for p in program_entries
            if normalize_semester_term(p.get("semester", ""))
        }
        course_semester = semester_values.pop() if len(semester_values) == 1 else ""

        type_values = {
            normalize_ws(p.get("type", "")).lower()
            for p in program_entries
            if normalize_ws(p.get("type", ""))
        }
        course_type = type_values.pop() if len(type_values) == 1 else ""
        if course_type:
            course_type = course_type.capitalize()

        program_workloads = [program.get("workload") for program in program_entries]
        all_programs_have_workload = bool(program_entries) and all(
            value is not None for value in program_workloads
        )
        normalized_workloads = {
            round(float(value), 2) for value in program_workloads if value is not None
        }
        course_workload = ""
        if all_programs_have_workload and len(normalized_workloads) == 1:
            course_workload = format_workload_value(normalized_workloads.pop())

        course_row = {
            "course_key": course_key,
            "course_name": detail_info.get("course_name", ""),
            "section": normalize_ws(course.get("section", "")),
            "course_url": course.get("course_url", ""),
            "teacher": json.dumps(detail_info.get("teacher", []), ensure_ascii=False),
            "language": detail_info.get("language", ""),
            "credits": detail_info.get("credits", ""),
            "workload": course_workload,
            "semester": course_semester,
            "type": course_type,
            "schedule": detail_info.get("schedule", ""),
            "description": detail_info.get("description", ""),
            "keywords": detail_info.get("keywords", ""),
        }
        if course_row["course_key"]:
            enriched_courses.append(course_row)
            for program in detail_info.get("programs", []):
                program_rows.append(program)

    write_courses_csv(enriched_courses)
    write_programs_csv(program_rows, [c["course_key"] for c in enriched_courses])


if __name__ == "__main__":
    main()

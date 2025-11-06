#!/usr/bin/env python3
"""Extract EPFL people directory profile stubs from coursebook_courses.

Reads the `coursebook_courses.csv` produced by `fetch_coursebook_courses.py`,
parses the `teacher` JSON field, deduplicates teachers across courses, and
emits a CSV with columns:

  name, card_url, email, title, lab_url, introduction_snippet, photo_url

Parses each teacher's `card_url` page to extract fields.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from requests.adapters import HTTPAdapter, Retry
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin


DATA_DIR = Path(__file__).with_name("data")
DEFAULT_INPUT = DATA_DIR / "coursebook_courses.csv"
DEFAULT_OUTPUT = DATA_DIR / "people_profiles.csv"


@dataclass(frozen=True)
class TeacherCard:
    name: str
    card_url: str


def _log(msg: str) -> None:
    print(f"[people] {msg}")


REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

BASE_PEOPLE = "https://people.epfl.ch"

# Reuse a single HTTP session (much faster than creating a connection per request)
_session: Optional[requests.Session] = None

def _get_session() -> requests.Session:
    global _session
    if _session is None:
        s = requests.Session()
        # Robust retries for transient network issues
        retries = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET",),
        )
        adapter = HTTPAdapter(pool_connections=20, pool_maxsize=20, max_retries=retries)
        s.mount("http://", adapter)
        s.mount("https://", adapter)
        s.headers.update(REQUEST_HEADERS)
        _session = s
    return _session


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def _text_of(el) -> str:
    return _clean_text(el.get_text(separator=" ", strip=True)) if el else ""


from bs4 import FeatureNotFound as _BSFeatureNotFound  # type: ignore

def _make_soup(html_text: str) -> BeautifulSoup:
    try:
        return BeautifulSoup(html_text, "lxml")
    except Exception:
        try:
            # fall back to built-in parser
            return BeautifulSoup(html_text, "html.parser")
        except Exception:
            # last resort: empty soup
            return BeautifulSoup("", "html.parser")

# Note: using lxml parser when available makes BeautifulSoup parsing 2-5x faster on large pages.
def parse_epfl_profile(html_text: str):
    soup = _make_soup(html_text)

    # Noise removal
    for t in soup(["script", "style", "noscript"]):
        t.decompose()

    # ========== email ==========
    email = None
    a_mail = soup.select_one("a[href^='mailto:']")
    if a_mail and a_mail.get("href"):
        email = a_mail["href"].split("mailto:", 1)[-1].strip()

    # ========== title ==========
    # Support both .collapse-title and .collapse-title-desktop; also fallback if not under .people-contacts
    btn = (
        soup.select_one(".people-contacts button.collapse-title")
        or soup.select_one(".people-contacts button.collapse-title-desktop")
        or soup.select_one("button.collapse-title, button.collapse-title-desktop")
    )
    if btn:
        # Use <strong> as the role/title
        strong_el = btn.find("strong")
        strong_txt = _text_of(strong_el)

        # Collect span.font-weight-normal within the button, especially those appearing after <strong>
        labels = []
        if strong_el is not None:
            for sib in strong_el.next_siblings:
                # Skip commas and whitespace text nodes
                if getattr(sib, "name", None) == "span" and "font-weight-normal" in (sib.get("class") or []):
                    txt = _text_of(sib)
                    if txt:
                        labels.append(txt)
        # If not found among siblings, fallback: search all spans within the button
        if not labels:
            for sp in btn.find_all("span", class_="font-weight-normal"):
                txt = _text_of(sp)
                if txt:
                    labels.append(txt)
        # Deduplicate and join (comma-separated) to get lab/affiliation text
        if labels:
            # Preserve order while deduplicating
            seen_labels = set()
            uniq_labels = []
            for x in labels:
                if x not in seen_labels:
                    seen_labels.add(x)
                    uniq_labels.append(x)
            lab_txt = ", ".join(uniq_labels)
        else:
            lab_txt = None

        if strong_txt and lab_txt:
            title = f"{strong_txt}, {lab_txt}".strip()
        else:
            # If either part is missing, keep whichever structured field exists; do not use entire button text
            title = strong_txt or lab_txt or None
    # Fallback near h1 (do not use og:title/twitter:title)
    if not title:
        h1 = soup.select_one(".people-contacts h1, h1")
        if h1:
            sib_title = h1.find_next("p", class_="title")
            if sib_title:
                strong = sib_title.find("strong")
                title = _text_of(strong or sib_title)
    # If the extracted value equals the person's name, discard and continue fallback
    person_name = _text_of(soup.select_one(".people-contacts h1, h1"))
    if title and person_name and title.strip() == person_name.strip():
        title = None

    # Do not use meta og:title or twitter:title as title source

    # Final fallback: structured tag itemprop="fonction"
    if not title:
        func = soup.select_one("[itemprop='fonction']")
        if func:
            title = _text_of(func)

    # ========== lab_url ==========
    def _is_good_lab(href: str) -> bool:
        return bool(href and href.startswith("http") and "search.epfl.ch" not in href)

    lab_url = None

    # 0) First check external links in #contact (common on newer pages)
    for a in soup.select("#contact a[href]"):
        href = a.get("href", "")
        if _is_good_lab(href):
            lab_url = href.strip()
            break

    # 1) Lines labeled "Website:" / "Web site:" (including inside collapses)
    if not lab_url:
        for p in soup.find_all("p", class_="small"):
            label = p.find("span", class_="sr-only")
            if label and "Website" in label.get_text():
                a = p.find("a", href=True)
                if a and _is_good_lab(a["href"]):
                    lab_url = a["href"].strip()
                    break
        if not lab_url:
            for p in soup.find_all("p"):
                txt = p.get_text(" ", strip=True).lower()
                if "website:" in txt or "web site:" in txt:
                    a = p.find("a", href=True)
                    if a and _is_good_lab(a["href"]):
                        lab_url = a["href"].strip()
                        break

    # 2) Fallback: any likely lab/project site links
    if not lab_url:
        for a in soup.select("a[href]"):
            href = a.get("href", "")
            if any(k in href for k in ("labs.epfl.ch", "/labs/", "group", "lab")) and _is_good_lab(href):
                lab_url = href.strip()
                break

    # ========== introduction_snippet ==========
    # Goal: all body text after the card (.row.people-basic-info)
    parts = []

    footer = soup.find(id="footer")

    # A) If a tabs container exists, use the full text of .tabs-contents (cleanest)
    tabs_contents = soup.select_one(".tabs-container .tabs-contents")
    if tabs_contents:
        parts.append(_text_of(tabs_contents))

    # B) Also keep generic "after the card" collection to avoid missing special pages
    if not parts:
        row = soup.select_one(".row.people-basic-info")
        if row:
            for sib in row.next_siblings:
                # Stop when reaching the footer
                if getattr(sib, "get", None) and footer and sib is footer:
                    break
                name = getattr(sib, "name", None)
                if not name:
                    continue
                # Collect only block-level containers; skip obvious non-body regions
                if name in ("div", "section", "article"):
                    # Prefer child .tabs-contents when present
                    tc = getattr(sib, "select_one", lambda *_: None)(".tabs-contents") if hasattr(sib, "select_one") else None
                    if tc:
                        parts.append(_text_of(tc))
                    else:
                        parts.append(_text_of(sib))

    # C) Fallback (very old pages): collect .people-contents that appear after the card container
    if not parts:
        card = soup.select_one(".people-contacts")
        pcs = soup.select(".people-contents")
        if pcs:
            started = (card is None)
            for pc in pcs:
                if not started:
                    # Start recording once content appears after the card
                    if pc.find_previous(class_="people-contacts") is not None:
                        started = True
                if started:
                    parts.append(_text_of(pc))

    # D) Deduplicate / drop very short entries / merge
    cleaned, seen = [], set()
    for t in parts:
        t = _clean_text(t)
        if len(t) < 20:
            continue
        if t in seen:
            continue
        seen.add(t)
        cleaned.append(t)
    introduction_snippet = _clean_text(" ".join(cleaned))

    # ========== photo_url ==========
    def _abs_url(href: Optional[str]) -> Optional[str]:
        if not href:
            return None
        href = href.strip()
        if not href:
            return None
        if href.startswith("//"):
            return "https:" + href
        if href.startswith("/"):
            return urljoin(BASE_PEOPLE, href)
        return href

    photo_url = None
    og_img = soup.select_one("meta[property='og:image']")
    if og_img and og_img.get("content"):
        photo_url = _abs_url(og_img.get("content"))
    if not photo_url:
        tw_img = soup.select_one("meta[name='twitter:image']")
        if tw_img and tw_img.get("content"):
            photo_url = _abs_url(tw_img.get("content"))

    # Filter out non-person images such as EPFL logos
    if photo_url and "epfl-logo" in photo_url.lower():
        photo_url = None

    return {
        "email": email,
        "title": title,
        "lab_url": lab_url,
        "introduction_snippet": introduction_snippet,
        "photo_url": photo_url or "",
    }


def fetch_html(url: str, timeout: int = 12) -> str:
    try:
        s = _get_session()
        resp = s.get(url, timeout=timeout)
        resp.raise_for_status()
        # Some EPFL pages vary by language; force EN if not specified to reduce redirects
        return resp.text or ""
    except Exception as exc:  # pragma: no cover
        _log(f"fetch failed for {url}: {exc}")
        return ""


# Helper to fetch and parse a single profile (for concurrent use)
def _fetch_and_parse(card: TeacherCard) -> Tuple[TeacherCard, Dict[str, str]]:
    data: Dict[str, str] = {"email": "", "title": "", "lab_url": "", "introduction_snippet": "", "photo_url": ""}
    if card.card_url and card.card_url.startswith("http"):
        html = fetch_html(card.card_url)
        if html:
            parsed = parse_epfl_profile(html)
            data["email"] = (parsed.get("email") or "").strip()
            data["title"] = (parsed.get("title") or "").strip()
            data["lab_url"] = (parsed.get("lab_url") or "").strip()
            data["introduction_snippet"] = (parsed.get("introduction_snippet") or "").strip()
            data["photo_url"] = (parsed.get("photo_url") or "").strip()
    return card, data


def load_teacher_cards(courses_csv: Path) -> List[TeacherCard]:
    """Read `teacher` JSON from the courses CSV and return teacher cards.

    - The `teacher` column contains a JSON array like:
      [{"name": "Alice", "url": "https://people.epfl.ch/123?lang=en"}, ...]
    - We normalize whitespace and default missing URL to empty string.
    """
    if not courses_csv.exists():
        print(f"[error] Input not found: {courses_csv}", file=sys.stderr)
        sys.exit(1)

    cards: List[TeacherCard] = []
    with courses_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if "teacher" not in (reader.fieldnames or []):
            print("[error] Missing 'teacher' column in input CSV", file=sys.stderr)
            sys.exit(1)
        for row in reader:
            raw = (row.get("teacher") or "").strip()
            if not raw:
                continue
            try:
                entries = json.loads(raw)
            except json.JSONDecodeError:
                # Some CSV writers double-escape quotes; try a gentle fix-up
                try:
                    entries = json.loads(raw.replace("''", '"').replace('""', '"'))
                except Exception:
                    _log("skip row with unparseable teacher JSON")
                    continue
            if not isinstance(entries, list):
                continue
            for ent in entries:
                if not isinstance(ent, dict):
                    continue
                name = str(ent.get("name", "")).strip()
                url = str(ent.get("url", "")).strip()
                if not name:
                    continue
                cards.append(TeacherCard(name=name, card_url=url))
    return cards


def dedupe_cards(cards: Iterable[TeacherCard]) -> List[TeacherCard]:
    """Dedupe by URL if present, otherwise by lowercase name."""
    seen: set[Tuple[str, str]] = set()
    unique: List[TeacherCard] = []
    for c in cards:
        key = (c.card_url.lower().strip(), c.name.lower().strip())
        # Prefer URL when available; else name is fallback.
        url_key = (key[0], "")
        name_key = ("", key[1]) if not key[0] else None
        if key[0]:
            if url_key in seen:
                continue
            seen.add(url_key)
        else:
            if name_key in seen:  # type: ignore[arg-type]
                continue
            seen.add(name_key)  # type: ignore[arg-type]
        unique.append(c)
    return unique


def _render_progress(i: int, total: int, width: int = 28) -> None:
    if total <= 0:
        return
    pct = i / total
    filled = int(width * pct)
    bar = "#" * filled + "." * (width - filled)
    sys.stdout.write(f"\r[{bar}] {i}/{total} ({pct*100:5.1f}%)")
    sys.stdout.flush()


def write_profiles_csv(cards: Iterable[TeacherCard], out_path: Path, show_progress: bool = True) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "name",
        "card_url",
        "email",
        "title",
        "lab_url",
        "introduction_snippet",
        "photo_url",
    ]
    cards_list = list(cards)
    total = len(cards_list)

    # Choose a sensible thread count: IO-bound → many threads OK, but be polite to EPFL
    max_workers = min(8, max(2, (os.cpu_count() or 4)))

    results: List[Tuple[TeacherCard, Dict[str, str]]] = []

    if total == 0:
        with out_path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fields)
            writer.writeheader()
        return

    # Warm up a single session to reuse TCP connections
    _get_session()

    if show_progress and sys.stdout.isatty():
        _render_progress(0, total)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(_fetch_and_parse, c): i for i, c in enumerate(cards_list, start=1)}
        completed = 0
        for fut in as_completed(future_map):
            card, data = fut.result()
            results.append((card, data))
            completed += 1
            if show_progress and sys.stdout.isatty():
                _render_progress(completed, total)

    # Keep the original order of cards in the output CSV
    index_map = {id(c): idx for idx, c in enumerate(cards_list)}
    results.sort(key=lambda cd: index_map.get(id(cd[0]), 0))

    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for card, data in results:
            writer.writerow(
                {
                    "name": card.name,
                    "card_url": card.card_url,
                    "email": data.get("email", ""),
                    "title": data.get("title", ""),
                    "lab_url": data.get("lab_url", ""),
                    "introduction_snippet": data.get("introduction_snippet", ""),
                    "photo_url": data.get("photo_url", ""),
                }
            )

    if show_progress and sys.stdout.isatty():
        sys.stdout.write("\n")
        sys.stdout.flush()


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Extract EPFL people profiles from coursebook teacher column")
    p.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Path to coursebook_courses.csv (default: {DEFAULT_INPUT})",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Where to write people_profiles.csv (default: {DEFAULT_OUTPUT})",
    )
    p.add_argument(
        "--no-progress",
        action="store_true",
        help="Disable terminal progress bar",
    )
    return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    _log(f"reading courses from {args.input}")
    cards = load_teacher_cards(args.input)
    deduped = dedupe_cards(cards)
    _log(f"found {len(cards)} teacher mentions; {len(deduped)} unique")
    write_profiles_csv(deduped, args.output, show_progress=(not args.no_progress))
    _log(f"wrote profiles to {args.output}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())

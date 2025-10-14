#!/usr/bin/env python3
"""Fetch coursebook program links and dump them to a JSON file.

The script fetches a list of coursebook pages, looks for navigation blocks that
match the EPFL layout (a `<main id="main">` container with nested `<ul>` lists),
and writes the extracted links to `data/coursebook_url.json`.
Replace `COURSEBOOK_URLS` with the actual pages that need to be scraped.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List
from urllib.parse import urljoin

import requests
from lxml import html as lh

# Placeholder URL list. Populate with the real coursebook pages you want to crawl.
COURSEBOOK_URLS: List[str] = [
    "https://edu.epfl.ch/studyplan/en/propedeutics/",
    "https://edu.epfl.ch/studyplan/en/bachelor/",
    "https://edu.epfl.ch/studyplan/en/master/",
    "https://edu.epfl.ch/studyplan/en/minor/",
    "https://edu.epfl.ch/studyplan/en/doctoral_school/"
]

# Reuse a browser-like user-agent so the requests mimic manual browsing.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

# Output JSON path (relative to this script).
OUTPUT_PATH = Path(__file__).with_name("data").joinpath("coursebook_url.json")


def fetch_html(url: str) -> str:
    """Fetch the raw HTML for a given URL."""
    try:
        resp = requests.get(url, headers=REQUEST_HEADERS, timeout=15)
        resp.raise_for_status()
    except Exception as exc:  # pragma: no cover - network failure is informational
        print(f"[warn] Failed to fetch {url}: {exc}", file=sys.stderr)
        return ""
    return resp.text or ""


def extract_links(source_url: str, html_text: str) -> Iterable[Dict[str, str]]:
    """Extract anchor tags inside `<main id="main">` navigation lists."""
    if not html_text.strip():
        return []

    tree = lh.fromstring(html_text)
    results: List[Dict[str, str]] = []

    # Look for the EPFL main content container and grab any <ul> navigation lists inside it.
    containers = tree.xpath('//main[@id="main"]//div[contains(@class, "container-full")]')
    if not containers:
        containers = tree.xpath('//main[@id="main"]')

    for container in containers:
        header_text = ""
        header_nodes = container.xpath('.//header[contains(@class, "page-header")]//h2/text()')
        if header_nodes:
            header_text = " ".join(t.strip() for t in header_nodes if t.strip())

        for anchor in container.xpath('.//ul/li/a'):
            href = (anchor.get("href") or "").strip()
            if not href:
                continue

            label = anchor.text_content().strip() or (anchor.get("title") or "").strip()
            full_url = urljoin("https://edu.epfl.ch/", href)

            entry: Dict[str, str] = {
                "href": full_url,
                "label": label,
                "section": header_text or "",
            }

            results.append(entry)

    return results


def dedupe(entries: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    """Remove duplicate hrefs while preserving order."""
    seen = set()
    unique: List[Dict[str, str]] = []
    for entry in entries:
        href = entry.get("href")
        if not href or href in seen:
            continue
        seen.add(href)
        unique.append(entry)
    return unique


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    collected: List[Dict[str, str]] = []
    for idx, url in enumerate(COURSEBOOK_URLS, start=1):
        print(f"[info] Fetching ({idx}/{len(COURSEBOOK_URLS)}): {url}")
        html_text = fetch_html(url)
        links = list(extract_links(url, html_text))
        print(f"[info] Found {len(links)} links in {url}")
        collected.extend(links)

    unique_links = dedupe(collected)

    OUTPUT_PATH.write_text(
        json.dumps(unique_links, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] Wrote {len(unique_links)} unique links to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

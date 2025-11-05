import os
import requests


def test_fetch_and_dump_from_url():
    """Fetch the provided URL and dump the response text to a file for eyeballing (no parsing)."""
    url = (
        "https://edu.epfl.ch/studyplan/en/propedeutics/computer-science/"
        )
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"[skip] Network fetch failed for test URL: {e}")
        return

    # Write raw response text as-is (no XML/HTML parsing)
    text = resp.text or ""

    out_path = os.path.join(os.path.dirname(__file__), 'parsed_from_url.txt')
    with open(out_path, 'w', encoding='utf-8') as out:
        out.write(text)
    print(f"[ok] Wrote response text to {out_path} ({len(text)} chars)")

if __name__ == "__main__":
    test_fetch_and_dump_from_url()

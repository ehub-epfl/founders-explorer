import requests
import pandas as pd
import os
from lxml import etree
import importlib
import re
import json
import html
import os
import csv

# Mapping from full section names to abbreviations (case-insensitive)
SECTION_ABBREV = {
    "section of architecture": "AR",
    "section of chemistry and chemical engineering": "CGC",
    "special mathematics courses": "CMS",
    "section of civil engineering": "GC",
    # spelling varies between Electronic/Electronical in some pages
    "section of electrical and electronical engineering": "EL",
    "section of electrical and electronic engineering": "EL",
    "section of mechanical engineering": "GM",
    "section of computer science": "IN",
    "section of materials science and engineering": "MX",
    "section of mathematics": "MA",
    "section of microtechnics": "MT",
    "neuro-x section": "NX",
    "section of physics": "PH",
    "section of environmental sciences and engineering": "SIE",
    "quantum science and engineering section": "SIQ",
    "section of life sciences engineering": "SV",
    "humanities and social sciences program": "SHS",
    "section of communication systems": "SC",
    # Doctoral programs
    "doctoral program digital humanities": "EDDH",
    "doctoral program in architecture and sciences of the city": "EDAR",
    "doctoral program in biotechnology and bioengineering": "EDBB",
    "doctoral program in chemistry and chemical engineering": "EDCH",
    "doctoral program in civil and environmental engineering": "EDCE",
    "doctoral program in computational and quantitative biology": "EDCB",
    "doctoral program in electrical engineering": "EDEE",
    "doctoral program in energy": "EDEY",
    "doctoral program in finance": "EDFI",
    "doctoral program in learning sciences": "EDLS",
    "doctoral program in materials science and engineering": "EDMX",
    "doctoral program in mathematics": "EDMA",
    "doctoral program in mechanics": "EDME",
    "doctoral program in microsystems and microelectronics": "EDMI",
    "doctoral program in molecular life sciences": "EDMS",
    "doctoral program in neuroscience": "EDNE",
    "doctoral program in photonics": "EDPO",
    "doctoral program in physics": "EDPY",
    "doctoral program in technology management": "EDMT",
    "doctoral program in advanced manufacturing": "EDAM",
    "doctoral program in computer and communication sciences": "EDIC",
    "doctoral program in robotics, control, and intelligent systems": "EDRS",
}

# Valid codes set (existing codes plus mapped values)
# VALID_SECTION_CODES = set(section_codes) | set(SECTION_ABBREV.values())
VALID_SECTION_CODES = set(SECTION_ABBREV.values())

# Normalize a raw section string for matching
_def_ws_re = re.compile(r"\s+")

def _norm(s: str) -> str:
    s = (s or "").strip()
    s = _def_ws_re.sub(" ", s)
    return s

# HTTP headers for polite requests
headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

min_keywords = 10
max_keywords = 15

# Collect program labels we cannot confidently map (for diagnostics)
UNMAPPED_PROGRAMS = set()
def _et_text(elem, path):
    try:
        # Prefer XPath when available
        nodes = elem.xpath(path) if hasattr(elem, 'xpath') else []
        if nodes:
            node = nodes[0]
            text = node if isinstance(node, str) else (node.text or "")
            return text.strip()
        # Fallback to ElementTree-style find for simple paths
        node = elem.find(path)
        return (node.text or "").strip() if node is not None else ""
    except Exception:
        return ""

# Heuristic fix for common mojibake (UTF-8 read as Latin-1/CP1252/MacRoman)
def _fix_mojibake(s: str) -> str:
    if not isinstance(s, str) or not s:
        return s
    # Fast path: if it doesn't look broken, return
    if 'Ã' not in s and '√' not in s and '\ufffd' not in s:
        return s
    candidates = []
    for enc in ('latin1', 'cp1252', 'mac_roman'):
        try:
            candidates.append(s.encode(enc, errors='ignore').decode('utf-8', errors='ignore'))
        except Exception:
            pass
    # Choose the candidate with the most accented Latin letters and fewest replacement chars
    def score(txt: str) -> int:
        if not txt:
            return -10**6
        accents = sum(ch in 'àáâäæãåāèéêëēėęîïíīįìôöòóœøōõûüùúūÿçčćñÀÁÂÄÆÃÅĀÈÉÊËĒĖĘÎÏÍĪĮÌÔÖÒÓŒØŌÕÛÜÙÚŪŸÇČĆÑ' for ch in txt)
        bad = txt.count('\ufffd') + txt.count('Ã') + txt.count('√')
        return accents - bad
    best = max(candidates + [s], key=score)
    return best or s

# --- Keyword helper functions ---
def _normalize_kw_list(kws):
    """Lowercase, strip, dedupe while preserving order"""
    seen = set()
    out = []
    for k in kws:
        kl = k.strip().lower()
        if kl and kl not in seen:
            seen.add(kl)
            out.append(kl)
    return out

# Robustly split a raw keyword string into individual keywords
# Handles JSON arrays, comma/semicolon/newline, and slash-delimited lists
def _split_keywords(raw: str):
    if not isinstance(raw, str) or not raw.strip():
        return []
    s = raw.strip()
    # Try to parse JSON array first
    try:
        data = json.loads(s)
        if isinstance(data, list):
            items = []
            for itm in data:
                if isinstance(itm, str):
                    items.append(itm)
                else:
                    items.append(str(itm))
            s = ", ".join(items)
    except Exception:
        # If it's a Python-like repr list, strip outer brackets/quotes
        if s.startswith("[") and s.endswith("]"):
            s = s[1:-1]
    # Split on commas, semicolons, bullets, slashes, or spaced hyphens (" - ").
    parts = re.split(r"(?:\n|,|;|\||\u2022|\u2027|•|·|/|\s+/\s+|\s-\s)", s)
    # Clean up quotes and whitespace
    cleaned = []
    for p in parts:
        t = p.strip().strip("'\"")
        if t:
            cleaned.append(t)
    return cleaned

def parse_keywords_field(raw):
    parts = _split_keywords(raw)
    parts = [_fix_mojibake(p).rstrip('.\n') for p in parts]
    return _normalize_kw_list(parts)

def format_program_name(prog: str) -> str:
    """
    Normalize a raw program label like:
      "Computer Science, 2025-2026, Master semester 1"
    into a compact routing key used by our JSON map, e.g.:
      "MA1 Computer Science"
    Similar handling for BA:
      "BA3 Architecture"
    For doctoral programs, map to edoc bucket without semester:
      "edoc Computer and Communication Sciences"
    """
    if not prog:
        return ""
    s = prog.strip()
    # Split on commas (EPFL labels often look like "Xxx, 2025-2026, Master semester 1")
    parts = [p.strip() for p in s.split(",") if p.strip()]
    base = parts[0] if parts else s
    rest = " ".join(parts[1:])
    # Drop year-like tokens e.g., "2025-2026" or "2025 - 2026"
    rest = re.sub(r"\b\d{4}\s*(?:-\s*\d{4})?\b", "", rest, flags=re.I).strip()
    rest_l = rest.lower()

    # Special-case: Minors (map under MA -> Minor -> season buckets)
    if "minor" in rest_l:
        season_bucket = None
        if "autumn" in rest_l or "fall" in rest_l:
            season_bucket = "Minor Autumn Semester"
        elif "spring" in rest_l:
            season_bucket = "Minor Spring Semester"
        if season_bucket:
            return f"{season_bucket} {base}".strip()
        else:
            # Season not found; keep original and record as unmapped
            try:
                UNMAPPED_PROGRAMS.add(s)
            except Exception:
                pass
            return base.strip()

    # Determine level (MA / BA / edoc)
    level = None
    if "master" in rest_l or re.search(r"\bma\b", rest_l):
        level = "MA"
    elif "bachelor" in rest_l or re.search(r"\bba\b", rest_l):
        level = "BA"
    elif "edoc" in rest_l or "phd" in rest_l or "doctoral" in rest_l:
        # Doctoral programs: no semester number in our JSON
        return f"edoc {base}".strip()

    # Extract semester number if present
    m = re.search(r"semester\s*(\d+)", rest_l)
    sem = m.group(1) if m else ""

    if level:
        if sem:
            return f"{level}{sem} {base}".strip()
        else:
            # Fallback when semester not specified
            return f"{level} {base}".strip()

    # Default to base if we cannot infer level
    try:
        UNMAPPED_PROGRAMS.add(s)
    except Exception:
        pass
    return base.strip()


def main():
    course_url = "http://isa.epfl.ch/imoniteur_ISAP/!itffichecours.htm?ww_i_matiere=3548963778&ww_x_anneeacad=2840683608&ww_i_section=942293&ww_i_niveau=6683117&ww_c_langue=fr"
    if course_url:
        try:
            page_resp = requests.get(course_url, headers=headers, timeout=15)
            page_resp.raise_for_status()
            # print(f"[debug] Content-Type: {page_resp.headers.get('Content-Type', '')}")
            # with open("body_preview.txt", "w") as file:
            #     file.write(page_resp.text)
            # exit()
            # Parse using bytes; let lxml auto-detect encoding from declarations/meta
            content_type = page_resp.headers.get('Content-Type', '').lower()
            content_bytes = page_resp.content
            root = None
            if 'xml' in content_type:
                try:
                    parser = etree.XMLParser(recover=True)
                    root = etree.fromstring(content_bytes, parser=parser)
                except Exception:
                    parser = etree.HTMLParser()
                    root = etree.fromstring(content_bytes, parser=parser)
            else:
                try:
                    parser = etree.HTMLParser()
                    root = etree.fromstring(content_bytes, parser=parser)
                except Exception:
                    parser = etree.XMLParser(recover=True)
                    root = etree.fromstring(content_bytes, parser=parser)
            # Credits
            credits = _et_text(root, "//examen/n_credits") or _et_text(root, "//examen/details/detail/coeff/n_valeur")
            # Exam form (prefer EN, fallback FR)
            exam_form = _et_text(root, "//examen/details/detail/code[@langue='en']") or \
                        _et_text(root, "//examen/details/detail/code[@langue='fr']")
            # Type (prefer EN, fallback FR)
            course_type = _et_text(root, "//enseignement/typecourss/code[@langue='en']") or \
                        _et_text(root, "//enseignement/typecourss/code[@langue='fr']") or course_type
            # Times under a single <gps> -> compute a single workload
            # Only consider the first <gps> under <gpss> to avoid duplicates across programs
            weekly_total = 0.0
            semester_total = 0.0
            # Choose context: first <gps> if present, else fall back to the whole document
            gps_nodes = root.xpath("//gpss/gps") if hasattr(root, 'xpath') else []
            ctx = gps_nodes[0] if gps_nodes else root
            for det in ctx.findall(".//enseignement/details/detail"):
                # only consider course/exercise/project entries (EN or FR)
                label_en = (_et_text(det, "code[@langue='en']") or "").lower()
                label_fr = (_et_text(det, "code[@langue='fr']") or "").lower()
                label = label_en or label_fr
                if label not in {"courses", "cours", "exercises", "exercices", "project", "projet"}:
                    continue
                quant = _et_text(det, "quantite")
                freq = _et_text(det, "frequences/code[@langue='en']") or _et_text(det, "frequences/code[@langue='fr']")
                # extract numeric quantity from quant
                num = 0.0
                try:
                    import re as _re
                    m = _re.search(r"[\d.]+", quant or "")
                    if m:
                        num = float(m.group(0))
                except Exception:
                    num = 0.0
                freq_l = (freq or "").lower()
                if "per week" in freq_l or "hebdo" in freq_l:
                    weekly_total += num
                else:
                    # default to per semester if not explicitly per week
                    semester_total += num
            # finalize workload string
            if weekly_total > 0:
                # prefer weekly if any part is weekly
                workload = f"{int(weekly_total) if weekly_total.is_integer() else weekly_total}hrs/week"
            elif semester_total > 0:
                workload = f"{int(semester_total) if semester_total.is_integer() else semester_total}hrs/semester"
            else:
                workload = ""
            kw_block_nodes = root.xpath("//texte[@var='RUBRIQUE_MOTS_CLES']")
            if kw_block_nodes:
                kw_block = kw_block_nodes[0]
                paras = [("".join(p.itertext())).strip() for p in kw_block.xpath(".//p")]
                raw = " ".join([p for p in paras if p])
                keywords = parse_keywords_field(raw)
            available_programs = [node.text.strip() for node in root.xpath("//gps/x_gps[@langue='en']")]
            credits = _fix_mojibake(credits)
            exam_form = _fix_mojibake(exam_form)
            course_type = _fix_mojibake(course_type)
            available_programs = [format_program_name(_fix_mojibake(x)) for x in available_programs]
            # Extract resume/summary and content blocks
            try:
                resume_nodes = root.xpath("//texte[@var='RUBRIQUE_RESUME']") or []
                if resume_nodes:
                    resume_text = " ".join(("".join(n.itertext())).strip() for n in resume_nodes if n is not None).strip()
                content_nodes = root.xpath("//texte[@var='RUBRIQUE_CONTENU']") or []
                if content_nodes:
                    content_text = " ".join(("".join(n.itertext())).strip() for n in content_nodes if n is not None).strip()
                # Unescape common HTML entities and fix mojibake
                if resume_text:
                    resume_text = _fix_mojibake(html.unescape(resume_text))
                if content_text:
                    content_text = _fix_mojibake(html.unescape(content_text))
            except Exception:
                # Be resilient if page format changes
                pass
        except Exception as e_xml:
            print(f"  [error] XML parsing failed for {course_url}: {e_xml}")
        except Exception as page_err:
            print(f"  Could not read credits from {course_url}: {page_err}")

    if str(credits).strip() != "0":
        keywords = _normalize_kw_list(keywords)
        row = [
            credits,
            exam_form,
            workload,
            course_type,
            keywords,
            available_programs,
        ]
        print(row)

if __name__ == "__main__":
    main()
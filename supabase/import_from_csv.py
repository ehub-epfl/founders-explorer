"""Populate the new coursebook tables from the CSV exports produced by
the data scraper.

The script reads the course and program CSV files, upserts rows into the
`coursebook_courses` table, and refreshes matching rows in
`people_profiles`, `course_people_profiles`, and `coursebook_programs`. It talks to Supabase via
the PostgREST endpoint using the service-role key so the requests are
idempotent and consistent with the schema defined in `init_postgres.sql`.
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import requests


RepositoryPath = Path(__file__).resolve().parents[1]
DEFAULT_COURSES_CSV = (
    RepositoryPath / "data-scraper" / "data" / "coursebook_courses.csv"
)
DEFAULT_PROGRAMS_CSV = (
    RepositoryPath / "data-scraper" / "data" / "coursebook_programs.csv"
)
DEFAULT_STUDYPLANS_CSV = (
    RepositoryPath / "data-scraper" / "data" / "coursebook_studyplans.csv"
)
DEFAULT_ENTRE_SCORES_CSV = (
    RepositoryPath / "data-scraper" / "data" / "coursebook_entre_scores.csv"
)
DEFAULT_PEOPLE_PROFILES_CSV = (
    RepositoryPath / "data-scraper" / "data" / "people_profiles_with_summary.csv"
)
ENV_PATH = Path(__file__).resolve().with_name(".env")

SCHEDULE_GRID_START_MIN = 8 * 60  # 08:00
SCHEDULE_GRID_END_MIN = 20 * 60  # 20:00
SCHEDULE_GRID_STEP_MIN = 60
SCHEDULE_SLOT_STARTS = list(
    range(SCHEDULE_GRID_START_MIN, SCHEDULE_GRID_END_MIN, SCHEDULE_GRID_STEP_MIN)
)
SCHEDULE_MATRIX_ROWS = len(SCHEDULE_SLOT_STARTS)
SCHEDULE_MATRIX_COLS = 7
SCHEDULE_DAY_KEYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]

DAY_INDEX_LOOKUP = {
    "monday": 0,
    "mon": 0,
    "lundi": 0,
    "lun": 0,
    "tuesday": 1,
    "tue": 1,
    "mardi": 1,
    "mar": 1,
    "wednesday": 2,
    "wed": 2,
    "mercredi": 2,
    "mer": 2,
    "thursday": 3,
    "thu": 3,
    "thurs": 3,
    "jeudi": 3,
    "jeu": 3,
    "friday": 4,
    "fri": 4,
    "vendredi": 4,
    "ven": 4,
    "saturday": 5,
    "sat": 5,
    "samedi": 5,
    "sam": 5,
    "sunday": 6,
    "sun": 6,
    "dimanche": 6,
    "dim": 6,
}

SCHEDULE_RANGE_RE = re.compile(
    r"^(?P<day>[A-Za-zÀ-ÿ]+)[,]?\s+"
    r"(?P<start>\d{1,2}(?::\d{2})?|\d{1,2}h\d{0,2})\s*[–—-]\s*"
    r"(?P<end>\d{1,2}(?::\d{2})?|\d{1,2}h\d{0,2})"
    r"(?:\s*[:,-]\s*(?P<label>.*))?$",
    re.IGNORECASE,
)


class SupabaseError(RuntimeError):
    """Raised when the Supabase REST API returns a non-2xx response."""


class SupabaseClient:
    """Thin wrapper around the Supabase PostgREST endpoint."""

    def __init__(self, base_url: str, service_role_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
            }
        )

    # ---- REST helpers -------------------------------------------------
    def _handle(self, response: requests.Response) -> List[dict]:
        if 200 <= response.status_code < 300:
            if response.content:
                try:
                    return response.json()
                except ValueError as exc:
                    raise SupabaseError(
                        f"Failed to decode JSON response from {response.url}"
                    ) from exc
            return []
        raise SupabaseError(
            f"{response.request.method} {response.url} failed with "
            f"status {response.status_code}: {response.text}"
        )

    def upsert(
        self,
        table: str,
        rows: Sequence[dict],
        on_conflict: str,
        prefer: str = "resolution=merge-duplicates,return=representation",
    ) -> List[dict]:
        if not rows:
            return []
        url = f"{self.base_url}/rest/v1/{table}"
        response = self.session.post(
            url,
            json=rows,
            params={"on_conflict": on_conflict},
            headers={"Prefer": prefer},
            timeout=30,
        )
        return self._handle(response)

    def delete_where(self, table: str, filters: Dict[str, str]) -> None:
        url = f"{self.base_url}/rest/v1/{table}"
        response = self.session.delete(url, params=filters, timeout=30)
        self._handle(response)

    def select(
        self, table: str, select: str, filters: Dict[str, str]
    ) -> List[dict]:
        url = f"{self.base_url}/rest/v1/{table}"
        params = {"select": select, **filters}
        response = self.session.get(url, params=params, timeout=30)
        return self._handle(response)


# ---- CSV parsing -------------------------------------------------------
def load_env(path: Path) -> None:
    """Populate missing environment variables from a simple .env file."""

    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _parse_credit(value: str) -> Optional[float]:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    try:
        numeric = float(cleaned.replace(",", "."))
    except ValueError:
        return None
    # round to 2 decimal places to avoid floating point noise
    return round(numeric, 2)


def _parse_int(value: str) -> Optional[int]:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def _compute_vb_average(row: dict) -> Optional[float]:
    keys = ["VB-MKT", "VB-FIN", "VB-START", "VB-OPS", "VB-IP"]
    values = []
    for key in keys:
        score = _parse_int(row.get(key, ""))
        if score is not None:
            values.append(score)
    if not values:
        return None
    average = sum(values) / len(values)
    return round(average, 2)


_TIME_TOKEN_RE = re.compile(r"^\s*(\d{1,2})(?::?(\d{0,2}))?\s*$")


def _empty_schedule_matrix() -> List[List[int]]:
    return [[0 for _ in range(SCHEDULE_MATRIX_COLS)] for _ in range(SCHEDULE_MATRIX_ROWS)]


def _validate_schedule_matrix(matrix: Any) -> Optional[List[List[int]]]:
    if not isinstance(matrix, list):
        return None
    if len(matrix) != SCHEDULE_MATRIX_ROWS:
        return None
    normalized: List[List[int]] = []
    for row in matrix:
        if not isinstance(row, list) or len(row) != SCHEDULE_MATRIX_COLS:
            return None
        normalized.append([1 if int(val) else 0 for val in row])
    return normalized


def _parse_schedule_matrix_field(value: Any) -> Optional[List[List[int]]]:
    if value is None:
        return None
    if isinstance(value, list):
        return _validate_schedule_matrix(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return _validate_schedule_matrix(parsed)
        except Exception:
            return None
    return None


def _build_matrix_from_day_columns(row: dict) -> Optional[List[List[int]]]:
    day_columns: List[List[int]] = []
    for day_key in SCHEDULE_DAY_KEYS:
        raw = row.get(day_key)
        if raw is None:
            day_columns.append([])
            continue
        parsed: List[int] = []
        if isinstance(raw, str) and raw.strip():
            try:
                parsed = [int(val) for val in json.loads(raw)]
            except Exception:
                parsed = [int(val) for val in re.split(r"[\\s,]+", raw.strip()) if val]
        elif isinstance(raw, list):
            parsed = [int(val) for val in raw]
        day_columns.append(parsed)

    if all(len(col) == 0 for col in day_columns):
        return None

    matrix = _empty_schedule_matrix()
    for row_idx in range(SCHEDULE_MATRIX_ROWS):
        for day_idx, col in enumerate(day_columns):
            if row_idx < len(col):
                matrix[row_idx][day_idx] = 1 if int(col[row_idx]) else 0
    return matrix


def _parse_time_token(token: str) -> Optional[int]:
    cleaned = (token or "").lower().replace("h", ":").replace(".", ":")
    cleaned = re.sub(r"\s+", "", cleaned)
    match = _TIME_TOKEN_RE.match(cleaned)
    if not match:
        return None
    hours = int(match.group(1))
    minutes_str = match.group(2) or "0"
    minutes = int(minutes_str) if minutes_str else 0
    if hours < 0 or hours > 24 or minutes < 0 or minutes >= 60:
        return None
    return hours * 60 + minutes


def build_schedule_matrix(schedule_text: str) -> List[List[int]]:
    """Convert schedule lines into a 12x7 hour/day occupancy matrix."""

    matrix = _empty_schedule_matrix()
    if not isinstance(schedule_text, str) or not schedule_text.strip():
        return matrix

    for raw_line in schedule_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = SCHEDULE_RANGE_RE.match(line)
        if not match:
            continue
        day_token = (match.group("day") or "").strip().lower()
        day_index = DAY_INDEX_LOOKUP.get(day_token)
        if day_index is None:
            continue
        start_minutes = _parse_time_token(match.group("start"))
        end_minutes = _parse_time_token(match.group("end"))
        if start_minutes is None or end_minutes is None:
            continue
        if end_minutes <= start_minutes:
            continue
        for row_idx, slot_start in enumerate(SCHEDULE_SLOT_STARTS):
            slot_end = slot_start + SCHEDULE_GRID_STEP_MIN
            if slot_end <= start_minutes:
                continue
            if slot_start >= end_minutes:
                break
            matrix[row_idx][day_index] = 1

    return matrix


def read_score_rows(path: Path) -> Dict[str, dict]:
    if not path.exists():
        return {}
    mapping: Dict[str, dict] = {}
    with path.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            course_key = (row.get("course_key") or "").strip()
            if not course_key:
                continue
            mapping[course_key] = row
    return mapping


def read_course_rows(path: Path, scores: Dict[str, dict]) -> Tuple[List[dict], List[dict]]:
    courses: List[dict] = []
    teachers: List[dict] = []

    with path.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            course_key = row.get("course_key", "").strip()
            course_name = row.get("course_name", "").strip()
            if not course_key or not course_name:
                continue  # skip incomplete rows

            credits_raw = row.get("credits", "")
            credits_value = _parse_credit(credits_raw)
            workload_raw = row.get("workload", "")
            workload_value = _parse_credit(workload_raw)

            score_entry = scores.get(course_key, {})
            entre_score = _parse_int(score_entry.get("entre_score", "")) if score_entry else None
            pd_score = _parse_int(score_entry.get("PD", "")) if score_entry else None
            pb_score = _parse_int(score_entry.get("PB", "")) if score_entry else None
            vb_average = _compute_vb_average(score_entry) if score_entry else None
            intro_score = _parse_int(score_entry.get("INTRO", "")) if score_entry else None
            if intro_score is None:
                intro_score = 0

            schedule_text = (row.get("schedule") or "").strip()
            schedule_matrix = (
                _parse_schedule_matrix_field(row.get("schedule_matrix"))
                or _build_matrix_from_day_columns(row)
                or build_schedule_matrix(schedule_text)
            )

            courses.append(
                {
                    "course_key": course_key,
                    "course_name": course_name,
                    "section": row.get("section", "").strip(),
                    "study_program": (row.get("study_program") or "").strip() or None,
                    "study_faculty": (row.get("study_faculty") or "").strip() or None,
                    "study_block": (row.get("study_block") or "").strip() or None,
                    "course_url": row.get("course_url", "").strip(),
                    "language": row.get("language", "").strip(),
                    "credits": credits_value,
                    "workload": workload_value,
                    "semester": (row.get("semester") or "").strip() or None,
                    "course_type": (row.get("type") or "").strip() or None,
                    "schedule": schedule_text,
                    "schedule_matrix": schedule_matrix,
                    "description": (row.get("description") or "").strip(),
                    "keywords": (row.get("keywords") or "").strip(),
                    "entre_score": entre_score,
                    "PD": pd_score,
                    "PB": pb_score,
                    "VB": vb_average,
                    "INTRO": intro_score,
                }
            )

            teachers_json = row.get("teacher", "") or "[]"
            try:
                teacher_entries = json.loads(teachers_json)
            except json.JSONDecodeError:
                # Some rows include single quotes or other formatting artefacts.
                teacher_entries = []

            seen_names: set = set()
            for entry in teacher_entries:
                teacher_name = (entry or {}).get("name", "").strip()
                if not teacher_name or teacher_name in seen_names:
                    continue
                seen_names.add(teacher_name)
                teacher_url = (entry or {}).get("url")
                teachers.append(
                    {
                        "course_key": course_key,
                        "teacher_name": teacher_name,
                        "teacher_url": (teacher_url or "").strip() or None,
                    }
                )

    return courses, teachers


def read_program_rows(path: Path) -> List[dict]:
    programs: List[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            course_key = row.get("course_key", "").strip()
            program_name = row.get("program_name", "").strip()
            level = row.get("level", "").strip()
            semester = row.get("semester", "").strip()
            exam_form = row.get("exam_form", "").strip()
            program_type = row.get("type", "").strip()
            workload_value = _parse_credit(row.get("workload", ""))
            if not course_key or not program_name:
                continue
            programs.append(
                {
                    "course_key": course_key,
                    "program_name": program_name,
                    "level": level,
                    "semester": semester,
                    "exam_form": exam_form,
                    "program_type": program_type,
                    "workload": workload_value,
                }
            )
    return programs


def read_studyplan_rows(path: Path) -> List[dict]:
    studyplans: List[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            course_key = (row.get("course_key") or "").strip()
            study_program = (row.get("study_program") or "").strip()
            study_faculty = (row.get("study_faculty") or "").strip()
            study_block = (row.get("study_block") or "").strip()
            if not course_key or not study_program or not study_faculty or not study_block:
                continue
            studyplans.append(
                {
                    "course_key": course_key,
                    "study_program": study_program,
                    "study_faculty": study_faculty,
                    "study_block": study_block,
                }
            )
    return studyplans


def read_people_profiles_rows(path: Path) -> List[dict]:
    """Read people_profiles.csv produced by the scraper and map to DB columns.

    CSV columns expected: name, card_url, email, title, lab_url, introduction_snippet, photo_url
    DB columns:           name, card_url, email, title, lab_url, photo_url, introduction_summary
    """
    profiles: List[dict] = []
    if not path.exists():
        return profiles
    # Allow very large CSV fields (long summaries)
    try:
        csv.field_size_limit(max(csv.field_size_limit(), 10 * 1024 * 1024))
    except Exception:
        try:
            csv.field_size_limit(10 * 1024 * 1024)
        except Exception:
            pass
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get("name") or "").strip()
            if not name:
                continue
            profiles.append(
                {
                    "name": name,
                    "card_url": (row.get("card_url") or "").strip() or None,
                    "email": (row.get("email") or "").strip() or None,
                    "title": (row.get("title") or "").strip() or None,
                    "lab_url": (row.get("lab_url") or "").strip() or None,
                    "photo_url": (row.get("photo_url") or "").strip() or None,
                    "introduction_summary": (row.get("introduction_summary") or "").strip() or None,
                }
            )
    return profiles


# ---- Utilities ---------------------------------------------------------
def chunked(sequence: Sequence, size: int) -> Iterable[Sequence]:
    for index in range(0, len(sequence), size):
        yield sequence[index : index + size]


def build_in_filter(
    column: str, values: Sequence[str], quote: bool = True
) -> Dict[str, str]:
    if not values:
        return {}
    if quote:
        def escape(value: str) -> str:
            return value.replace("\\", "\\\\").replace('"', '\\"')

        escaped = ",".join(
            f'"{escape(str(value))}"'
            for value in values
        )
    else:
        escaped = ",".join(values)
    return {column: f"in.({escaped})"}


def map_course_ids(
    client: SupabaseClient,
    course_keys: Sequence[str],
    fallback_rows: Optional[Sequence[dict]] = None,
) -> Dict[str, int]:
    mapping: Dict[str, int] = {}
    unique_keys = sorted(set(course_keys))
    for chunk in chunked(unique_keys, 150):
        filters = build_in_filter("course_key", chunk, quote=True)
        rows = client.select(
            "coursebook_courses",
            select="id,course_key",
            filters=filters,
        )
        for row in rows:
            key = row.get("course_key")
            ident = row.get("id")
            if key and isinstance(ident, int):
                mapping[key] = ident
    if fallback_rows:
        for row in fallback_rows:
            key = row.get("course_key")
            ident = row.get("id")
            if key and isinstance(ident, int):
                mapping.setdefault(key, ident)
    return mapping


def delete_existing_children(
    client: SupabaseClient, table: str, course_ids: Sequence[int]
) -> None:
    if not course_ids:
        return
    for chunk in chunked(list(dict.fromkeys(course_ids)), 150):
        filters = build_in_filter(
            "course_id", [str(value) for value in chunk], quote=False
        )
        client.delete_where(table, filters)


def upsert_people_profiles(client: SupabaseClient, profiles: Sequence[dict]) -> None:
    if not profiles:
        return
    for chunk in chunked(list(profiles), 500):
        client.upsert(
            "people_profiles",
            rows=chunk,
            on_conflict="name,card_url",
        )


def map_people_ids(
    client: SupabaseClient, names: Sequence[str], urls: Sequence[str]
) -> Tuple[Dict[str, int], Dict[str, int]]:
    by_url: Dict[str, int] = {}
    by_name: Dict[str, int] = {}
    url_values = [u for u in sorted(set(urls)) if u]
    name_values = [n for n in sorted(set(names)) if n]
    for chunk in chunked(url_values, 150):
        filters = build_in_filter("card_url", chunk, quote=True)
        rows = client.select("people_profiles", select="id,card_url", filters=filters)
        for r in rows:
            if r.get("card_url") and isinstance(r.get("id"), int):
                by_url[r["card_url"]] = r["id"]
    for chunk in chunked(name_values, 150):
        filters = build_in_filter("name", chunk, quote=True)
        rows = client.select("people_profiles", select="id,name", filters=filters)
        for r in rows:
            if r.get("name") and isinstance(r.get("id"), int):
                by_name[r["name"]] = r["id"]
    return by_url, by_name


def upsert_course_people_links(
    client: SupabaseClient,
    teacher_rows: Sequence[dict],
    course_id_map: Dict[str, int],
) -> None:
    if not teacher_rows:
        return
    urls = [row.get("teacher_url") or "" for row in teacher_rows]
    names = [row.get("teacher_name") or "" for row in teacher_rows]
    url_map, name_map = map_people_ids(client, names, urls)

    payload: List[dict] = []
    for row in teacher_rows:
        course_id = course_id_map.get(row["course_key"])  # type: ignore[index]
        if not course_id:
            continue
        person_id = None
        url = (row.get("teacher_url") or "").strip()
        name = (row.get("teacher_name") or "").strip()
        if url and url in url_map:
            person_id = url_map[url]
        elif name and name in name_map:
            person_id = name_map[name]
        if not person_id:
            continue
        payload.append({"course_id": course_id, "person_id": person_id})

    if payload:
        delete_existing_children(
            client,
            "course_people_profiles",
            [row["course_id"] for row in payload],
        )
        for chunk in chunked(payload, 500):
            client.upsert(
                "course_people_profiles",
                rows=chunk,
                on_conflict="course_id,person_id",
            )


def upsert_programs(
    client: SupabaseClient,
    program_rows: Sequence[dict],
    course_id_map: Dict[str, int],
) -> None:
    unique_records: Dict[
        Tuple[str, str, str, str, str, str], dict
    ] = {}
    for row in program_rows:
        course_key = row["course_key"]
        course_id = course_id_map.get(course_key)
        if not course_id:
            continue
        key = (
            course_key,
            row["program_name"],
            row.get("level", ""),
            row["semester"],
            row["exam_form"],
            row["program_type"],
        )
        if key in unique_records:
            if unique_records[key].get("workload") is None and row.get("workload") is not None:
                unique_records[key]["workload"] = row.get("workload")
            continue
        unique_records[key] = {
            "course_id": course_id,
            "program_name": row["program_name"],
            "level": row.get("level"),
            "semester": row["semester"],
            "exam_form": row["exam_form"],
            "program_type": row["program_type"],
            "workload": row.get("workload"),
        }

    payload = list(unique_records.values())
    if payload:
        delete_existing_children(
            client,
            "coursebook_programs",
            [row["course_id"] for row in payload],
        )
        for chunk in chunked(payload, 500):
            client.upsert(
                "coursebook_programs",
                rows=chunk,
                on_conflict="course_id,program_name,level,semester,exam_form,program_type",
            )


def upsert_studyplans(
    client: SupabaseClient,
    studyplan_rows: Sequence[dict],
    course_id_map: Dict[str, int],
) -> None:
    if not studyplan_rows:
        return
    payload: List[dict] = []
    for row in studyplan_rows:
        course_id = course_id_map.get(row["course_key"])
        if not course_id:
            continue
        payload.append(
            {
                "course_id": course_id,
                "study_program": row["study_program"],
                "study_faculty": row["study_faculty"],
                "study_block": row["study_block"],
            }
        )
    if not payload:
        return
    delete_existing_children(
        client,
        "coursebook_studyplans",
        [row["course_id"] for row in payload],
    )
    for chunk in chunked(payload, 500):
        client.upsert(
            "coursebook_studyplans",
            rows=chunk,
            on_conflict="course_id,study_program,study_faculty,study_block",
        )


def upsert_compass_entries_for_top_courses(
    client: SupabaseClient,
    course_rows: Sequence[dict],
    top_n: int = 30,
) -> None:
    """Populate compass_entries with the top-N courses by entrepreneurship score."""
    if not course_rows or top_n <= 0:
        return

    candidates = [
        row
        for row in course_rows
        if row.get("entre_score") is not None
        and (row.get("course_name") or "").strip()
        and (row.get("course_key") or "").strip()
    ]
    if not candidates:
        return

    def sort_key(row: dict) -> tuple:
        return (
            int(row.get("entre_score") or 0),
            int(row.get("PD") or 0),
            int(row.get("PB") or 0),
            str(row.get("course_key") or ""),
        )

    sorted_courses = sorted(candidates, key=sort_key, reverse=True)
    top_courses = sorted_courses[:top_n]

    # Clear previous course entries so the table only reflects the latest top-N set.
    client.delete_where("compass_entries", {"category": "eq.course"})

    payload: List[dict] = []
    for idx, row in enumerate(top_courses):
        payload.append(
            {
                "slot_index": idx,
                "label": row.get("course_key") or "",
                "url": row.get("course_url") or "",
                "category": "course",
                "description": row.get("course_name") or "",
            }
        )

    if payload:
        client.upsert(
            "compass_entries",
            rows=payload,
            on_conflict="slot_index",
        )


def main() -> int:
    load_env(ENV_PATH)
    # Bump CSV field limit globally to handle large text columns
    try:
        csv.field_size_limit(max(csv.field_size_limit(), 10 * 1024 * 1024))
    except Exception:
        try:
            csv.field_size_limit(10 * 1024 * 1024)
        except Exception:
            pass
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    courses_csv = Path(
        os.environ.get("COURSEBOOK_COURSES_CSV", DEFAULT_COURSES_CSV)
    )
    programs_csv = Path(
        os.environ.get("COURSEBOOK_PROGRAMS_CSV", DEFAULT_PROGRAMS_CSV)
    )
    studyplans_csv = Path(
        os.environ.get("COURSEBOOK_STUDYPLANS_CSV", DEFAULT_STUDYPLANS_CSV)
    )
    entre_scores_csv = Path(
        os.environ.get("COURSEBOOK_ENTRE_SCORES_CSV", DEFAULT_ENTRE_SCORES_CSV)
    )

    if not supabase_url or not service_role_key:
        print("error: Supabase credentials missing in supabase/.env.", file=sys.stderr)
        return 1

    if not courses_csv.exists():
        print(f"error: {courses_csv} does not exist.", file=sys.stderr)
        return 1
    if not programs_csv.exists():
        print(f"error: {programs_csv} does not exist.", file=sys.stderr)
        return 1
    if not studyplans_csv.exists():
        print(f"error: {studyplans_csv} does not exist.", file=sys.stderr)
        return 1
    people_csv = Path(
        os.environ.get("PEOPLE_PROFILES_CSV", DEFAULT_PEOPLE_PROFILES_CSV)
    )

    if entre_scores_csv.exists():
        scores = read_score_rows(entre_scores_csv)
    else:
        print(
            f"warning: {entre_scores_csv} does not exist. Entrepreneurship scores will be empty.",
            file=sys.stderr,
        )
        scores = {}

    courses, teachers = read_course_rows(courses_csv, scores)
    programs = read_program_rows(programs_csv)
    studyplans = read_studyplan_rows(studyplans_csv)
    people_profiles = read_people_profiles_rows(people_csv)

    print(
        f"Loaded {len(courses)} courses, {len(teachers)} teacher mentions, "
        f"{len(programs)} program rows, {len(studyplans)} study plan rows, "
        f"and {len(people_profiles)} people profiles."
    )

    client = SupabaseClient(supabase_url, service_role_key)
    upserted: List[dict] = []
    for chunk in chunked(courses, 500):
        upserted.extend(
            client.upsert(
                "coursebook_courses",
                rows=chunk,
                on_conflict="unique_code",
            )
        )
    print(f"Upserted {len(upserted)} courses into coursebook_courses.")

    course_id_map = map_course_ids(
        client,
        [row["course_key"] for row in courses],
        fallback_rows=upserted,
    )
    missing = sorted(set(row["course_key"] for row in courses) - set(course_id_map))
    if missing:
        print(
            f"warning: missing course IDs for {len(missing)} course keys "
            f"(examples: {', '.join(missing[:5])})",
            file=sys.stderr,
        )

    upsert_people_profiles(client, people_profiles)
    print("People profiles synced.")

    upsert_course_people_links(client, teachers, course_id_map)
    print("Course→people links synced.")

    upsert_programs(client, programs, course_id_map)
    print("Programs synced.")

    upsert_studyplans(client, studyplans, course_id_map)
    print("Study plans synced.")

    upsert_compass_entries_for_top_courses(client, courses, top_n=30)
    print("Compass entries (top 30 courses) synced.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

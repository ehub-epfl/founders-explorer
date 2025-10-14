"""Populate the new coursebook tables from the CSV exports produced by
the data scraper.

The script reads the course and program CSV files, upserts rows into the
`coursebook_courses` table, and refreshes matching rows in
`coursebook_teachers` and `coursebook_programs`.  It talks to Supabase via
the PostgREST endpoint using the service-role key so the requests are
idempotent and consistent with the schema defined in `init_postgres.sql`.
"""

from __future__ import annotations

import csv
import json
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import requests


RepositoryPath = Path(__file__).resolve().parents[1]
DEFAULT_COURSES_CSV = (
    RepositoryPath / "data-scraper" / "data" / "coursebook_courses.csv"
)
DEFAULT_PROGRAMS_CSV = (
    RepositoryPath / "data-scraper" / "data" / "coursebook_programs.csv"
)
ENV_PATH = Path(__file__).resolve().with_name(".env")


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


def read_course_rows(path: Path) -> Tuple[List[dict], List[dict]]:
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

            courses.append(
                {
                    "course_key": course_key,
                    "course_name": course_name,
                    "section": row.get("section", "").strip(),
                    "course_url": row.get("course_url", "").strip(),
                    "language": row.get("language", "").strip(),
                    "credits": credits_value,
                    "semester": (row.get("semester") or "").strip() or None,
                    "course_type": (row.get("type") or "").strip() or None,
                    "schedule": row.get("schedule", "").strip(),
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
                }
            )
    return programs


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


def upsert_teachers(
    client: SupabaseClient,
    teacher_rows: Sequence[dict],
    course_id_map: Dict[str, int],
) -> None:
    payload = []
    for row in teacher_rows:
        course_key = row["course_key"]
        course_id = course_id_map.get(course_key)
        if not course_id:
            continue
        payload.append(
            {
                "course_id": course_id,
                "teacher_name": row["teacher_name"],
                "teacher_url": row["teacher_url"],
            }
        )
    if payload:
        delete_existing_children(
            client,
            "coursebook_teachers",
            [row["course_id"] for row in payload],
        )
        for chunk in chunked(payload, 500):
            client.upsert(
                "coursebook_teachers",
                rows=chunk,
                on_conflict="course_id,teacher_name",
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
            continue
        unique_records[key] = {
            "course_id": course_id,
            "program_name": row["program_name"],
            "level": row.get("level"),
            "semester": row["semester"],
            "exam_form": row["exam_form"],
            "program_type": row["program_type"],
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


def main() -> int:
    load_env(ENV_PATH)
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    courses_csv = Path(
        os.environ.get("COURSEBOOK_COURSES_CSV", DEFAULT_COURSES_CSV)
    )
    programs_csv = Path(
        os.environ.get("COURSEBOOK_PROGRAMS_CSV", DEFAULT_PROGRAMS_CSV)
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

    courses, teachers = read_course_rows(courses_csv)
    programs = read_program_rows(programs_csv)

    print(
        f"Loaded {len(courses)} courses, {len(teachers)} teacher entries, "
        f"and {len(programs)} program rows."
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

    upsert_teachers(client, teachers, course_id_map)
    print("Teachers synced.")

    upsert_programs(client, programs, course_id_map)
    print("Programs synced.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

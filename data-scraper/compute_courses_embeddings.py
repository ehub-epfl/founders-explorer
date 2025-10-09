"""Stage A: build per-sentence BGEM3 embeddings and course metadata artifacts.

The script reads a CSV containing at least ``row_id`` and ``text`` columns,
splits each course text into sentences, encodes them with ``BAAI/bge-m3``, and
writes the following artifacts:

* ``courses.meta.parquet`` – course-level index (id, offsets, counts, lengths)
* ``sentences.txt`` – newline-separated list of sentences (global order)
* ``sentences.embeddings.npy`` – matrix of sentence embeddings (L2 normalized)
* ``courses.embeddings.npy`` – mean embedding per course (L2 normalized)

These artifacts are consumed by the Stage B scoring script.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Iterable, List, Sequence

import numpy as np
import pandas as pd
import torch
from FlagEmbedding import BGEM3FlagModel

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_CSV_PATH = DEFAULT_DATA_DIR / "courses_texts.csv"
DEFAULT_META_PATH = DEFAULT_DATA_DIR / "courses.meta.parquet"
DEFAULT_SENTENCES_PATH = DEFAULT_DATA_DIR / "sentences.txt"
DEFAULT_SENT_EMB_PATH = DEFAULT_DATA_DIR / "sentences.embeddings.npy"
DEFAULT_COURSE_EMB_PATH = DEFAULT_DATA_DIR / "courses.embeddings.npy"

ROW_ID_COLUMN = "row_id"
TEXT_COLUMN = "text"
MODEL_NAME = "BAAI/bge-m3"
DEFAULT_BATCH_SIZE = 64
DEFAULT_DEVICE = "auto"
MAX_LENGTH = 8192
MIN_SENTENCE_CHARS = 3
EXPECTED_EMBED_DIM = 1024  # BGEM3 dense output size

SENTENCE_SPLIT_PATTERN = re.compile(r"(?<=[\.\!\?\;\:])\s+|(?<=[。！？；：])")


def _parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage A: compute per-sentence embeddings for courses.")
    parser.add_argument(
        "--csv-path",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help="Input CSV with at least 'row_id' and 'text' columns (default: data/courses_scores.csv).",
    )
    parser.add_argument(
        "--meta-path",
        type=Path,
        default=DEFAULT_META_PATH,
        help="Output Parquet path for course metadata (default: data/courses.meta.parquet).",
    )
    parser.add_argument(
        "--sentences-path",
        type=Path,
        default=DEFAULT_SENTENCES_PATH,
        help="Output path for newline-delimited sentences (default: data/sentences.txt).",
    )
    parser.add_argument(
        "--sent-embeddings-path",
        type=Path,
        default=DEFAULT_SENT_EMB_PATH,
        help="Output path for sentence embeddings (.npy, default: data/sentences.embeddings.npy).",
    )
    parser.add_argument(
        "--course-embeddings-path",
        type=Path,
        default=DEFAULT_COURSE_EMB_PATH,
        help="Output path for course embeddings (.npy, default: data/courses.embeddings.npy).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Number of sentences to encode per batch (default: %(default)s).",
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=MAX_LENGTH,
        help="Maximum token length per sentence fed to the model (default: %(default)s).",
    )
    parser.add_argument(
        "--min-sentence-chars",
        type=int,
        default=MIN_SENTENCE_CHARS,
        help="Minimum character length to keep a sentence fragment (default: %(default)s).",
    )
    parser.add_argument(
        "--device",
        type=str,
        choices=["auto", "cpu", "mps", "cuda"],
        default=DEFAULT_DEVICE,
        help="Device to run inference on: auto|cpu|mps|cuda (default: %(default)s).",
    )
    return parser.parse_args(argv)


def _load_rows(csv_path: Path) -> List[dict]:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    rows: List[dict] = []
    extra_columns = False

    with csv_path.open("r", newline="", encoding="utf-8") as fp:
        reader = csv.DictReader(fp)
        fieldnames = list(reader.fieldnames or [])
        if ROW_ID_COLUMN not in fieldnames:
            raise ValueError(f"Missing '{ROW_ID_COLUMN}' column in {csv_path}")
        if TEXT_COLUMN not in fieldnames:
            raise ValueError(f"Missing '{TEXT_COLUMN}' column in {csv_path}")
        extra_columns = any(col not in {ROW_ID_COLUMN, TEXT_COLUMN} for col in fieldnames)
        for row in reader:
            rows.append(
                {
                    ROW_ID_COLUMN: row.get(ROW_ID_COLUMN, ""),
                    TEXT_COLUMN: row.get(TEXT_COLUMN, "") or "",
                }
            )

    if extra_columns:
        print(f"[info] Stripping columns other than '{ROW_ID_COLUMN}' and '{TEXT_COLUMN}' in {csv_path}")
        with csv_path.open("w", newline="", encoding="utf-8") as fp:
            writer = csv.DictWriter(fp, fieldnames=[ROW_ID_COLUMN, TEXT_COLUMN])
            writer.writeheader()
            writer.writerows(rows)
    return rows


def _resolve_device(choice: str) -> str:
    if choice != "auto":
        return choice
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _split_sentences(text: str, min_chars: int) -> List[str]:
    if not text:
        return []
    normalized = _normalize_whitespace(text)
    if not normalized:
        return []
    pieces = SENTENCE_SPLIT_PATTERN.split(normalized)
    sentences: List[str] = []
    for piece in pieces:
        piece = piece.strip()
        if len(piece) >= min_chars:
            sentences.append(piece)
    return sentences


def _encode_sentences(
    model: BGEM3FlagModel,
    sentences: Sequence[str],
    batch_size: int,
    max_length: int,
) -> np.ndarray:
    if not sentences:
        return np.zeros((0, EXPECTED_EMBED_DIM), dtype=np.float32)

    outputs: List[np.ndarray] = []
    total = len(sentences)
    for start in range(0, total, batch_size):
        batch = sentences[start : start + batch_size]
        enc = model.encode(
            batch,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=False,
            max_length=max_length,
        )
        dense = enc["dense_vecs"]
        dense = np.asarray(dense, dtype=np.float32)
        outputs.append(dense)
        print(
            f"[ok] Encoded batch {start // batch_size + 1}/"
            f"{(total + batch_size - 1) // batch_size}"
        )
    matrix = np.vstack(outputs)
    if matrix.shape[1] != EXPECTED_EMBED_DIM:
        raise RuntimeError(
            f"Unexpected embedding dimension {matrix.shape[1]}, expected {EXPECTED_EMBED_DIM}"
        )
    return _l2_normalize(matrix)


def _l2_normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    zero_mask = norms == 0
    norms[zero_mask] = 1.0
    normalized = matrix / norms
    normalized[zero_mask.flatten()] = 0.0
    return normalized.astype(np.float32, copy=False)


def _compute_course_embeddings(
    meta_rows: Sequence[dict],
    sentence_embeddings: np.ndarray,
) -> np.ndarray:
    num_courses = len(meta_rows)
    if sentence_embeddings.size == 0:
        return np.zeros((num_courses, EXPECTED_EMBED_DIM), dtype=np.float32)

    course_emb = np.zeros((num_courses, sentence_embeddings.shape[1]), dtype=np.float32)
    for idx, meta in enumerate(meta_rows):
        offset = int(meta["sentences_offset"])
        count = int(meta["sentences_count"])
        if count <= 0:
            continue
        slice_ = sentence_embeddings[offset : offset + count]
        if slice_.size == 0:
            continue
        mean_vec = slice_.mean(axis=0)
        course_emb[idx] = mean_vec
    return _l2_normalize(course_emb)


def _ensure_parent(path: Path) -> None:
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)


def _write_sentences(sentences: Sequence[str], path: Path) -> None:
    _ensure_parent(path)
    with path.open("w", encoding="utf-8") as fp:
        for sentence in sentences:
            fp.write(sentence)
            fp.write("\n")


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])

    rows = _load_rows(args.csv_path)
    device = _resolve_device(args.device)
    batch_size = max(1, args.batch_size)
    max_length = max(1, args.max_length)
    min_chars = max(0, args.min_sentence_chars)

    meta_rows: List[dict] = []
    all_sentences: List[str] = []
    offset = 0

    for row in rows:
        course_id = row.get(ROW_ID_COLUMN)
        if course_id is None:
            raise ValueError("Encountered row without 'row_id' value.")
        text = row.get(TEXT_COLUMN, "") or ""
        sentences = _split_sentences(text, min_chars=min_chars)
        num_sentences = len(sentences)
        meta_rows.append(
            {
                "id": course_id,
                "num_sentences": num_sentences,
                "sentences_offset": offset,
                "sentences_count": num_sentences,
                "text_chars": len(text),
            }
        )
        offset += num_sentences
        all_sentences.extend(sentences)

    print(
        f"[info] Loaded {len(rows)} courses -> {len(all_sentences)} sentences "
        f"(avg {len(all_sentences) / len(rows) if rows else 0:.2f})."
    )

    print(f"[info] Loading model '{MODEL_NAME}' on {device}...")
    model = BGEM3FlagModel(MODEL_NAME, use_fp16=False, device=device)

    print(f"[info] Encoding {len(all_sentences)} sentences (batch size {batch_size})...")
    sentence_embeddings = _encode_sentences(
        model=model,
        sentences=all_sentences,
        batch_size=batch_size,
        max_length=max_length,
    )

    course_embeddings = _compute_course_embeddings(meta_rows, sentence_embeddings)

    print(f"[info] Writing artifacts to {args.meta_path.parent.resolve()}")
    meta_df = pd.DataFrame(meta_rows)
    _ensure_parent(args.meta_path)
    meta_df.to_parquet(args.meta_path, index=False)

    _write_sentences(all_sentences, args.sentences_path)
    _ensure_parent(args.sent_embeddings_path)
    np.save(args.sent_embeddings_path, sentence_embeddings.astype(np.float32, copy=False))
    _ensure_parent(args.course_embeddings_path)
    np.save(args.course_embeddings_path, course_embeddings.astype(np.float32, copy=False))

    print("[done] Stage A artifacts ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

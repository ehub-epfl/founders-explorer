"""Stage B: score courses against aspect keyword sets using Stage A artifacts."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import numpy as np
import pandas as pd
import torch
from FlagEmbedding import BGEM3FlagModel
try:
    from scipy.stats import norm as _scipy_norm
except ImportError:
    _scipy_norm = None

DEFAULT_DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_META_PATH = DEFAULT_DATA_DIR / "courses.meta.parquet"
DEFAULT_SENTENCES_PATH = DEFAULT_DATA_DIR / "sentences.txt"
DEFAULT_SENT_EMB_PATH = DEFAULT_DATA_DIR / "sentences.embeddings.npy"
DEFAULT_ASPECTS_PATH = DEFAULT_DATA_DIR / "aspects.json"
DEFAULT_OUTPUT_PATH = DEFAULT_DATA_DIR / "courses_scores.parquet"

MODEL_NAME = "BAAI/bge-m3"
DEFAULT_DEVICE = "auto"
DEFAULT_BATCH_SIZE = 64
MAX_LENGTH = 512  # keyword phrases are short; keep encoding efficient
EXPECTED_EMBED_DIM = 1024

DEFAULT_TAU = 0.70
DEFAULT_GAMMA = 0.06
DEFAULT_ALPHA = 0.60
DEFAULT_TOPK_HITS = 5
DEFAULT_HIT_THRESHOLD = 0.5
IGNORED_ASPECTS = {"entrepreneurship_relevance"}
MIN_STD = 1e-6
Z_CDF_CLIP = 3.0
_ERF_VECTOR = None
if _scipy_norm is None:
    _ERF_VECTOR = np.vectorize(math.erf, otypes=[float])


def _gaussian_cdf_from_z(z: np.ndarray) -> np.ndarray:
    clipped = np.clip(z, -Z_CDF_CLIP, Z_CDF_CLIP)
    if _scipy_norm is not None:
        return _scipy_norm.cdf(clipped)
    scaled = clipped / math.sqrt(2.0)
    return 0.5 * (1.0 + _ERF_VECTOR(scaled))


@dataclass(frozen=True)
class KeywordConfig:
    keyword: str
    normalized: str
    vector: np.ndarray
    weight: float


def _parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage B: compute aspect scores from Stage A artifacts.")
    parser.add_argument(
        "--meta-path",
        type=Path,
        default=DEFAULT_META_PATH,
        help="Path to courses.meta.parquet produced by Stage A.",
    )
    parser.add_argument(
        "--sentences-path",
        type=Path,
        default=DEFAULT_SENTENCES_PATH,
        help="Path to sentences.txt produced by Stage A.",
    )
    parser.add_argument(
        "--sent-embeddings-path",
        type=Path,
        default=DEFAULT_SENT_EMB_PATH,
        help="Path to sentences.embeddings.npy produced by Stage A.",
    )
    parser.add_argument(
        "--aspects-path",
        type=Path,
        default=DEFAULT_ASPECTS_PATH,
        help="JSON mapping aspect names to comma-separated keyword strings.",
    )
    parser.add_argument(
        "--output-path",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Where to write the per-aspect scores (Parquet).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Batch size for encoding keywords (default: %(default)s).",
    )
    parser.add_argument(
        "--device",
        type=str,
        choices=["auto", "cpu", "mps", "cuda"],
        default=DEFAULT_DEVICE,
        help="Device for BGEM3 inference (default: %(default)s).",
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=MAX_LENGTH,
        help="Maximum token length when encoding keywords (default: %(default)s).",
    )
    parser.add_argument(
        "--tau",
        type=float,
        default=DEFAULT_TAU,
        help="Soft threshold midpoint for hit activation h_k (default: %(default)s).",
    )
    parser.add_argument(
        "--gamma",
        type=float,
        default=DEFAULT_GAMMA,
        help="Soft threshold slope parameter for h_k (default: %(default)s).",
    )
    parser.add_argument(
        "--alpha",
        type=float,
        default=DEFAULT_ALPHA,
        help="Weight for coverage when combining with quality (default: %(default)s).",
    )
    parser.add_argument(
        "--topk-hits",
        type=int,
        default=DEFAULT_TOPK_HITS,
        help="Maximum number of evidence sentences to return per aspect (default: %(default)s).",
    )
    parser.add_argument(
        "--hit-threshold",
        type=float,
        default=DEFAULT_HIT_THRESHOLD,
        help="Minimum h_k value to treat a keyword as a hit (default: %(default)s).",
    )
    return parser.parse_args(argv)


def _resolve_device(choice: str) -> str:
    if choice != "auto":
        return choice
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _ensure_exists(path: Path, description: str) -> None:
    if not path.exists():
        raise FileNotFoundError(f"{description} not found: {path}")


def _load_meta(meta_path: Path) -> pd.DataFrame:
    _ensure_exists(meta_path, "Meta parquet")
    df = pd.read_parquet(meta_path)
    expected_cols = {"id", "sentences_offset", "sentences_count"}
    missing = expected_cols.difference(df.columns)
    if missing:
        raise ValueError(f"Meta parquet missing columns: {', '.join(sorted(missing))}")
    df = df.sort_values("id").reset_index(drop=True)
    return df


def _load_sentences(sentences_path: Path) -> List[str]:
    _ensure_exists(sentences_path, "Sentences file")
    with sentences_path.open("r", encoding="utf-8") as fp:
        return [line.rstrip("\n") for line in fp]


def _load_sentence_embeddings(path: Path) -> np.ndarray:
    _ensure_exists(path, "Sentence embeddings")
    arr = np.load(path)
    if arr.ndim != 2:
        raise ValueError(f"Sentence embeddings must be 2D, got shape {arr.shape}")
    if arr.shape[1] != EXPECTED_EMBED_DIM:
        raise ValueError(
            f"Expected embedding dim {EXPECTED_EMBED_DIM}, got {arr.shape[1]}"
        )
    return arr.astype(np.float32, copy=False)


def _normalize_keyword(keyword: str) -> str:
    return re.sub(r"\s+", " ", keyword.strip()).lower()


def _parse_aspects(aspects_path: Path) -> Dict[str, List[str]]:
    _ensure_exists(aspects_path, "Aspects JSON")
    with aspects_path.open("r", encoding="utf-8") as fp:
        raw = json.load(fp)
    if not isinstance(raw, dict):
        raise ValueError("Aspects JSON must be an object mapping aspect->keywords.")
    aspects: Dict[str, List[str]] = {}
    for aspect, value in raw.items():
        if isinstance(value, str):
            keywords = [kw.strip() for kw in value.split(",")]
        elif isinstance(value, list):
            keywords = [str(kw).strip() for kw in value]
        else:
            raise ValueError(f"Aspect '{aspect}' must be a string or list, got {type(value)}")
        keywords = [kw for kw in keywords if kw]
        if not keywords:
            raise ValueError(f"Aspect '{aspect}' has no keywords after cleaning.")
        aspects[aspect] = keywords
    return aspects


def _encode_texts(
    model: BGEM3FlagModel, texts: Sequence[str], batch_size: int, max_length: int
) -> np.ndarray:
    if not texts:
        return np.zeros((0, EXPECTED_EMBED_DIM), dtype=np.float32)
    outputs: List[np.ndarray] = []
    total = len(texts)
    for start in range(0, total, batch_size):
        batch = texts[start : start + batch_size]
        enc = model.encode(
            batch,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=False,
            max_length=max_length,
        )
        dense = np.asarray(enc["dense_vecs"], dtype=np.float32)
        outputs.append(dense)
        print(
            f"[ok] Encoded keyword batch {start // batch_size + 1}/"
            f"{(total + batch_size - 1) // batch_size}"
        )
    stacked = np.vstack(outputs)
    if stacked.shape[1] != EXPECTED_EMBED_DIM:
        raise RuntimeError(
            f"Unexpected embedding dimension {stacked.shape[1]}, expected {EXPECTED_EMBED_DIM}"
        )
    return _l2_normalize(stacked)


def _l2_normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    zero_mask = norms == 0
    norms[zero_mask] = 1.0
    normalized = matrix / norms
    normalized[zero_mask.flatten()] = 0.0
    return normalized.astype(np.float32, copy=False)


def _contains_phrase(text: str, phrase: str, pattern_cache: Dict[str, re.Pattern]) -> bool:
    if not phrase:
        return False
    pattern = pattern_cache.get(phrase)
    if pattern is None:
        pattern = re.compile(rf"(?<!\w){re.escape(phrase)}(?!\w)")
        pattern_cache[phrase] = pattern
    return bool(pattern.search(text))


def _build_course_texts(
    meta: pd.DataFrame,
    sentences: Sequence[str],
) -> tuple[List[str], List[set[str]]]:
    texts: List[str] = []
    token_sets: List[set[str]] = []
    token_pattern = re.compile(r"\b[\w\-']+\b")
    for _, row in meta.iterrows():
        start = int(row["sentences_offset"])
        count = int(row["sentences_count"])
        if count <= 0:
            texts.append("")
            token_sets.append(set())
            continue
        segment = sentences[start : start + count]
        joined = " ".join(segment)
        normalized = re.sub(r"\s+", " ", joined).strip().lower()
        texts.append(normalized)
        tokens = set(token_pattern.findall(normalized))
        token_sets.append(tokens)
    return texts, token_sets


def _compute_token_df(token_sets: Sequence[set[str]]) -> Dict[str, int]:
    df: Dict[str, int] = {}
    for token_set in token_sets:
        for token in token_set:
            df[token] = df.get(token, 0) + 1
    return df


def _compute_keyword_weights(
    aspects: Dict[str, List[str]],
    course_texts: Sequence[str],
    token_sets: Sequence[set[str]],
) -> Dict[str, Dict[str, float]]:
    num_courses = len(course_texts)
    token_df = _compute_token_df(token_sets)
    pattern_cache: Dict[str, re.Pattern] = {}
    weights: Dict[str, Dict[str, float]] = {}

    for aspect, keywords in aspects.items():
        kw_weights: Dict[str, float] = {}
        for keyword in keywords:
            normalized = _normalize_keyword(keyword)
            doc_freq = sum(
                1 for text in course_texts if _contains_phrase(text, normalized, pattern_cache)
            )
            if doc_freq > 0:
                idf = math.log((num_courses + 1) / (doc_freq + 1)) + 1.0
            else:
                tokens = re.findall(r"\b[\w\-']+\b", normalized)
                if tokens:
                    sub_idfs = []
                    for token in tokens:
                        sub_df = token_df.get(token, 0)
                        sub_idf = math.log((num_courses + 1) / (sub_df + 1)) + 1.0
                        sub_idfs.append(sub_idf)
                    idf = float(sum(sub_idfs) / len(sub_idfs))
                else:
                    idf = math.log(num_courses + 1) + 1.0
            kw_weights[keyword] = idf
        total = sum(kw_weights.values())
        if total <= 0:
            uniform = 1.0 / len(kw_weights)
            kw_weights = {kw: uniform for kw in kw_weights}
        else:
            kw_weights = {kw: weight / total for kw, weight in kw_weights.items()}
        weights[aspect] = kw_weights
    return weights


def _prepare_keyword_configs(
    aspects: Dict[str, List[str]],
    keyword_weights: Dict[str, Dict[str, float]],
    keyword_vectors: Dict[str, np.ndarray],
) -> Dict[str, List[KeywordConfig]]:
    configs: Dict[str, List[KeywordConfig]] = {}
    for aspect, keywords in aspects.items():
        aspect_configs: List[KeywordConfig] = []
        for keyword in keywords:
            vector = keyword_vectors.get(keyword)
            if vector is None:
                raise KeyError(f"Missing embedding for keyword '{keyword}'")
            weight = keyword_weights[aspect][keyword]
            aspect_configs.append(
                KeywordConfig(
                    keyword=keyword,
                    normalized=_normalize_keyword(keyword),
                    vector=vector,
                    weight=weight,
                )
            )
        configs[aspect] = aspect_configs
    return configs


def _collect_keyword_embeddings(
    aspects: Dict[str, List[str]],
    model: BGEM3FlagModel,
    batch_size: int,
    max_length: int,
) -> Dict[str, np.ndarray]:
    unique_keywords = []
    seen = set()
    for keywords in aspects.values():
        for keyword in keywords:
            if keyword not in seen:
                unique_keywords.append(keyword)
                seen.add(keyword)
    if not unique_keywords:
        return {}
    vectors = _encode_texts(model, unique_keywords, batch_size=batch_size, max_length=max_length)
    return {keyword: vectors[idx] for idx, keyword in enumerate(unique_keywords)}


def _score_course_aspect(
    sentence_embeddings: np.ndarray,
    sentence_offset: int,
    course_sentences: Sequence[str],
    configs: Sequence[KeywordConfig],
    tau: float,
    gamma: float,
    alpha: float,
    topk_hits: int,
    hit_threshold: float,
) -> dict:
    num_keywords = len(configs)
    weights = np.array([cfg.weight for cfg in configs], dtype=np.float32)
    if sentence_embeddings.size == 0 or num_keywords == 0:
        return {
            "coverage": 0.0,
            "quality": 0.0,
            "score": 0.0,
            "keyword_scores": [],
            "evidence": [],
        }

    keyword_matrix = np.stack([cfg.vector for cfg in configs], axis=0)
    sim = sentence_embeddings @ keyword_matrix.T  # shape (num_sentences, num_keywords)
    if sim.size == 0:
        s_k = np.full(num_keywords, -1.0, dtype=np.float32)
        argmax_indices = np.full(num_keywords, -1, dtype=np.int32)
    else:
        argmax_indices = np.argmax(sim, axis=0).astype(np.int32)
        s_k = sim[argmax_indices, np.arange(num_keywords)]

    if gamma <= 0:
        raise ValueError("gamma must be positive")
    h_k = 1.0 / (1.0 + np.exp(-(s_k - tau) / gamma))
    s_01 = (s_k + 1.0) / 2.0

    weighted_hits = weights * h_k
    coverage = float(np.sum(weighted_hits))
    denom = float(np.sum(weighted_hits)) + 1e-8
    quality = float(np.sum(weighted_hits * s_01) / denom) if denom > 0 else 0.0
    score = float(alpha * coverage + (1.0 - alpha) * quality)

    keyword_scores = []
    for idx, cfg in enumerate(configs):
        local_idx = int(argmax_indices[idx]) if argmax_indices[idx] >= 0 else None
        global_idx = sentence_offset + local_idx if local_idx is not None else None
        keyword_scores.append(
            {
                "keyword": cfg.keyword,
                "weight": float(cfg.weight),
                "cosine": float(s_k[idx]),
                "hit": float(h_k[idx]),
                "sentence_local_index": local_idx,
                "sentence_global_index": global_idx,
            }
        )

    evidence_candidates = [
        (idx, h_val)
        for idx, h_val in enumerate(h_k)
        if h_val > hit_threshold and argmax_indices[idx] >= 0
    ]
    evidence_candidates.sort(key=lambda item: item[1], reverse=True)
    evidence = []
    for idx, _ in evidence_candidates[:topk_hits]:
        local_idx = int(argmax_indices[idx])
        sentence_text = course_sentences[local_idx]
        evidence.append(
            {
                "keyword": configs[idx].keyword,
                "cosine": float(s_k[idx]),
                "hit": float(h_k[idx]),
                "sentence_local_index": local_idx,
                "sentence_global_index": sentence_offset + local_idx,
                "sentence": sentence_text,
            }
        )

    return {
        "coverage": coverage,
        "quality": quality,
        "score": score,
        "keyword_scores": keyword_scores,
        "evidence": evidence,
    }


def _ensure_parent(path: Path) -> None:
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    meta = _load_meta(args.meta_path)
    sentences = _load_sentences(args.sentences_path)
    sentence_embeddings = _load_sentence_embeddings(args.sent_embeddings_path)

    if len(sentences) != sentence_embeddings.shape[0]:
        raise ValueError(
            f"Sentence text count ({len(sentences)}) "
            f"does not match embeddings ({sentence_embeddings.shape[0]} rows)."
        )

    aspects = _parse_aspects(args.aspects_path)
    ignored = [name for name in aspects if name in IGNORED_ASPECTS]
    for name in ignored:
        aspects.pop(name, None)
    if ignored:
        ignored_list = ", ".join(sorted(ignored))
        print(f"[info] Skipping aspects reserved for user input: {ignored_list}")
    print(f"[info] Loaded {len(aspects)} aspects.")

    course_texts, token_sets = _build_course_texts(meta, sentences)
    keyword_weights = _compute_keyword_weights(aspects, course_texts, token_sets)

    device = _resolve_device(args.device)
    print(f"[info] Loading model '{MODEL_NAME}' on {device}...")
    model = BGEM3FlagModel(MODEL_NAME, use_fp16=False, device=device)

    print("[info] Encoding keywords...")
    keyword_vectors = _collect_keyword_embeddings(
        aspects,
        model=model,
        batch_size=max(1, args.batch_size),
        max_length=max(1, args.max_length),
    )

    configs = _prepare_keyword_configs(aspects, keyword_weights, keyword_vectors)

    records: List[dict] = []
    for idx, row in meta.iterrows():
        course_id = row["id"]
        start = int(row["sentences_offset"])
        count = int(row["sentences_count"])
        course_sentences = sentences[start : start + count]
        embedded_sentences = sentence_embeddings[start : start + count]
        for aspect, aspect_configs in configs.items():
            result = _score_course_aspect(
                sentence_embeddings=embedded_sentences,
                sentence_offset=start,
                course_sentences=course_sentences,
                configs=aspect_configs,
                tau=float(args.tau),
                gamma=float(args.gamma),
                alpha=float(args.alpha),
                topk_hits=int(args.topk_hits),
                hit_threshold=float(args.hit_threshold),
            )
            records.append(
                {
                    "course_id": course_id,
                    "aspect": aspect,
                    "coverage": result["coverage"],
                    "quality": result["quality"],
                    "score": result["score"],
                    "num_sentences": count,
                    "num_keywords": len(aspect_configs),
                    "keyword_scores": json.dumps(result["keyword_scores"], ensure_ascii=False),
                    "evidence": json.dumps(result["evidence"], ensure_ascii=False),
                }
            )

    df = pd.DataFrame.from_records(records)
    if not df.empty:
        for column in ("coverage", "quality", "score"):
            col = df[column]
            mu = col.mean()
            sd = float(col.std(ddof=0))
            if pd.isna(mu) or pd.isna(sd):
                continue
            if sd < MIN_STD or np.isclose(sd, 0.0):
                df[column] = 0.5
            else:
                z = (col - mu) / sd
                df[column] = _gaussian_cdf_from_z(z.to_numpy(dtype=np.float64))
    _ensure_parent(args.output_path)
    df.to_parquet(args.output_path, index=False)
    print(f"[done] Wrote per-aspect scores to {args.output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


def _sigmoid(scores: np.ndarray, tau: float) -> np.ndarray:
    scaled = scores / tau
    return 1.0 / (1.0 + np.exp(-scaled))


def _ensure_fieldnames(fieldnames: List[str], extra: Sequence[str]) -> List[str]:
    for col in extra:
        if col not in fieldnames:
            fieldnames.append(col)
    return fieldnames


def _write_rows(csv_path: Path, rows: List[dict], fieldnames: List[str]) -> None:
    with csv_path.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _load_biases(bias_path: Path | None) -> dict[str, float]:
    if not bias_path:
        return {}
    if not bias_path.exists():
        raise FileNotFoundError(f"Bias JSON not found: {bias_path}")
    with bias_path.open("r", encoding="utf-8") as fp:
        data = json.load(fp)
    if not isinstance(data, dict):
        raise ValueError("Bias JSON must be an object mapping label->bias float")
    out: dict[str, float] = {}
    for label, _ in ASPECT_CONFIG:
        val = data.get(label, 0.0)
        try:
            out[label] = float(val)
        except Exception as e:
            raise ValueError(f"Bias for label '{label}' must be a float, got {val!r}") from e
    return out


def _apply_calibration(raw: np.ndarray, mode: str) -> tuple[np.ndarray, dict]:
    if mode == "none":
        return raw, {"type": "none"}
    if mode == "zscore":
        mu = raw.mean(axis=0, keepdims=True)
        sd = raw.std(axis=0, keepdims=True)
        sd[sd == 0] = 1.0
        adj = (raw - mu) / sd
        return adj, {"type": "zscore", "mean": mu.squeeze().tolist(), "std": sd.squeeze().tolist()}
    if mode == "minmax":
        mn = raw.min(axis=0, keepdims=True)
        mx = raw.max(axis=0, keepdims=True)
        denom = (mx - mn)
        denom[denom == 0] = 1.0
        adj = (raw - mn) / denom
        # scale to roughly center at 0 using affine map to [-1,1]
        adj = adj * 2.0 - 1.0
        return adj, {"type": "minmax", "min": mn.squeeze().tolist(), "max": mx.squeeze().tolist()}
    raise ValueError(f"Unknown calibration mode: {mode}")


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    csv_path = args.csv_path
    aspects_path = args.aspects_path
    batch_size = max(1, args.batch_size)
    tau = float(args.tau)
    max_length = max(1, args.max_length)
    mode = args.mode
    calib_mode = args.calibrate
    bias_map = _load_biases(args.bias_json)

    rows, fieldnames = _load_rows(csv_path)
    if EMBEDDING_COLUMN not in fieldnames:
        fieldnames.append(EMBEDDING_COLUMN)

    aspect_texts = _load_aspects(aspects_path)
    device = _resolve_device(args.device)
    print(f"[info] Loading model '{MODEL_NAME}' on {device}...")
    model = BGEM3FlagModel(MODEL_NAME, use_fp16=False, device=device)

    print("[info] Encoding aspect texts...")
    aspect_vectors = _encode_texts(model, aspect_texts, batch_size=4, max_length=max_length)
    if aspect_vectors.shape[0] != len(ASPECT_CONFIG):
        raise RuntimeError("Aspect encoding failed: unexpected shape")

    course_vectors: List[np.ndarray | None] = [None] * len(rows)
    missing_indices: List[int] = []
    missing_texts: List[str] = []

    for idx, row in enumerate(rows):
        emb = _parse_embedding(row.get(EMBEDDING_COLUMN))
        if emb is None:
            missing_indices.append(idx)
            missing_texts.append(row.get(TEXT_COLUMN, "") or "")
        else:
            course_vectors[idx] = emb

    if missing_indices:
        print(f"[info] Encoding {len(missing_indices)} course texts missing embeddings...")
        new_embs = _encode_texts(model, missing_texts, batch_size=batch_size, max_length=max_length)
        for idx, emb in zip(missing_indices, new_embs):
            course_vectors[idx] = emb
            rows[idx][EMBEDDING_COLUMN] = json.dumps(emb.tolist(), ensure_ascii=False, separators=(",", ":"))

    if any(vec is None for vec in course_vectors):
        raise RuntimeError("Some course embeddings are still missing after encoding.")

    course_matrix = np.vstack([vec for vec in course_vectors if vec is not None])
    course_matrix = _normalize_rows(course_matrix)
    aspect_matrix = _normalize_rows(aspect_vectors)

    raw_scores = course_matrix @ aspect_matrix.T

    # subtract per-aspect biases if provided
    if bias_map:
        bias_vec = np.array([bias_map[label] for label, _ in ASPECT_CONFIG], dtype=np.float32)
        raw_scores = raw_scores - bias_vec[None, :]

    # apply calibration over the dataset if requested
    cal_scores, cal_stats = _apply_calibration(raw_scores, calib_mode)

    if mode == "single":
        softmax_scores = _softmax(cal_scores, tau)
        sigmoid_scores = None
    else:  # multi
        softmax_scores = None
        sigmoid_scores = _sigmoid(cal_scores, tau)

    new_columns = []
    if mode == "single":
        for label, _ in ASPECT_CONFIG:
            new_columns.extend([
                f"score_{label}_cos",
                f"score_{label}",  # softmax
            ])
    else:  # multi
        for label, _ in ASPECT_CONFIG:
            new_columns.extend([
                f"score_{label}_cos",
                f"score_{label}_sigmoid",
            ])

    fieldnames = _ensure_fieldnames(fieldnames, new_columns)

    for idx, row in enumerate(rows):
        raw = raw_scores[idx]
        cal = cal_scores[idx]
        if mode == "single":
            soft = _softmax(cal[np.newaxis, :], tau)[0]
            for aspect_idx, (label, _) in enumerate(ASPECT_CONFIG):
                row[f"score_{label}_cos"] = float(raw[aspect_idx])
                row[f"score_{label}"] = float(soft[aspect_idx])
        else:  # multi
            sig = _sigmoid(cal[np.newaxis, :], tau)[0]
            for aspect_idx, (label, _) in enumerate(ASPECT_CONFIG):
                row[f"score_{label}_cos"] = float(raw[aspect_idx])
                row[f"score_{label}_sigmoid"] = float(sig[aspect_idx])

    _write_rows(csv_path, rows, fieldnames)
    if calib_mode != "none":
        print(f"[info] Applied calibration: {cal_stats.get('type')}.")
    print(f"[done] Updated {csv_path} with aspect scores using tau={tau}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

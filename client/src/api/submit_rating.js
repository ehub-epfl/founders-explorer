/****
 * src/api/submit_rating.js
 * submit_rating.js
 * Client-side helper for submitting anonymous course ratings.
 *
 * This module calls a Cloudflare Pages Function endpoint (same-origin)
 * which then writes to Supabase using a Service Role key (kept server-side).
 *
 * Default endpoint: "/api/submit-rating".
 * You can override via Vite env: VITE_SUBMIT_RATING_URL.
 *
 * Example usage:
 *   import { submitCourseRating } from '@/api/submit_rating';
 *   await submitCourseRating({
 *     course_code: 'CS101',
 *     course_id: '12345',
 *     score_relevance: 75,
 *     score_skills: 90,
 *     score_product: 74,
 *     score_venture: 100,
 *     score_foundations: 84,
 *   });
 */

const DEFAULT_ENDPOINT = '/api/submit-rating';
const ENDPOINT = import.meta?.env?.VITE_SUBMIT_RATING_URL || DEFAULT_ENDPOINT;

/**
 * Simple range check (inclusive)
 */
function inRange(n, min, max) {
  return typeof n === 'number' && !Number.isNaN(n) && n >= min && n <= max;
}

/**
 * Round scores to whole numbers
 */
function roundScore(n) {
  return Math.round(n);
}

/**
 * Validate inputs and return a normalized payload
 * @param {object} params
 * @param {string} params.course_code
 * @param {string} params.course_id
 * @param {number} params.score_relevance
 * @param {number} params.score_skills
 * @param {number} params.score_product
 * @param {number} params.score_venture
 * @param {number} params.score_foundations
 * @param {string} [params.turnstileToken]  // optional, if you enable Cloudflare Turnstile
 * @returns {{course_code:string, course_id:string, score_relevance:number, score_skills:number, score_product:number, score_venture:number, score_foundations:number, turnstileToken?:string}}
 */
function buildPayload({ course_code, course_id, score_relevance, score_skills, score_product, score_venture, score_foundations, turnstileToken }) {
  const normalizedCode = typeof course_code === 'string' ? course_code.trim() : String(course_code ?? '').trim()
  if (!normalizedCode) {
    throw new Error('course_code is required');
  }

  const normalizedId = String(course_id ?? '').trim()
  if (!normalizedId) {
    throw new Error('course_id is required');
  }
  const scores = [score_relevance, score_skills, score_product, score_venture, score_foundations];
  if (scores.some((s) => !inRange(s, 0, 100))) {
    throw new Error('score_relevance, score_skills, score_product, score_venture, and score_foundations must be numbers between 0 and 100');
  }
  return {
    course_code: normalizedCode,
    course_id: normalizedId,
    score_relevance: roundScore(score_relevance),
    score_skills: roundScore(score_skills),
    score_product: roundScore(score_product),
    score_venture: roundScore(score_venture),
    score_foundations: roundScore(score_foundations),
    ...(turnstileToken ? { turnstileToken } : {}),
  };
}

/**
 * Submit a course rating to the Pages Function.
 *
 * @param {object} params - see buildPayload for fields
 * @param {AbortSignal} [options.signal] - optional AbortSignal to cancel
 * @param {number} [options.timeoutMs=10000] - request timeout in ms
 * @returns {Promise<{ok:true}>}
 */
export async function submitCourseRating(params, options = {}) {
  const payload = buildPayload(params);

  // Support manual abort + a simple timeout
  const controller = new AbortController();
  const { signal } = controller;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10000;
  const timeoutId = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal || signal,
      // Credentials not needed for anon; same-origin default is fine
    });

    let data = null;
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      data = await res.json();
    } else {
      // Fallback for non-JSON errors
      data = { error: await res.text().catch(() => 'unknown error') };
    }

    if (!res.ok) {
      throw new Error(data?.error || `Submit failed (${res.status})`);
    }

    // Expect { ok: true }
    if (data && data.ok) return data;
    return { ok: true };
  } finally {
    clearTimeout(timeoutId);
  }
}

export default submitCourseRating;

// functions/api/submit-rating.ts
// Cloudflare Pages Function: /api/submit-rating
// Receives anonymous course ratings and writes to Supabase via REST.
// Expected JSON body:
// {
//   course_code: string,
//   course_id: string,
//   score_relevance: number (0..1),
//   score_skills: number (0..1),
//   score_product: number (0..1),
//   score_venture: number (0..1),
//   score_foundations: number (0..1),
//   turnstileToken?: string // optional if you enable Turnstile
// }

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Optional: uncomment if you enable Turnstile later
  // TURNSTILE_SECRET: string;
}

// CORS preflight (kept permissive for preview/custom domains). Since this is same-origin on Pages,
// fetch('/api/submit-rating') usually doesn't need CORS, but we include it for safety.
export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  const origin = request.headers.get('Origin') || '';
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Vary': 'Origin',
    },
  });
};

function inRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && !Number.isNaN(n) && n >= min && n <= max;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin') || '';
  const cors = (init: ResponseInit = {}, body?: BodyInit) =>
    new Response(body ?? null, {
      ...init,
      headers: new Headers({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Vary': 'Origin',
        ...(init.headers || {}),
      }),
    });

  try {
    const json = await request.json().catch(() => null);
    if (!json || typeof json !== 'object') {
      return cors({ status: 400 }, JSON.stringify({ error: 'invalid JSON' }));
    }

    const {
      course_code,
      course_id,
      score_relevance,
      score_skills,
      score_product,
      score_venture,
      score_foundations,
      // turnstileToken,
    } = json as Record<string, unknown>;

    if (!course_code || typeof course_code !== 'string') {
      return cors({ status: 400 }, JSON.stringify({ error: 'course_code is required (string)' }));
    }
    if (!course_id || typeof course_id !== 'string') {
      return cors({ status: 400 }, JSON.stringify({ error: 'course_id is required (string)' }));
    }

    const scores = [score_relevance, score_skills, score_product, score_venture, score_foundations];
    if (scores.some((s) => !inRange(s, 0, 1))) {
      return cors(
        { status: 400 },
        JSON.stringify({ error: 'scores must be numbers between 0 and 1: score_relevance, score_skills, score_product, score_venture, score_foundations' })
      );
    }

    // Optional Turnstile verification:
    // if (env.TURNSTILE_SECRET) { /* verify token here */ }

    // Optional: anonymize IP & capture UA
    const ip = request.headers.get('CF-Connecting-IP') || '';
    const ua = request.headers.get('User-Agent') || '';
    const ip_hash = ip
      ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : null;

    const SUPABASE_URL = env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return cors({ status: 500 }, JSON.stringify({ error: 'server not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }));
    }

    // Insert into Supabase (table: course_ratings)
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/course_ratings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal', // switch to representation to return row
      },
      body: JSON.stringify({
        course_code: (course_code as string).trim(),
        course_id: String(course_id).trim(),
        score_relevance: round2(score_relevance as number),
        score_skills: round2(score_skills as number),
        score_product: round2(score_product as number),
        score_venture: round2(score_venture as number),
        score_foundations: round2(score_foundations as number),
        ip_hash,
        ua,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return cors({ status: resp.status }, JSON.stringify({ error: txt }));
    }

    return cors({ status: 200 }, JSON.stringify({ ok: true }));
  } catch (e: any) {
    return cors({ status: 500 }, JSON.stringify({ error: e?.message ?? 'server error' }));
  }
};

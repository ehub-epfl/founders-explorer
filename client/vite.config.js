import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PUBLIC_SUPABASE_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']

export default defineConfig(async ({ mode }) => {
  const rawDevVars = loadDevVars()
  const publicDevVars = pick(rawDevVars, PUBLIC_SUPABASE_KEYS)
  const needsFallback = PUBLIC_SUPABASE_KEYS.some((key) => !process.env[key] && publicDevVars[key])

  if (needsFallback) {
    injectIntoProcess(publicDevVars)
  }

  if (mode === 'development') {
    await printSupabaseSnapshot(publicDevVars)
  }

  const server =
    mode === 'development'
      ? {
          proxy: {
            // Proxy Cloudflare Pages Functions during local dev so POSTs hit wrangler
            '/api/submit-rating': {
              target: process.env.PAGES_DEV_ORIGIN || 'http://127.0.0.1:8788',
              changeOrigin: true,
            },
          },
        }
      : undefined

  return {
    envPrefix: 'SUPABASE_',
    define: {
      __SUPABASE_DEV_VARS__: JSON.stringify(publicDevVars),
    },
    plugins: [react()],
    ...(server ? { server } : {}),
  }
})

function loadDevVars() {
  const filePath = resolve(process.cwd(), '.dev.vars')
  if (!existsSync(filePath)) return {}

  const vars = {}
  const contents = readFileSync(filePath, 'utf8')
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    const value = stripQuotes(line.slice(eqIdx + 1).trim())
    if (key) vars[key] = value
  }
  return vars
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1)
  }
  return value
}

function injectIntoProcess(vars) {
  for (const [key, value] of Object.entries(vars)) {
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function pick(source, keys) {
  const out = {}
  for (const key of keys) {
    if (key in source) out[key] = source[key]
  }
  return out
}

async function printSupabaseSnapshot(vars) {
  const url = vars.SUPABASE_URL
  const anonKey = vars.SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    console.warn('[supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY; skipping snapshot')
    return
  }

  try {
    const endpoint = new URL('/rest/v1/courses_search_view', url.replace(/\/$/, ''))
    endpoint.searchParams.set('select', '*')

    const response = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    })

    if (!response.ok) {
      const errText = await safeReadText(response)
      console.error(`[supabase] Snapshot fetch failed: HTTP ${response.status} ${response.statusText}${errText ? ` - ${errText}` : ''}`)
      return
    }

    const data = await response.json()
    const total = Array.isArray(data) ? data.length : 0
    console.log(`[supabase] Retrieved ${total} rows from courses_search_view`)
    console.log(JSON.stringify(data, null, 2))
  } catch (err) {
    console.error('[supabase] Snapshot fetch threw an error:', err?.message || err)
  }
}

async function safeReadText(response) {
  try {
    return await response.text()
  } catch (err) {
    return ''
  }
}

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

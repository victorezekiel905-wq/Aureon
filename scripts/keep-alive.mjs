#!/usr/bin/env node
/**
 * Aureon · Supabase keep-alive
 * ---------------------------------------------------------------------------
 * Free Supabase projects are paused after a period of inactivity. This script
 * performs a real database write (public.ping() updates a heartbeat row) plus a
 * read, which counts as genuine project activity.
 *
 *   node scripts/keep-alive.mjs            # ping once (used by GitHub Actions every 6 hours)
 *   node scripts/keep-alive.mjs --loop     # keep running and ping every 6 hours
 *
 * Credentials (first match wins):
 *   1. env SUPABASE_URL + SUPABASE_ANON_KEY   (GitHub repository secrets)
 *   2. assets/js/config.js                    (the values the website already uses)
 *
 * Only the public anon/publishable key is needed. Requires Node 18+ (built-in fetch).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const here = dirname(fileURLToPath(import.meta.url));

function fromConfigFile() {
  try {
    const src = readFileSync(join(here, '..', 'assets', 'js', 'config.js'), 'utf8');
    const pick = (k) => (src.match(new RegExp(k + "\\s*:\\s*['\"]([^'\"]*)['\"]")) || [])[1] || '';
    return { url: pick('supabaseUrl'), key: pick('supabaseAnonKey') };
  } catch {
    return { url: '', key: '' };
  }
}

function credentials() {
  const file = fromConfigFile();
  const url = (process.env.SUPABASE_URL || '').trim() || file.url;
  const key = (process.env.SUPABASE_ANON_KEY || '').trim() || file.key;
  if (!url || !key) {
    throw new Error('No Supabase credentials. Set SUPABASE_URL and SUPABASE_ANON_KEY, or fill in assets/js/config.js.');
  }
  return { url: url.replace(/\/+$/, ''), key };
}

function headers(key) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  // Legacy anon keys are JWTs and also go in Authorization; new sb_publishable_ keys must not.
  if (!key.startsWith('sb_')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function request(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function pingOnce() {
  const { url, key } = credentials();
  const source = process.env.GITHUB_ACTIONS ? 'github-actions' : 'keep-alive-script';
  // 1) write: bumps the heartbeat row
  const ping = await request(`${url}/rest/v1/rpc/ping`, { method: 'POST', headers: headers(key), body: JSON.stringify({ p_source: source }) });
  // 2) read: a normal table query
  const rates = await request(`${url}/rest/v1/fx_rates?select=currency&limit=1`, { headers: headers(key) });
  return { ping, readRows: Array.isArray(rates) ? rates.length : 0 };
}

async function withRetry(fn, attempts = 4) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      // a paused project can take a minute to wake up — back off and retry
      const wait = Math.min(60000, 5000 * 2 ** (i - 1));
      console.warn(`[keep-alive] attempt ${i}/${attempts} failed: ${e.message}${i < attempts ? ` — retrying in ${wait / 1000}s` : ''}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

async function run() {
  const started = new Date().toISOString();
  const result = await withRetry(pingOnce);
  console.log(`[keep-alive] ${started} OK — heartbeat #${result.ping?.ping_count ?? '?'} at ${result.ping?.last_ping ?? '?'}, read ${result.readRows} row(s)`);
}

if (process.argv.includes('--loop')) {
  console.log('[keep-alive] loop mode: pinging now and every 6 hours. Press Ctrl+C to stop.');
  const tick = () => run().catch((e) => console.error(`[keep-alive] FAILED: ${e.message}`));
  await tick();
  setInterval(tick, SIX_HOURS);
} else {
  run().catch((e) => {
    console.error(`[keep-alive] FAILED: ${e.message}`);
    process.exit(1);   // a red run makes GitHub email you
  });
}

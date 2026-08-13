// Shared HTTP helpers: paced fetching (>=800ms between calls), timeout,
// retry-once on 429/5xx, a tiny TTL cache, a quoted-field CSV parser and
// cross-source name normalization.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const MIN_GAP_MS = 800;
const TIMEOUT_MS = 15000;

let lastFetchAt = 0;
let queue: Promise<void> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serialize calls with a minimum gap between network requests. */
export async function pacedFetch(
  url: string,
  opts: RequestInit = {},
  gapMs: number = MIN_GAP_MS
): Promise<Response> {
  const prev = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => (release = r));
  await prev;
  try {
    const wait = lastFetchAt + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
  } finally {
    release();
  }

  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json, text/csv, */*',
  };
  if (opts.headers) Object.assign(headers, opts.headers as Record<string, string>);

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onOuterAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', onOuterAbort);
    }
    try {
      const res = await fetch(url, { ...opts, headers, signal: controller.signal });
      lastFetchAt = Date.now();
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await sleep(1200);
        continue;
      }
      return res;
    } catch (e) {
      lastFetchAt = Date.now();
      lastErr = e;
      if (attempt === 0 && !controller.signal.aborted) {
        await sleep(1200);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onOuterAbort);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`fetch failed: ${url}`);
}

/** GET + JSON, throws on non-2xx. */
export async function fetchJson(url: string, opts: RequestInit = {}): Promise<any> {
  const res = await pacedFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// --- tiny TTL cache ---------------------------------------------------------

const cache = new Map<string, { at: number; value: any }>();

export function cacheGet<T>(key: string, ttlMs: number): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlMs) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet(key: string, value: any): void {
  cache.set(key, { at: Date.now(), value });
}

// --- CSV parsing ------------------------------------------------------------

/** Parse CSV text with quoted fields (quotes, commas and newlines inside
 *  double quotes; "" escapes a quote). Returns rows as string arrays. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/^\uFEFF/, ''); // strip BOM
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

// --- name normalization ------------------------------------------------------

/** lowercase, non-alphanumerics -> space, collapse whitespace, trim.
 *  Stripping would break hyphenated names ("Gilgeous-Alexander"). */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function round(n: number, digits = 2): number {
  if (!isFinite(n)) return n;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

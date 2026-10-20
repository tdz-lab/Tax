// Relay for the in-app "Get exchange rates" button. A web page cannot read the RBA file or the CoinGecko API
// directly (browsers block cross-site reads), so the local server fetches them on the page's behalf.
// Only these two fixed addresses can be reached; nothing about your records is sent — just a coin name and a
// date range for CoinGecko. Runs only when you press the button.
// Node.js built-ins only (global fetch, Node 18+).

const RBA_F11_URL = 'https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const TIMEOUT_MS = 30_000;

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(body);
}

async function relay(res, url, headers = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'AU-Tax-Trading-Ledger (local app)', ...headers }, signal: ctl.signal });
    const text = await r.text();
    send(res, r.ok ? 200 : 502, r.ok ? text : `The source answered ${r.status}: ${text.slice(0, 300)}`, r.ok ? r.headers.get('content-type') ?? 'text/plain' : 'text/plain; charset=utf-8');
  } catch (e) {
    send(res, 502, `Could not reach ${new URL(url).host}: ${e?.name === 'AbortError' ? 'timed out' : e?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Handles /__rates/* requests. Returns true when the request was handled. */
export async function handleRatesRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/__rates/')) return false;
  if (req.method !== 'GET') {
    send(res, 405, 'Method not allowed');
    return true;
  }
  if (url.pathname === '/__rates/ping') {
    send(res, 200, 'ok');
    return true;
  }
  if (url.pathname === '/__rates/rba-f11') {
    await relay(res, RBA_F11_URL);
    return true;
  }
  if (url.pathname === '/__rates/coingecko') {
    const id = url.searchParams.get('id') ?? '';
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (!/^[a-z0-9-]{1,80}$/.test(id) || !/^\d{9,11}$/.test(from) || !/^\d{9,11}$/.test(to)) {
      send(res, 400, 'Bad request');
      return true;
    }
    const key = String(req.headers['x-coingecko-key'] ?? '');
    if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
      send(res, 400, 'That CoinGecko key does not look right.');
      return true;
    }
    const target = `${COINGECKO_BASE}/coins/${id}/market_chart/range?vs_currency=aud&from=${from}&to=${to}`;
    await relay(res, target, key ? { 'x-cg-demo-api-key': key } : {});
    return true;
  }
  send(res, 404, 'Not found');
  return true;
}

/** Vite plugin so `npm run dev` / `npm run preview` behave like the start scripts. */
export function ratesProxyPlugin() {
  const mw = (req, res, next) => {
    handleRatesRequest(req, res).then((handled) => handled || next(), next);
  };
  return {
    name: 'rates-proxy',
    configureServer(server) {
      server.middlewares.use(mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw);
    }
  };
}

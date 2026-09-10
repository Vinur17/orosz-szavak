// Standalone "Russian words" browser — a copy of Languru's Words tab, but for
// Russian (learned) → Hungarian (native). Runs on its OWN localhost port, fully
// separate from the Languru app. The word list is a static file (data.js).
//
// AI grammar details ("Tudj meg többet"): POST /api/details asks OpenAI for the
// conjugation / past / government / grammar / nuance of one word. Results are
// cached to details-cache.json so each word is fetched only once (offline after).
// The API key is read from the OPENAI_API_KEY environment variable — never stored
// in code. Set it before start:  OPENAI_API_KEY=sk-...  (PowerShell: $env:OPENAI_API_KEY="sk-...")

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4300;
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CACHE_FILE = join(DIR, 'details-cache.json');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// ---- details cache (disk) --------------------------------------------------
let CACHE = {};
try { CACHE = JSON.parse(await readFile(CACHE_FILE, 'utf8')); } catch { CACHE = {}; }
let saveTimer = null;
function saveCacheSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { writeFile(CACHE_FILE, JSON.stringify(CACHE, null, 1), 'utf8').catch(() => {}); }, 300);
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  });
}

// Ask OpenAI for the grammar details of one word. Returns the parsed object.
async function fetchDetails(w) {
  const sys = 'Orosz nyelvtani segéd vagy magyar anyanyelvűeknek. Tömören, csak magyarul írsz. '
    + 'Minden orosz szónál KÖTELEZŐ kitenni a hangsúlyt: a hangsúlyos magánhangzó után tedd a combining acute ékezetet (U+0301), pl. "рабо́та". '
    + 'A ё mindig hangsúlyos, arra nem kell külön jel. A válasz KIZÁRÓLAG egyetlen JSON objektum.';
  const user = `Szó: "${w.ru}" (${w.stress || w.ru})${w.pf ? `, befejezett: ${w.pf}` : ''}. `
    + `Jelentés: ${w.hu}. Szófaj: ${w.pos}. Szint: ${w.level}.\n`
    + `Adj vissza egy JSON objektumot EZEKKEL a kulcsokkal (üres string ha nem értelmezhető a szófajra):\n`
    + `- "ragozas": ige→jelen idejű ragozás mind a 6 személyben (я/ты/он/мы/вы/они). Főnév→nem (hím/nő/semleges) + többes szám alanyeset + fontos esetek. Melléknév→hím/nő/semleges/többes alak.\n`
    + `- "mult": IGÉNÉL a múlt idő 4 alakja (hím/nő/semleges/többes), pl. "чита́л / чита́ла / чита́ло / чита́ли". Nem igénél üres string.\n`
    + `- "vonzat": milyen esetet vagy elöljárószót vonz + 1 rövid orosz példa magyar fordítással. Ha nincs jellemző vonzat, üres string.\n`
    + `- "nyelvtan": a legfontosabb nyelvtani tudnivaló (igénél az aspektus: folyamatos/befejezett és a párja; főnévnél rendhagyó ragozás; stb.).\n`
    + `- "arnyalat": az árnyalt jelentés, tipikus használat, gyakori hiba — 1-2 mondat.\n`
    + `Csak a JSON-t add vissza.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const obj = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
  // keep only our fields, coerce to strings
  const out = {};
  for (const k of ['ragozas', 'mult', 'vonzat', 'nyelvtan', 'arnyalat']) { const v = obj[k]; if (v) out[k] = String(v); }
  return out;
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';

  // ---- AI details API ----
  if (url.startsWith('/api/details')) {
    if (req.method !== 'POST') { res.writeHead(405).end('Method not allowed'); return; }
    const w = await readBody(req);
    if (!w || !w.ru) { res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad_request"}'); return; }
    if (CACHE[w.ru]) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(CACHE[w.ru])); return; }
    if (!OPENAI_KEY) { res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' }).end('{"error":"no_key"}'); return; }
    try {
      const det = await fetchDetails(w);
      CACHE[w.ru] = det; saveCacheSoon();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(det));
    } catch (e) {
      console.error('details error:', e.message);
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end('{"error":"ai_failed"}');
    }
    return;
  }

  // ---- static files ----
  try {
    let path = decodeURIComponent(url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = normalize(join(DIR, path));
    if (!file.startsWith(DIR)) { res.writeHead(403).end('Forbidden'); return; }
    const ext = file.slice(file.lastIndexOf('.'));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Orosz szavak — http://localhost:${PORT}`);
  console.log(OPENAI_KEY ? `AI details: ON (${OPENAI_MODEL})` : 'AI details: OFF — set OPENAI_API_KEY to enable');
});

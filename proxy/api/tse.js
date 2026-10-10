/* Proxy dei file di risultato del Tribunale superiore elettorale (TSE) brasiliano.

   GET /api/tse                      tutti i file del ballottaggio (presidente, elezione 6258)
                                     riuniti in una risposta sola: Brasile, 27 UF ed estero
   GET /api/tse?ele=6257             lo stesso per il primo turno (già definitivo): prova la catena
   GET /api/tse?ele=6258&uf=sp       un solo file, così come lo pubblica il TSE (per controllo)
   GET /api/tse?diag=1               diagnostica: raggiungibilità, stato HTTP, latenza, regione

   I file sono quelli che il TSE pubblica in resultados.tse.jus.br e sovrascrive a ogni
   aggiornamento, uno per abrangência:
     oficial/ele2026/<ele>/dados/<uf>/<uf>-c0001-e00<ele>-u.json      (c0001 = Presidente)
   Codici letti in oficial/comum/config/ele-c.json: 6257 è il 1º turno federale, 6258 il 2º.

   Una lettura della pagina costa 29 richieste al TSE, fatte in parallelo da qui. La cache
   del CDN di Vercel (s-maxage=15) fa sì che molti lettori aperti sulla pagina generino al
   massimo una raffica ogni 15 secondi. La risposta è compatta: per ogni file solo sezioni,
   elettorato, voti e candidati. */

const BASE = process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial/ele2026/';
const ELEZIONI = ['6258', '6257'];
const UF = ['br', 'ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to', 'zz'];

/* Origini ammesse. Aggiungi qui il dominio se la pagina va anche altrove. */
const ORIGINI = [
  'https://angrisanidj.github.io',
  'http://localhost', 'http://127.0.0.1', 'null'
];

function cors(req, res) {
  const o = req.headers.origin || '';
  const ok = ORIGINI.some(a => o === a || o.startsWith(a + ':'));
  res.setHeader('Access-Control-Allow-Origin', ok ? o : ORIGINI[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Tse-Fetched, X-Tse-Ele');
}

const url = (ele, uf) => BASE + ele + '/dados/' + uf + '/' + uf + '-c0001-e00' + ele + '-u.json';

async function scarica(u, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(u, {
      signal: ctl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
        'Accept': 'application/json,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,it;q=0.8',
        'Cache-Control': 'no-cache'
      }
    });
  } finally { clearTimeout(t); }
}

/* Numeri del TSE: interi come stringhe ("56104503"), percentuali con la virgola ("47,03"). */
function num(x) {
  if (x == null || x === '') return null;
  if (typeof x === 'number') return x;
  let s = String(x).trim();
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}
/* Cerca ricorsivamente le liste «cand»: nel 2026 stanno in carg[].agr[].par[].cand[] */
function candidati(o, out = []) {
  if (!o || typeof o !== 'object') return out;
  if (Array.isArray(o)) { o.forEach(x => candidati(x, out)); return out; }
  for (const k in o) {
    if (k === 'cand' && Array.isArray(o[k])) {
      o[k].forEach(c => out.push({ n: String(c.n), nm: c.nmu || c.nm || '', vap: num(c.vap), pvap: num(c.pvap != null ? c.pvap : c.pvapn), e: c.e || '', st: c.st || '' }));
    } else if (typeof o[k] === 'object') candidati(o[k], out);
  }
  return out;
}
/* Il file 2026 ha s, e, v come oggetti; quello del 2022 li aveva piatti. Si accettano tutti e due. */
function compatta(d) {
  const S = d.s && typeof d.s === 'object' ? d.s : d;
  const E = d.e && typeof d.e === 'object' ? d.e : d;
  const V = d.v && typeof d.v === 'object' ? d.v : d;
  const ts = num(S.ts != null ? S.ts : S.s), st = num(S.st);
  return {
    dg: d.dg || '', hg: d.hg || '', idg: d.idg || '',
    s: { ts, st, pst: num(S.pst) },
    e: { te: num(E.te != null ? E.te : (typeof E.e !== 'object' ? E.e : null)), c: num(E.c), a: num(E.a) },
    v: { tv: num(V.tv), vv: num(V.vv), vb: num(V.vb), tvn: num(V.tvn != null ? V.tvn : V.vn) },
    cand: candidati(d.carg || d.cand ? (d.carg || { cand: d.cand }) : d)
  };
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const q = req.query || {};
  const ele = ELEZIONI.includes(String(q.ele)) ? String(q.ele) : '6258';

  if (q.diag) {
    const out = { regione: process.env.VERCEL_REGION || 'sconosciuta', quando: new Date().toISOString(), prove: [] };
    const prove = [
      'https://resultados.tse.jus.br/oficial/comum/config/ele-c.json',
      url('6257', 'br'), url('6258', 'br'), url('6258', 'sp')
    ];
    for (const u of prove) {
      const t0 = Date.now();
      try {
        const r = await scarica(u, 10000);
        const testo = await r.text();
        let riassunto = testo.slice(0, 160);
        try { const c = compatta(JSON.parse(testo)); if (c.cand.length) riassunto = c; } catch (_) { }
        out.prove.push({ url: u, stato: r.status, ms: Date.now() - t0, server: r.headers.get('server'), tipo: r.headers.get('content-type'), riassunto });
      } catch (err) {
        out.prove.push({ url: u, errore: String(err && err.message || err), ms: Date.now() - t0 });
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  }

  if (q.uf) {
    const uf = String(q.uf).toLowerCase();
    if (!UF.includes(uf)) return res.status(400).json({ errore: 'uf sconosciuta' });
    try {
      const r = await scarica(url(ele, uf));
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(r.ok ? 200 : 502).send(await r.text());
    } catch (err) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(504).json({ errore: 'TSE non raggiungibile', dettaglio: String(err && err.message || err) });
    }
  }

  const risultati = await Promise.all(UF.map(async uf => {
    try {
      const r = await scarica(url(ele, uf));
      if (!r.ok) return [uf, { errore: 'HTTP ' + r.status }];
      return [uf, compatta(await r.json())];
    } catch (err) {
      return [uf, { errore: err.name === 'AbortError' ? 'tempo scaduto' : String(err && err.message || err) }];
    }
  }));
  const out = { ele, quando: new Date().toISOString(), uf: Object.fromEntries(risultati) };
  const buoni = risultati.filter(([, v]) => !v.errore).length;
  res.setHeader('X-Tse-Fetched', out.quando);
  res.setHeader('X-Tse-Ele', ele);
  if (!buoni) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ...out, errore: 'nessun file del TSE leggibile', esempio: risultati[0][1] });
  }
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
  return res.status(200).json(out);
}

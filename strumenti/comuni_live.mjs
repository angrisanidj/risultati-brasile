/* I comuni del ballottaggio, dal tuo PC, la sera del voto.

   Uso, dalla cartella del progetto:
     node strumenti/comuni_live.mjs                 un giro ogni 15 minuti, con commit e push
     node strumenti/comuni_live.mjs --una-volta     un giro solo
     node strumenti/comuni_live.mjs --no-push       scrive il file ma non fa commit né push
     node strumenti/comuni_live.mjs --ele=6257      il primo turno (per provare: niente push!)
     opzioni: --ogni=15 (minuti fra un giro e l'altro), --rps=10 (richieste al secondo)

   Perché dal PC: il proxy di Vercel serve il feed degli stati, e il 10 ottobre una raffica di
   file dei comuni partita da lì ha fatto bloccare dal TSE il suo indirizzo, feed compreso.
   Da qui le richieste partono dal tuo indirizzo: se il TSE si arrabbia, il feed non lo sa.

   A ogni giro:
   1. legge i 27 file dell'avanzamento (<uf>-e00<ele>-ab.json): sezioni contate per comune;
   2. scarica solo i comuni con sezioni nuove rispetto al giro prima, al massimo --rps
      richieste al secondo, 4 alla volta;
   3. al primo 429 o 403 si ferma, salva quello che ha, aspetta 10 minuti e riparte più piano;
   4. scrive dati/comuni-ballottaggio.json (codice IBGE → [sezioni contate, totali, voti
      validi, Lula, Flávio Bolsonaro]) e, se è cambiato, fa commit e push di quel file solo.
   Quando tutte le sezioni di tutti i comuni sono contate fa l'ultimo push e si ferma.
   Per fermarlo prima: Ctrl+C. La pagina resta all'ultimo file pubblicato. */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find(x => x === '--' + k || x.startsWith('--' + k + '=')); return a == null ? d : a.includes('=') ? a.split('=')[1] : true; };
const ELE = String(arg('ele', '6258'));
const UNA = !!arg('una-volta', false), PUSH = !arg('no-push', false);
const OGNI_MIN = Number(arg('ogni', 15));
let RPS = Number(arg('rps', 10));
const BASE = process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial/ele2026/';
const FILE = path.join(RADICE, 'dati', 'comuni-ballottaggio.json');
const UF = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to'];
const ora = () => new Date().toLocaleTimeString('it-IT');
const log = (...a) => console.log('[' + ora() + ']', ...a);
const dorme = ms => new Promise(r => setTimeout(r, ms));
if (PUSH && ELE !== '6258') { console.error('Con --ele=' + ELE + ' serve --no-push: il file pubblicato è quello del ballottaggio.'); process.exit(1); }

/* codice TSE → codice IBGE, dai dati del primo turno (quinto campo) */
const MUN = JSON.parse(fs.readFileSync(path.join(RADICE, 'dati', 'municipi.json'), 'utf8'));
const TSE2IBGE = {};
for (const id in MUN.dati) { const t = MUN.dati[id][4]; if (t) TSE2IBGE[t] = id; }
log('Comuni conosciuti:', Object.keys(TSE2IBGE).length, '· elezione', ELE, '·', RPS, 'richieste al secondo', PUSH ? '· con push' : '· senza push');

/* lo stato del giro prima: dal file, se c'è ed è della stessa elezione */
let M = {};
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j.ele === ELE && j.m) M = j.m; } catch (_) { }

class Blocco extends Error { }
let ultima = 0, fermo = null;
async function prendi(url) {
  if (fermo) throw new Blocco(fermo);   /* dopo un 429 nessun'altra richiesta in questo giro */
  /* ritmo: una partenza ogni 1000/RPS millisecondi, comunque vadano le altre */
  const attesa = ultima + 1000 / RPS - Date.now();
  ultima = Math.max(Date.now(), ultima + 1000 / RPS);
  if (attesa > 0) await dorme(attesa);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url + '?nocache=' + Date.now(), { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept': 'application/json,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9,it;q=0.8' } });
    if (r.status === 429 || r.status === 403) { fermo = 'HTTP ' + r.status; throw new Blocco(fermo); }
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    if (e instanceof Blocco) throw e;
    return null;
  } finally { clearTimeout(t); }
}
const num = x => { if (x == null || x === '') return 0; if (typeof x === 'number') return x; let s = String(x).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return isFinite(n) ? n : 0; };
function voti(d, n) {
  let v = 0;
  (function giu(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(giu); for (const k in o) { if (k === 'cand' && Array.isArray(o[k])) o[k].forEach(c => { if (String(c.n) === n) v = num(c.vap); }); else if (typeof o[k] === 'object') giu(o[k]); } })(d.carg || d);
  return v;
}

async function giro() {
  const t0 = Date.now(), prima = JSON.stringify(M);
  let letti = 0, errori = 0, abLetti = 0, bloccato = null, st = 0, ts = 0;
  fermo = null;
  const coda = [];
  try {
    for (const uf of UF) {
      const ab = await prendi(BASE + ELE + '/dados/' + uf + '/' + uf + '-e00' + ELE + '-ab.json');
      if (!ab) { errori++; continue; }
      abLetti++;
      for (const a of ab.abr || []) {
        if (a.tpabr !== 'mun' && a.tpabr !== 'mu') continue;
        const id = TSE2IBGE[String(a.cdabr)]; if (!id) continue;
        const s = num(a.s && a.s.st), t = num(a.s && a.s.ts);
        st += s; ts += t;
        const p = M[id];
        if (s > 0 && !(p && p.length >= 5 && p[0] === s)) coda.push({ uf, cd: String(a.cdabr), id, s, t });
        else if (!p) M[id] = [s, t];
        else if (p.length < 5) M[id] = [s, t];
      }
    }
    log('Avanzamento letto: sezioni', st, 'su', ts, '·', coda.length, 'comuni da scaricare');
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < coda.length) {
        const x = coda[i++];
        const d = await prendi(BASE + ELE + '/dados/' + x.uf + '/' + x.uf + x.cd + '-c0001-e00' + ELE + '-u.json');
        if (!d) { errori++; continue; }
        const S = d.s || {}, V = d.v || {};
        M[x.id] = [num(S.st) || x.s, num(S.ts) || x.t, num(V.vv), voti(d, '13'), voti(d, '22')];
        if (++letti % 500 === 0) log('  ', letti, 'comuni scaricati');
      }
    }));
  } catch (e) {
    if (!(e instanceof Blocco)) throw e;
    bloccato = e.message;
  }
  const conVoti = Object.values(M).filter(x => x.length >= 5 && x[0] > 0).length;
  if (JSON.stringify(M) === prima && fs.existsSync(FILE)) {
    log('Niente di nuovo dal TSE in questo giro' + (bloccato ? ' · FERMATO: ' + bloccato : ''));
    return { bloccato, finito: !bloccato && !errori && abLetti === UF.length && ts > 0 && st === ts };
  }
  const out = { ele: ELE, aggiornato: new Date().toISOString(), sezioni: [st, ts], comuni: Object.keys(M).length, con_voti: conVoti, m: M };
  fs.writeFileSync(FILE, JSON.stringify(out));
  log('Scritto', path.relative(RADICE, FILE), '·', conVoti, 'comuni con voti ·', letti, 'scaricati,', errori, 'errori ·', Math.round((Date.now() - t0) / 1000), 's' + (bloccato ? ' · FERMATO: ' + bloccato : ''));
  return { bloccato, finito: !bloccato && !errori && abLetti === UF.length && ts > 0 && st === ts };
}

function pubblica() {
  const git = (...a) => execFileSync('git', a, { cwd: RADICE, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const rel = path.relative(RADICE, FILE).split(path.sep).join('/');
  git('add', rel);
  try { git('diff', '--cached', '--quiet', '--', rel); log('Nessun cambiamento da pubblicare'); return; } catch (_) { }
  git('commit', '-m', 'Comuni del ballottaggio: ' + ora(), '--', rel);
  try { git('push'); }
  catch (_) { git('pull', '--rebase', '--autostash'); git('push'); }
  log('Pubblicato: GitHub Pages lo serve fra un minuto circa');
}

let fermati = false;
process.on('SIGINT', () => { if (fermati) process.exit(0); fermati = true; log('Mi fermo alla fine di questo giro (Ctrl+C di nuovo per uscire subito)'); });
while (true) {
  const r = await giro();
  if (PUSH) { try { pubblica(); } catch (e) { log('Push non riuscito:', String(e.message || e).split('\n')[0]); } }
  if (r.finito) { log('Spoglio dei comuni concluso: ultimo file pubblicato, mi fermo.'); break; }
  if (UNA || fermati) break;
  let pausa = OGNI_MIN * 60000;
  if (r.bloccato) { RPS = Math.max(2, RPS / 2); pausa = Math.max(pausa, 10 * 60000); log('Il TSE ha risposto', r.bloccato, ': riprendo fra', pausa / 60000, 'minuti a', RPS, 'richieste al secondo'); }
  log('Prossimo giro alle', new Date(Date.now() + pausa).toLocaleTimeString('it-IT'));
  const fine = Date.now() + pausa;
  while (Date.now() < fine && !fermati) await dorme(1000);
  if (fermati) break;
}

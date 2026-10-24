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
   2b. RIPIEGO: legge anche i 27 file di stato (<uf>-c0001-e00<ele>-u.json). Se l'avanzamento
      di uno stato non torna con il file di stato (totale delle sezioni diverso, o file
      mancante), quell'avanzamento è fermo: il 24 ottobre lo era in 11 stati, ancora sulla
      configurazione del 9-12 ottobre. Per quello stato le sezioni vengono dal file di stato e,
      se lo spoglio vi è cominciato, si scaricano tutti i suoi comuni non ancora completi
      (elenco ufficiale mun-e00<ele>-cm.json), sempre allo stesso ritmo. Se il TSE riscrive
      l'avanzamento, il ripiego non scatta. --senza-ripiego lo spegne; --prova-ripiego=sp,ce
      lo forza per gli stati indicati (per provarlo sul primo turno);
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
const RIPIEGO = !arg('senza-ripiego', false);
const FORZA = new Set(String(arg('prova-ripiego', '') || '').toLowerCase().split(',').filter(Boolean));
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
log('Comuni conosciuti:', Object.keys(TSE2IBGE).length, '· elezione', ELE, '·', RPS, 'richieste al secondo', PUSH ? '· con push' : '· senza push', RIPIEGO ? '· ripiego acceso' + (FORZA.size ? ' (forzato per ' + [...FORZA].join(', ') + ')' : '') : '· ripiego spento');

/* lo stato del giro prima: dal file, se c'è ed è della stessa elezione */
let M = {};
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j.ele === ELE && j.m) M = j.m; } catch (_) { }

class Blocco extends Error { }
let ultima = 0, fermo = null;
const ERR = { rete: 0, http: 0 };   /* errori del giro: di rete (DNS, timeout) o risposte HTTP diverse da 200 */
async function prendi(url, secondo) {
  if (fermo) throw new Blocco(fermo);   /* dopo un 429 nessun'altra richiesta in questo giro */
  /* ritmo: una partenza ogni 1000/RPS millisecondi, comunque vadano le altre */
  const attesa = ultima + 1000 / RPS - Date.now();
  ultima = Math.max(Date.now(), ultima + 1000 / RPS);
  if (attesa > 0) await dorme(attesa);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url + '?nocache=' + Date.now(), { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept': 'application/json,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9,it;q=0.8' } });
    if (r.status === 429 || r.status === 403) { fermo = 'HTTP ' + r.status; throw new Blocco(fermo); }
    if (!r.ok) { ERR.http++; return null; }
    return await r.json();
  } catch (e) {
    if (e instanceof Blocco) throw e;
    /* errore di rete (DNS, connessione, tempo scaduto): un secondo tentativo dopo 2 secondi */
    if (!secondo) { clearTimeout(t); await dorme(2000); return prendi(url, true); }
    ERR.rete++;
    return null;
  } finally { clearTimeout(t); }
}
const num = x => { if (x == null || x === '') return 0; if (typeof x === 'number') return x; let s = String(x).trim(); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = Number(s); return isFinite(n) ? n : 0; };
function voti(d, n) {
  let v = 0;
  (function giu(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(giu); for (const k in o) { if (k === 'cand' && Array.isArray(o[k])) o[k].forEach(c => { if (String(c.n) === n) v = num(c.vap); }); else if (typeof o[k] === 'object') giu(o[k]); } })(d.carg || d);
  return v;
}

/* elenco ufficiale dei comuni per stato (codici TSE), per il ripiego: dal TSE, o dalla copia
   in strumenti/campioni se il TSE non risponde */
let CM = null;
async function elencoComuni() {
  if (CM) return CM;
  let j = await prendi(BASE + ELE + '/config/mun-e00' + ELE + '-cm.json');
  if (!j) { try { j = JSON.parse(fs.readFileSync(path.join(RADICE, 'strumenti', 'campioni', 'mun-e006258-cm.json'), 'utf8')); log('Elenco dei comuni dalla copia locale'); } catch (_) { } }
  if (!j || !j.abr) return null;
  CM = {};
  for (const a of j.abr) CM[a.cd] = (a.mu || []).map(m => String(m.cd));
  return CM;
}

async function giro() {
  const t0 = Date.now(), prima = JSON.stringify(M);
  let letti = 0, errori = 0, abLetti = 0, coperti = 0, bloccato = null, st = 0, ts = 0;
  fermo = null; ERR.rete = 0; ERR.http = 0;
  const coda = [], fermi = [];
  try {
    for (const uf of UF) {
      const ab = await prendi(BASE + ELE + '/dados/' + uf + '/' + uf + '-e00' + ELE + '-ab.json');
      const voci = [];
      let aSt = 0, aTs = 0;
      for (const a of (ab && ab.abr) || []) {
        if (a.tpabr !== 'mun' && a.tpabr !== 'mu') continue;
        const id = TSE2IBGE[String(a.cdabr)]; if (!id) continue;
        const s = num(a.s && a.s.st), t = num(a.s && a.s.ts);
        voci.push({ uf, cd: String(a.cdabr), id, s, t }); aSt += s; aTs += t;
      }
      /* ripiego: l'avanzamento torna con il file di stato? */
      const sf = RIPIEGO ? await prendi(BASE + ELE + '/dados/' + uf + '/' + uf + '-c0001-e00' + ELE + '-u.json') : null;
      const sSt = sf ? num(sf.s && sf.s.st) : 0, sTs = sf ? num(sf.s && sf.s.ts) : 0;
      if (sf && sTs > 0 && (!ab || aTs !== sTs || FORZA.has(uf))) {
        coperti++; st += sSt; ts += sTs;
        const cm = await elencoComuni();
        let n = 0;
        if (sSt > 0 && cm && cm[uf]) {
          for (const cd of cm[uf]) {
            const id = TSE2IBGE[cd]; if (!id) continue;
            const p = M[id];
            if (!(p && p.length >= 5 && p[1] > 0 && p[0] === p[1])) { coda.push({ uf, cd, id, s: 0, t: 0 }); n++; }
          }
        } else for (const v of voci) if (!M[v.id] || M[v.id].length < 5) M[v.id] = [v.s, v.t];
        fermi.push(uf.toUpperCase() + ' ' + (ab ? aTs : 'manca') + '/' + sTs + (sSt > 0 ? (cm ? ' → ' + n + ' comuni' : ' → elenco dei comuni non disponibile') : ' → spoglio non cominciato'));
        continue;
      }
      if (!ab) continue;
      abLetti++; coperti++;
      for (const v of voci) {
        st += v.s; ts += v.t;
        const p = M[v.id];
        if (v.s > 0 && !(p && p.length >= 5 && p[0] === v.s)) coda.push(v);
        else if (!p) M[v.id] = [v.s, v.t];
        else if (p.length < 5) M[v.id] = [v.s, v.t];
      }
    }
    if (!coperti) {
      log('ATTENZIONE: nessuno stato letto, né avanzamento né file di stato (' + ERR.http + ' risposte HTTP non valide, ' + ERR.rete + ' errori di rete): controlla la connessione. Il file non viene toccato.');
      return { bloccato: fermo, finito: false };
    }
    if (fermi.length) log('Avanzamento fermo in ' + fermi.length + ' stati, uso i file di stato (sezioni nell’avanzamento/nel file di stato): ' + fermi.join(' · '));
    log('Avanzamento letto: ' + abLetti + ' file su 27' + (fermi.length ? ' (+ ' + fermi.length + ' dal ripiego)' : '') + (coperti < 27 ? ' (mancano ' + (27 - coperti) + ' stati: ' + ERR.http + ' file non pubblicati o non validi, ' + ERR.rete + ' errori di rete)' : '') + ' · sezioni', st, 'su', ts, '·', coda.length, 'comuni da scaricare');
    ERR.rete = 0; ERR.http = 0;
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < coda.length) {
        const x = coda[i++];
        const d = await prendi(BASE + ELE + '/dados/' + x.uf + '/' + x.uf + x.cd + '-c0001-e00' + ELE + '-u.json');
        if (!d) { errori++; continue; }
        const S = d.s || {}, V = d.v || {}, sst = num(S.st) || x.s, sts = num(S.ts) || x.t;
        /* comune scaricato dal ripiego ma senza sezioni contate: come gli altri, solo le sezioni */
        M[x.id] = sst > 0 ? [sst, sts, num(V.vv), voti(d, '13'), voti(d, '22')] : [0, sts];
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
    return { bloccato, finito: !bloccato && !errori && coperti === UF.length && ts > 0 && st === ts };
  }
  const out = { ele: ELE, aggiornato: new Date().toISOString(), sezioni: [st, ts], comuni: Object.keys(M).length, con_voti: conVoti, m: M };
  fs.writeFileSync(FILE, JSON.stringify(out));
  log('Scritto', path.relative(RADICE, FILE), '·', conVoti, 'comuni con voti ·', letti, 'scaricati,', errori, 'errori' + (errori ? ' (' + ERR.rete + ' di rete, ' + ERR.http + ' HTTP: si riprovano al giro dopo)' : '') + ' ·', Math.round((Date.now() - t0) / 1000), 's' + (bloccato ? ' · FERMATO: ' + bloccato : ''));
  return { bloccato, finito: !bloccato && !errori && coperti === UF.length && ts > 0 && st === ts };
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
  if (r.finito) { log('Spoglio dei comuni concluso: ' + (PUSH ? 'ultimo file pubblicato' : 'file scritto, senza push') + ', mi fermo.'); break; }
  if (UNA || fermati) break;
  let pausa = OGNI_MIN * 60000;
  if (r.bloccato) { RPS = Math.max(2, RPS / 2); pausa = Math.max(pausa, 10 * 60000); log('Il TSE ha risposto', r.bloccato, ': riprendo fra', pausa / 60000, 'minuti a', RPS, 'richieste al secondo'); }
  log('Prossimo giro alle', new Date(Date.now() + pausa).toLocaleTimeString('it-IT'));
  const fine = Date.now() + pausa;
  while (Date.now() < fine && !fermati) await dorme(1000);
  if (fermati) break;
}

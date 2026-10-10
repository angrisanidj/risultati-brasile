# risultati-brasile

Dashboard per seguire in diretta lo spoglio del ballottaggio presidenziale brasiliano (domenica 25 ottobre 2026, Lula contro Flávio Bolsonaro), con il primo turno del 4 ottobre, le mappe per stato e per comune e una proiezione del risultato finale con la sua forchetta. È costruita sulla falsariga di `risultati-israele`: una sola pagina statica su GitHub Pages che legge i file del Tribunale superiore elettorale (TSE) attraverso un proxy Vercel.

## Cosa c'è

| File | A cosa serve |
|---|---|
| `index.html` | La dashboard, file unico. Base del primo turno per stato e confini degli stati incorporati. |
| `dati/municipi.json` | Confini dei 5.571 comuni e voti del primo turno per comune. Si carica solo quando si apre il livello «Comuni». |
| `stime.json` | Il sondaggio di partenza della proiezione. Si modifica a mano. |
| `proxy/` | Il progetto Vercel: `api/tse.js` più la configurazione. |
| `strumenti/comuni_da_tse.py` | Rifà i voti per comune dal file ufficiale del TSE (vedi «Comuni»). |

## Da dove arrivano i dati

Il TSE pubblica in `resultados.tse.jus.br` un file JSON per ogni abrangência e lo sovrascrive a ogni aggiornamento:

```
https://resultados.tse.jus.br/oficial/ele2026/<elezione>/dados/<uf>/<uf>-c0001-e00<elezione>-u.json
```

`c0001` è il Presidente. I codici delle elezioni sono in `oficial/comum/config/ele-c.json`: **6257** è il primo turno, **6258** il ballottaggio. Ci sono 29 file: `br`, le 27 UF, `zz` (l'estero). Ogni file ha le sezioni (`s.ts` totali, `s.st` totalizzate), l'elettorato e l'affluenza (`e`), i voti (`v`) e i candidati in `carg[].agr[].par[].cand[]` con `n` (13 Lula, 22 Flávio) e `vap` (voti). Il formato è stato verificato sui file del primo turno. Nel 2022 il TSE usava un formato «simplificado» diverso: il proxy accetta tutti e due.

Il proxy legge i 29 file in parallelo e restituisce una risposta sola, compatta. La pagina la chiede ogni 30 secondi; la cache del CDN di Vercel (15 secondi) fa sì che molti lettori aperti producano al massimo una raffica di richieste al TSE ogni 15 secondi.

## 1. Pubblicare il proxy su Vercel

Il nome del progetto deve essere `brasile-2026-feed-proxy`. Così l'indirizzo coincide con quello predefinito nella pagina: `https://brasile-2026-feed-proxy.vercel.app/api/tse`.

```
cd proxy
npx vercel link        # crea il progetto «brasile-2026-feed-proxy»
npx vercel --prod
```

In alternativa, dalla dashboard di Vercel: *Add New → Project*, importa questo repository e imposta **Root Directory = `proxy`**. Non serve un framework né un comando di build.

La funzione gira a San Paolo (`gru1`, in `vercel.json`). Le richieste ammesse arrivano da `https://angrisanidj.github.io` e da `localhost`; per altri domini modifica `ORIGINI` in `api/tse.js`.

### Diagnostica, da fare subito e poi il giorno prima

```
https://brasile-2026-feed-proxy.vercel.app/api/tse?diag=1
```

Prova `ele-c.json`, il file nazionale del primo turno e i file del ballottaggio (Brasile e San Paolo), con stato HTTP, latenza e un riassunto del contenuto.

| Esito | Significato |
|---|---|
| 200 sul primo turno (6257) | La catena funziona. Il riassunto deve dare Flávio 56.104.503 e Lula 53.879.538. |
| 200 sul ballottaggio (6258) con pochi voti o nessuno | Normale prima della sera del voto: il TSE pubblica i file in anticipo e completa la configurazione nei giorni prima. Il giorno prima il file `br` deve dare circa 499.000 sezioni (`s.ts`). |
| 403 o tempo scaduto | Blocco del TSE verso Vercel: vedi «Se il feed si blocca». |

Se il TSE cambiasse l'indirizzo base, imposta su Vercel la variabile d'ambiente `TSE_BASE` (per esempio `https://resultados.tse.jus.br/oficial/ele2026/`) e ripubblica.

## 2. Pubblicare la pagina

Crea il repository `angrisanidj/risultati-brasile` e carica tutto (la cartella `proxy/` non dà fastidio). Attiva GitHub Pages dal branch `main`, cartella root. Il livello dei comuni e `stime.json` si leggono solo da un server: aperta dal disco, la pagina funziona ma senza comuni.

## 3. La prova generale

- **`…/risultati-brasile/?prova=1`** simula un'intera notte di spoglio. I tempi di arrivo sono quelli veri del primo turno, stato per stato; il risultato vero si sceglie dal menu (Lula 47,5 / 49,5 / 50,5 / 52,5%), il resto (spostamenti per regione e per stato, ordine di arrivo, affluenza) è estratto a caso. Il cursore va dalle 17 alle 22:30 di Brasília; «Avvia lo scorrimento» la fa scorrere da sola, «Nuova simulazione» cambia notte. La pagina dice qual è il risultato vero della simulazione, così si vede la forchetta stringersi attorno ad esso.
- **`…/risultati-brasile/?ele=6257`** usa il feed live, ma con i file definitivi del primo turno: prova l'intera catena browser → Vercel → TSE. Deve mostrare il 100% delle sezioni e Flávio al 51,0% dei voti dei due.
- **`?proxy=https://…`** sostituisce il proxy predefinito.
- **Feed spento fino al pomeriggio del voto:** senza parametri la pagina non chiama il proxy fino a domenica 25 ottobre alle 16:30 di Brasília (20:30 in Italia), poi si accende da sola. **`?feed=1`** la accende subito.

## La sera del voto

**Orari:** le urne chiudono alle 17 di Brasília. Il 25 ottobre in Italia finisce l'ora legale, quindi la differenza è di quattro ore: **le 21 in Italia**. Nel 2022 il ballottaggio era al 99% alle 20 di Brasília; al primo turno 2026 lo schermo del TSE si è fermato per un'ora (dalle 19:06 alle 20:08, dal 64,8% all'85%).

**Il sondaggio di partenza** sta in `stime.json` (oggi Datafolha del 6–7 ottobre: Lula 48% dei validi). Conta solo prima dei voti veri: con l'1–2% delle sezioni il modello lo ha già quasi dimenticato. Per cambiarlo, modifica il file e fai il commit; le pagine aperte lo rileggono ogni due minuti.

**Modalità redazione:** la stessa chiave della dashboard di Israele, `?redazione=CHIAVE` una volta (il browser la ricorda, `?redazione=esci` la dimentica). Compaiono:
- il sondaggio da modificare in locale e il pulsante «Copia per stime.json»;
- i totali manuali (voti di Lula, di Flávio, % sezioni) se il feed si blocca: hanno la precedenza finché non li rimuovi, e la proiezione resta sospesa;
- «Importa file TSE»: i JSON scaricati a mano da resultados.tse.jus.br, anche tutti e 29 insieme, con il loro nome originale (`sp-c0001-e006258-u.json`); il feed va in pausa;
- la scheda «Card per X»: proiezione, mappa degli stati e forchetta, 1600×900 (PNG 3200×1800), con un testo da 240 caratteri.

La pagina tiene in memoria nel browser la storia della notte (grafico e stima dell'ordine di arrivo): chi ricarica la pagina la ritrova.

### Se il feed si blocca

- **Il TSE blocca Vercel:** la soluzione più rapida è importare i file a mano (redazione). In alternativa una funzione equivalente su un altro servizio, indicata con `?proxy=`.
- **Il TSE non risponde per tutti:** i totali manuali.

## Il modello

Il problema è che i voti non arrivano a caso. Al primo turno sono arrivati prima Sud, Centro-Ovest e i piccoli stati del Nord, per ultimo il Nordest; e dentro ogni stato le sezioni contate per prime erano più favorevoli a Flávio. Con il 14% delle sezioni Flávio era avanti di 10,8 punti, alla fine di 1,9.

Il modello lavora su 28 unità (27 UF più l'estero) e confronta ogni stato con se stesso al primo turno, sulla quota di Lula fra i due candidati. Lo spostamento di ogni stato (in logit) è la somma di un termine nazionale, uno regionale e uno statale, con una normale a priori centrata sul sondaggio. I voti contati osservano questo spostamento con due correzioni: l'ordine di arrivo dentro lo stato (una pendenza k: la parte contata fino a c sta k(1−c)/2 sotto la media dello stato) e il rumore di un campione parziale, che scende come (1−c)/c. Dalla normale a posteriori si estraggono 4.000 simulazioni dei voti mancanti, con l'incertezza su k, sull'affluenza e sulle sezioni residue.

- **k = 0,19** riproduce entro due decimi di punto la curva vera del primo turno 2026 (dal 10% al 100% delle sezioni) usando i tempi di arrivo veri di ogni stato. Durante la notte k si ricalcola dai lotti che arrivano: per ogni stato si confronta la quota del lotto nuovo con quella del già contato.
- **Prova:** 150 notti simulate. Il risultato vero è rimasto nella forchetta al 95% in almeno 98 casi su 100 a ogni ora; l'errore medio scende da 1,1 punti con il 3% delle sezioni a 0,2 con il 43%. Se la notte vera avesse un ordine di arrivo molto diverso dal primo turno, la forchetta delle prime ore sarebbe troppo stretta: si corregge da sola man mano che k si ricalcola.

I parametri stanno in testa al modello, nella costante `PAR`.

## Comuni

I voti del primo turno per comune vengono da una ricostruzione pubblica dai boletins de urna del TSE ([Gabriel-Alexandre/apuracao-eleicoes-2026](https://github.com/Gabriel-Alexandre/apuracao-eleicoes-2026)), verificata dall'autore sul risultato ufficiale comune per comune. Copre 5.273 comuni su 5.571; gli altri sono in grigio. Per averli tutti dai dati ufficiali:

1. scarica `votacao_candidato_munzona_2026.zip` da dadosabertos.tse.jus.br (Resultados 2026 → Votação nominal por município e zona);
2. `python strumenti/comuni_da_tse.py votacao_candidato_munzona_2026.zip`

Lo script riscrive `dati/municipi.json`. Con `--turno 2`, dopo il ballottaggio, stampa i totali del secondo turno per comune.

## Fonti e licenze

- Voti: Tribunale superiore elettorale (TSE), resultados.tse.jus.br. Primo turno: totalizzazione del 5 ottobre 2026 alle 12:51, 100% delle sezioni. Voti dei candidati e voti validi per stato verificati sui file ufficiali dell'elezione 6257.
- Curva dello spoglio del primo turno e tempi di arrivo per stato: ricostruzione dai boletins de urna di Gabriel-Alexandre/apuracao-eleicoes-2026. Curve del 2022: stessa fonte.
- Blocco delle 19:06: Agência Brasil e Jornal de Brasília, 5 ottobre 2026.
- Confini: IBGE, malha municipal nella versione di [tbrugz/geodata-br](https://github.com/tbrugz/geodata-br) (CC0), semplificata con mapshaper; i sette comuni nati dopo il 2010 da [analusz/br-geodata-2024](https://github.com/analusz/br-geodata-2024). Corrispondenza fra codici TSE e IBGE: [betafcc/Municipios-Brasileiros-TSE](https://github.com/betafcc/Municipios-Brasileiros-TSE).
- Sondaggio: Datafolha, 6–7 ottobre 2026, 2.520 interviste.

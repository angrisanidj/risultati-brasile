"""Ricostruisce i voti per comune di dati/municipi.json dal file ufficiale del TSE.

Uso (dalla cartella del repository):
    python strumenti/comuni_da_tse.py votacao_candidato_munzona_2026.zip            # primo turno
    python strumenti/comuni_da_tse.py votacao_candidato_munzona_2026.zip --turno 2  # stampa il controllo del ballottaggio

Il file si scarica da dadosabertos.tse.jus.br (Resultados 2026 → Votação nominal por município
e zona). Si legge la carica 1 (Presidente): per ogni comune i voti di Flávio (22), di Lula (13) e
il totale dei voti nominali, che per il presidente coincide con i voti validi. Il codice di comune
del TSE si traduce in quello IBGE con strumenti/municipios_tse_ibge.csv; i comuni che mancano
nella tabella (nati dopo il 2018) si cercano per nome e stato fra i poligoni.
Con --turno 1 il file dati/municipi.json viene riscritto e segnato come completo.
Solo libreria standard."""
import csv, io, json, sys, zipfile, unicodedata, pathlib, collections

QUI = pathlib.Path(__file__).resolve().parent
REPO = QUI.parent
def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s.upper()) if unicodedata.category(c) != 'Mn').replace("'", '').replace('-', ' ').strip()

def leggi(zip_path, turno):
    z = zipfile.ZipFile(zip_path)
    nomi = [n for n in z.namelist() if n.lower().endswith('.csv') and ('_br' in n.lower() or 'brasil' in n.lower())] or [n for n in z.namelist() if n.lower().endswith('.csv')]
    voti = collections.defaultdict(lambda: [0, 0, 0, '', ''])   # F, L, validi, nome, uf
    for nome in nomi:
        with z.open(nome) as f:
            r = csv.DictReader(io.TextIOWrapper(f, encoding='latin-1'), delimiter=';')
            for row in r:
                if row.get('CD_CARGO') not in ('1', '01') or str(row.get('NR_TURNO')) != str(turno): continue
                if row.get('SG_UF') in ('ZZ', 'BR'): continue
                q = int(row.get('QT_VOTOS_NOMINAIS_VALIDOS') or row.get('QT_VOTOS_NOMINAIS') or 0)
                v = voti[row['CD_MUNICIPIO'].zfill(5)]
                n = row.get('NR_CANDIDATO') or row.get('NR_VOTAVEL')
                if n == '22': v[0] += q
                elif n == '13': v[1] += q
                v[2] += q; v[3] = row.get('NM_MUNICIPIO', ''); v[4] = row.get('SG_UF', '')
        if voti: break
    return voti

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    turno = 2 if '--turno' in sys.argv and sys.argv[sys.argv.index('--turno') + 1] == '2' else 1
    voti = leggi(sys.argv[1], turno)
    cw = {r['codigo_tse'].zfill(5): r['codigo_ibge'] for r in csv.DictReader(open(QUI / 'municipios_tse_ibge.csv', encoding='utf-8'))}
    M = json.load(open(REPO / 'dati' / 'municipi.json', encoding='utf-8'))
    geo = {(norm(g['properties']['n']), g['properties']['uf']): str(g['id']) for g in M['topo']['objects']['comuni']['geometries']}
    capitali = {k for k, v in M['dati'].items() if v[3]}
    dati, senza = {}, []
    for cod, (F, L, V, nome, uf) in voti.items():
        ib = cw.get(cod) or geo.get((norm(nome), uf))
        if not ib: senza.append(f'{uf} {nome} ({cod})'); continue
        dati[ib] = [F, L, V, 1 if ib in capitali else 0]
    tot = [sum(v[i] for v in dati.values()) for i in range(3)]
    print(f'turno {turno}: {len(voti)} comuni nel file, {len(dati)} uniti ai poligoni; Flávio {tot[0]:,} Lula {tot[1]:,} validi {tot[2]:,}')
    if senza: print('senza poligono:', ', '.join(senza))
    if turno == 1:
        M['dati'] = dati; M['completo'] = len(dati) >= 5560
        M['fonte'] = 'Comuni: IBGE (malha municipal via tbrugz/geodata-br, CC0; 7 comuni nuovi da analusz/br-geodata-2024). Voti del 1º turno per comune: TSE, votacao_candidato_munzona_2026.'
        (REPO / 'dati' / 'municipi.json').write_text(json.dumps(M, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print('scritto dati/municipi.json')

if __name__ == '__main__': main()

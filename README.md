# Scraper Caixa (Venda Imóveis) — CLI + Web UI

Scraper em **Node.js + TypeScript** que coleta a listagem de imóveis do site da Caixa e salva em **CSV** dentro de `output/`.

Ele reproduz o fluxo real do site:

- `POST /sistema/carregaPesquisaImoveis.asp` → retorna `hdnImov1..N` + paginação
- `POST /sistema/carregaListaImoveis.asp` (por página) → retorna HTML com os cards
- (opcional) `POST /sistema/detalhe-imovel.asp` (por imóvel) → matrícula PDF + galeria + campos extras

---

## Requisitos

- Node.js **18+** (recomendado 20+)

## Setup

```bash
cd /Users/xandekoch/Documents/coding/study/scrape-leilao-caixa
npm install
```

---

## 1) Gerar JSON de estados/cidades (1x)

A UI (e você) usa `output/estados-cidades.json`.

```bash
node scripts/fetch-estados-cidades.js
```

Saída: `output/estados-cidades.json`

> Observação: esse endpoint devolve “cidades com imóveis disponíveis” (não é um cadastro oficial de todas as cidades).

---

## 2) Rodar via Web UI (recomendado)

```bash
npm run server
```

Abra `http://localhost:5177`

- Aba **Scrape**: escolhe UF/cidade + filtros + `withDetails` e roda o job.
- Aba **Outputs**: lista os CSVs de `output/` e renderiza tabela (prévia das primeiras linhas).

---

## 3) Rodar via CLI

Exemplo (RJ / Itaboraí = `7084`) salvando em `output/`:

```bash
npm run scrape -- \
  --uf RJ \
  --cidade 7084 \
  --tpVenda Selecione \
  --tpImovel 2 \
  --areaUtil 0 \
  --faixaVlr 1 \
  --quartos 0 \
  --vagas 0 \
  --maxPages 1 \
  --out output/output.csv
```

### Flags úteis (CLI)

- `--withDetails`: busca a página de detalhe por imóvel e adiciona colunas extras (muito mais lento).
- `--concurrency 3`: páginas em paralelo (1–10).
- `--detailsConcurrency 2`: páginas de detalhes do imóvel em paralelo (1–10).
- `--minDelayMs 500`: delay mínimo entre requests (evita rate limiting).
- `--maxPages 3`: limita páginas (bom para testar rápido).
- `--timeoutMs 20000`, `--retries 4`: robustez em rede.

---

## Outputs

- Todos os CSVs devem ir para: `output/`
- O server também lista/visualiza automaticamente esses arquivos.

## To-Do

- Melhorar a UI/UX da webpage (table, visualizacao de fotos dos imóveis).
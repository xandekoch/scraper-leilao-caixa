# Scraper - Leilão/Venda Imóveis Caixa (HTTP puro)

Scraper em **Node.js + TypeScript** que reproduz o fluxo real do site:

- `POST /sistema/carregaPesquisaImoveis.asp` → retorna `hdnImov1..N` e `hdnQtdPag`
- `POST /sistema/carregaListaImoveis.asp` (para cada página) → retorna HTML com os cards

O scraper parseia os cards e exporta **CSV**.

## Requisitos

- Node.js 18+ (recomendado 20+)

## Instalação

```bash
cd /Users/xandekoch/Documents/coding/study/scrape-leilao-caixa
npm install
```

## Rodar (exemplo RJ / Itaboraí = 7084)

Exemplo alinhado com seu `curl`:

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

### Opções úteis

- `--concurrency 3`: quantas páginas baixar em paralelo (1–10)
- `--minDelayMs 500`: delay mínimo entre requests (evitar rate limiting)
- `--maxPages 3`: limitar páginas (bom para testes rápidos)
- `--withDetails`: fetch na page de detalhes de cada imóvel (enriquece os dados, mas demora mais)

## Como obter IDs (cidade, filtros)

No site, o `<option value='7084'>ITABORAI</option>` indica o `--cidade 7084`.
Os demais filtros mapeiam direto para os campos do POST:
`hdn_tp_venda`, `hdn_tp_imovel`, `hdn_area_util`, `hdn_faixa_vlr`, `hdn_quartos`, `hdn_vg_garagem`.

### To-Do:

- Criar um indíce com os filtros e seus possíveis values, e montar um html simples pra facilitar o scrapping.

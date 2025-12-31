import { Command } from "commander";
import pLimit from "p-limit";
import { z } from "zod";
import type { CaixaSearchPayload, ImovelListItem } from "./models";
import { HttpClient } from "./caixa/httpClient";
import { runSearch } from "./caixa/search";
import { fetchListPageHtml } from "./caixa/listPage";
import { fetchDetailPageHtml } from "./caixa/detail";
import { parseListPageHtml } from "./parsers/parseListPage";
import { parseDetailPageHtml } from "./parsers/parseDetailPage";
import { writeImoveisCsv } from "./fs-api/writeCsv";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

const CliSchema = z.object({
  uf: z.string().min(2),
  cidade: z.string().min(1),
  bairro: z.string().optional().default(""),
  tpVenda: z.string().optional().default("Selecione"),
  tpImovel: z.string().optional().default("Selecione"),
  areaUtil: z.string().optional().default("Selecione"),
  faixaVlr: z.string().optional().default("Selecione"),
  quartos: z.string().optional().default("Selecione"),
  vagas: z.string().optional().default("Selecione"),
  out: z.string().min(1).default("output.csv"),
  concurrency: z.coerce.number().int().min(1).max(10).default(3),
  minDelayMs: z.coerce.number().int().min(0).max(10_000).default(500),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  retries: z.coerce.number().int().min(0).max(8).default(4),
  maxPages: z.coerce.number().int().min(1).optional(),
  withDetails: z.coerce.boolean().default(false),
  detailsConcurrency: z.coerce.number().int().min(1).max(10).default(2)
});

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("scrape-caixa")
    .description("Scraper da lista de imóveis do Venda Imóveis Caixa (HTTP puro).")
    .requiredOption("--uf <UF>", "UF (ex: RJ)")
    .requiredOption("--cidade <id>", "ID da cidade (ex: 7084)")
    .option("--bairro <ids>", 'IDs de bairro (string), ex: "12345,23456" (default: vazio)', "")
    .option("--tpVenda <v>", 'hdn_tp_venda (default: "Selecione")', "Selecione")
    .option("--tpImovel <v>", 'hdn_tp_imovel (default: "Selecione")', "Selecione")
    .option("--areaUtil <v>", 'hdn_area_util (default: "Selecione")', "Selecione")
    .option("--faixaVlr <v>", 'hdn_faixa_vlr (default: "Selecione")', "Selecione")
    .option("--quartos <v>", 'hdn_quartos (default: "Selecione")', "Selecione")
    .option("--vagas <v>", 'hdn_vg_garagem (default: "Selecione")', "Selecione")
    .option("--out <path>", "Arquivo CSV de saída", "output.csv")
    .option("--concurrency <n>", "Concorrência (1-10)", "3")
    .option("--minDelayMs <ms>", "Delay mínimo entre requests (ms)", "500")
    .option("--timeoutMs <ms>", "Timeout por request (ms)", "20000")
    .option("--retries <n>", "Retries para 429/5xx (0-8)", "4")
    .option("--maxPages <n>", "Limitar páginas (útil para teste)")
    .option("--withDetails", "Buscar detalhes por imóvel (galeria de fotos + matrícula PDF)", false)
    .option("--detailsConcurrency <n>", "Concorrência para detalhes (1-10)", "2");

  program.parse(process.argv);
  const raw = program.opts();

  const cfg = CliSchema.parse({
    uf: raw.uf,
    cidade: raw.cidade,
    bairro: raw.bairro,
    tpVenda: raw.tpVenda,
    tpImovel: raw.tpImovel,
    areaUtil: raw.areaUtil,
    faixaVlr: raw.faixaVlr,
    quartos: raw.quartos,
    vagas: raw.vagas,
    out: raw.out,
    concurrency: raw.concurrency,
    minDelayMs: raw.minDelayMs,
    timeoutMs: raw.timeoutMs,
    retries: raw.retries,
    maxPages: raw.maxPages,
    withDetails: raw.withDetails,
    detailsConcurrency: raw.detailsConcurrency
  });

  const baseUrl = "https://venda-imoveis.caixa.gov.br";
  const referer = "https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp?sltTipoBusca=imoveis";

  const client = new HttpClient({
    baseUrl,
    origin: baseUrl,
    referer,
    userAgent: DEFAULT_UA,
    timeoutMs: cfg.timeoutMs,
    retries: cfg.retries,
    minDelayMs: cfg.minDelayMs
  });

  const payload: CaixaSearchPayload = {
    hdn_estado: cfg.uf,
    hdn_cidade: cfg.cidade,
    hdn_bairro: cfg.bairro ?? "",
    hdn_tp_venda: cfg.tpVenda,
    hdn_tp_imovel: cfg.tpImovel,
    hdn_area_util: cfg.areaUtil,
    hdn_faixa_vlr: cfg.faixaVlr,
    hdn_quartos: cfg.quartos,
    hdn_vg_garagem: cfg.vagas,
    strValorSimulador: "",
    strAceitaFGTS: "",
    strAceitaFinanciamento: ""
  };

  console.log(`[search] uf=${cfg.uf} cidade=${cfg.cidade} ...`);
  const search = await runSearch(client, payload);
  const totalPages = cfg.maxPages ? Math.min(cfg.maxPages, search.hdnImovByPage.length) : search.hdnImovByPage.length;
  console.log(`[search] qtdRegistros=${search.qtdRegistros} qtdPag=${search.qtdPag} pagesFound=${search.hdnImovByPage.length} scrapingPages=${totalPages}`);

  const limit = pLimit(cfg.concurrency);
  const results: ImovelListItem[] = [];

  const tasks: Array<Promise<ImovelListItem[]>> = [];
  for (let idx = 0; idx < totalPages; idx++) {
    const page = idx + 1;
    const hdnImov = search.hdnImovByPage[idx];
    if (!hdnImov) continue;
    tasks.push(
      limit(async () => {
        const html = await fetchListPageHtml(client, hdnImov);
        const items = parseListPageHtml({ html, uf: cfg.uf, cidadeId: cfg.cidade, page });
        console.log(`[page ${page}/${totalPages}] items=${items.length}`);
        return items;
      })
    );
  }

  const pages = await Promise.all(tasks);
  for (const p of pages) results.push(...p);

  // ordenação estável/determinística
  results.sort((a, b) => {
    const pa = a.page - b.page;
    if (pa !== 0) return pa;
    return a.imovelId.localeCompare(b.imovelId);
  });

  let finalItems: ImovelListItem[] = results;

  if (cfg.withDetails) {
    console.log(`[details] fetching details for ${results.length} rows (unique cache enabled)...`);
    const limitDetails = pLimit(cfg.detailsConcurrency);
    const cache = new Map<string, Promise<ReturnType<typeof parseDetailPageHtml>>>();

    const getDetail = (imovelId: string) => {
      const existing = cache.get(imovelId);
      if (existing) return existing;
      const p = limitDetails(async () => {
        try {
          const html = await fetchDetailPageHtml(client, imovelId);
          return parseDetailPageHtml(html);
        } catch (err) {
          console.warn(`[details] failed imovelId=${imovelId}: ${String(err)}`);
          return {};
        }
      });
      cache.set(imovelId, p);
      return p;
    };

    finalItems = await Promise.all(
      results.map(async (item) => {
        const d = await getDetail(item.imovelId);
        const galeriaFotoFilenames = d.galeriaFotoFilenames?.length ? d.galeriaFotoFilenames.join("|") : undefined;
        const galeriaFotoUrls = d.galeriaFotoUrls?.length ? d.galeriaFotoUrls.join("|") : undefined;
        const detalheMatriculas = d.matriculas?.length ? d.matriculas.join("|") : undefined;

        return {
          ...item,
          ...(d.matriculaPdfUrl ? { matriculaPdfUrl: d.matriculaPdfUrl } : {}),
          ...(galeriaFotoFilenames ? { galeriaFotoFilenames } : {}),
          ...(galeriaFotoUrls ? { galeriaFotoUrls } : {})
          ,
          ...(d.tipoImovel ? { detalheTipoImovel: d.tipoImovel } : {}),
          ...(d.quartos !== undefined ? { detalheQuartos: d.quartos } : {}),
          ...(d.garagem !== undefined ? { detalheGaragem: d.garagem } : {}),
          ...(d.numeroImovel ? { detalheNumeroImovel: d.numeroImovel } : {}),
          ...(detalheMatriculas ? { detalheMatriculas } : {}),
          ...(d.comarca ? { detalheComarca: d.comarca } : {}),
          ...(d.oficio ? { detalheOficio: d.oficio } : {}),
          ...(d.inscricaoImobiliaria ? { detalheInscricaoImobiliaria: d.inscricaoImobiliaria } : {}),
          ...(d.averbacaoLeiloesNegativos ? { detalheAverbacaoLeiloesNegativos: d.averbacaoLeiloesNegativos } : {}),
          ...(d.areaTotalM2 !== undefined ? { detalheAreaTotalM2: d.areaTotalM2 } : {}),
          ...(d.areaPrivativaM2 !== undefined ? { detalheAreaPrivativaM2: d.areaPrivativaM2 } : {}),
          ...(d.endereco ? { detalheEndereco: d.endereco } : {}),
          ...(d.descricao ? { detalheDescricao: d.descricao } : {}),
          ...(d.formasPagamentoRaw ? { detalheFormasPagamentoRaw: d.formasPagamentoRaw } : {}),
          ...(d.aceitaRecursosProprios !== undefined ? { detalheAceitaRecursosProprios: d.aceitaRecursosProprios } : {}),
          ...(d.aceitaFGTS !== undefined ? { detalheAceitaFGTS: d.aceitaFGTS } : {}),
          ...(d.aceitaFinanciamento !== undefined ? { detalheAceitaFinanciamento: d.aceitaFinanciamento } : {})
        };
      })
    );
  }

  await writeImoveisCsv(cfg.out, finalItems);
  console.log(`[done] wrote=${cfg.out} rows=${results.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});



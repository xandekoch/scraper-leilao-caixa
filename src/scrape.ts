import pLimit from "p-limit";
import type { CaixaSearchPayload, ImovelListItem } from "./models";
import { HttpClient } from "./caixa/httpClient";
import { runSearch } from "./caixa/search";
import { fetchListPageHtml } from "./caixa/listPage";
import { fetchDetailPageHtml } from "./caixa/detail";
import { parseListPageHtml } from "./parsers/parseListPage";
import { parseDetailPageHtml } from "./parsers/parseDetailPage";
import { writeImoveisCsv } from "./fs-api/writeCsv";

export type ScrapeOptions = Readonly<{
  uf: string;
  cidade: string;
  bairro: string;
  tpVenda: string;
  tpImovel: string;
  areaUtil: string;
  faixaVlr: string;
  quartos: string;
  vagas: string;
  out: string;
  concurrency: number;
  minDelayMs: number;
  timeoutMs: number;
  retries: number;
  maxPages?: number;
  withDetails: boolean;
  detailsConcurrency: number;
}>;

export type ScrapeResult = Readonly<{
  outPath: string;
  rows: number;
}>;

export type LogFn = (line: string) => void;

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export async function scrapeCaixa(opts: ScrapeOptions, log: LogFn = () => {}): Promise<ScrapeResult> {
  const baseUrl = "https://venda-imoveis.caixa.gov.br";
  const referer = "https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp?sltTipoBusca=imoveis";

  const client = new HttpClient({
    baseUrl,
    origin: baseUrl,
    referer,
    userAgent: DEFAULT_UA,
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
    minDelayMs: opts.minDelayMs
  });

  const payload: CaixaSearchPayload = {
    hdn_estado: opts.uf,
    hdn_cidade: opts.cidade,
    hdn_bairro: opts.bairro ?? "",
    hdn_tp_venda: opts.tpVenda,
    hdn_tp_imovel: opts.tpImovel,
    hdn_area_util: opts.areaUtil,
    hdn_faixa_vlr: opts.faixaVlr,
    hdn_quartos: opts.quartos,
    hdn_vg_garagem: opts.vagas,
    strValorSimulador: "",
    strAceitaFGTS: "",
    strAceitaFinanciamento: ""
  };

  log(`[search] uf=${opts.uf} cidade=${opts.cidade} ...`);
  const search = await runSearch(client, payload);
  const totalPages = opts.maxPages ? Math.min(opts.maxPages, search.hdnImovByPage.length) : search.hdnImovByPage.length;
  log(
    `[search] qtdRegistros=${search.qtdRegistros} qtdPag=${search.qtdPag} pagesFound=${search.hdnImovByPage.length} scrapingPages=${totalPages}`
  );

  const limit = pLimit(opts.concurrency);
  const results: ImovelListItem[] = [];

  const tasks: Array<Promise<ImovelListItem[]>> = [];
  for (let idx = 0; idx < totalPages; idx++) {
    const page = idx + 1;
    const hdnImov = search.hdnImovByPage[idx];
    if (!hdnImov) continue;
    tasks.push(
      limit(async () => {
        const html = await fetchListPageHtml(client, hdnImov);
        const items = parseListPageHtml({ html, uf: opts.uf, cidadeId: opts.cidade, page });
        log(`[page ${page}/${totalPages}] items=${items.length}`);
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

  if (opts.withDetails) {
    log(`[details] fetching details for ${results.length} rows (unique cache enabled)...`);
    const limitDetails = pLimit(opts.detailsConcurrency);
    const cache = new Map<string, Promise<ReturnType<typeof parseDetailPageHtml>>>();

    const getDetail = (imovelId: string) => {
      const existing = cache.get(imovelId);
      if (existing) return existing;
      const p = limitDetails(async () => {
        try {
          const html = await fetchDetailPageHtml(client, imovelId);
          return parseDetailPageHtml(html);
        } catch (err) {
          log(`[details] failed imovelId=${imovelId}: ${String(err)}`);
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
          ...(galeriaFotoUrls ? { galeriaFotoUrls } : {}),
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

  await writeImoveisCsv(opts.out, finalItems);
  log(`[done] wrote=${opts.out} rows=${finalItems.length}`);

  return { outPath: opts.out, rows: finalItems.length };
}



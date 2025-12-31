import * as cheerio from "cheerio";
import { parseBrazilianNumber } from "../models";

export type ImovelDetailExtract = Readonly<{
  matriculaPdfUrl?: string;
  galeriaFotoFilenames?: string[];
  galeriaFotoUrls?: string[];
  tipoImovel?: string;
  quartos?: number;
  garagem?: number;
  numeroImovel?: string;
  matriculas?: string[];
  comarca?: string;
  oficio?: string;
  inscricaoImobiliaria?: string;
  averbacaoLeiloesNegativos?: string;
  areaTotalM2?: number;
  areaPrivativaM2?: number;
  endereco?: string;
  descricao?: string;
  formasPagamentoRaw?: string;
  aceitaRecursosProprios?: boolean;
  aceitaFGTS?: boolean;
  aceitaFinanciamento?: boolean;
}>;

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
}

function toAbsolute(base: string, maybeRelative: string): string {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return new URL(maybeRelative, base).toString();
}

function cleanText(raw: string | undefined): string | undefined {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

function pickStrongValue($: cheerio.CheerioAPI, label: string): string | undefined {
  const span = $(`span:contains("${label}")`).first();
  const strong = span.find("strong").first();
  return cleanText(strong.text());
}

export function parseDetailPageHtml(html: string): ImovelDetailExtract {
  const base = "https://venda-imoveis.caixa.gov.br";
  const $ = cheerio.load(html);

  // Matrícula PDF
  const matriculaPdfUrl = (() => {
    // padrão: onclick=javascript:ExibeDoc('/editais/matricula/RJ/8555....pdf')
    const onclick =
      $("a[onclick*='ExibeDoc']").first().attr("onclick") ??
      $("a:contains('Baixar matrícula')").first().attr("onclick") ??
      "";

    const m =
      onclick.match(/ExibeDoc\('([^']+)'\)/) ??
      onclick.match(/ExibeDoc\(\"([^\"]+)\"\)/);
    if (m?.[1]) return toAbsolute(base, m[1]);

    // fallback: procurar href direto apontando pra PDF
    const href = $("a[href$='.pdf']").first().attr("href");
    return href ? toAbsolute(base, href) : undefined;
  })();

  // Galeria de fotos
  const galeriaSrcs: string[] = [];

  $("#galeria-imagens img").each((_i, el) => {
    const img = $(el);
    const src = img.attr("src");
    if (src && src.includes("/fotos/")) galeriaSrcs.push(src);

    const onclick = img.attr("onclick") ?? "";
    const m =
      onclick.match(/preview\.src\s*=\s*\"([^\"]+)\"/) ??
      onclick.match(/preview\.src\s*=\s*'([^']+)'/);
    if (m?.[1] && m[1].includes("/fotos/")) galeriaSrcs.push(m[1]);
  });

  const galeriaFotoUrls = uniq(galeriaSrcs).map((s) => toAbsolute(base, s));
  const galeriaFotoFilenames = galeriaFotoUrls
    .map((u) => {
      const noQuery = u.split("?")[0] ?? u;
      const parts = noQuery.split("/").filter(Boolean);
      return parts[parts.length - 1] ?? "";
    })
    .filter(Boolean);

  // Campos textuais do detalhe
  const tipoImovel = pickStrongValue($, "Tipo de imóvel");
  const quartos = (() => {
    const raw = pickStrongValue($, "Quartos");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : undefined;
  })();
  const garagem = (() => {
    const raw = pickStrongValue($, "Garagem");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : undefined;
  })();
  const numeroImovel = pickStrongValue($, "Número do imóvel");
  const matriculas = (() => {
    const raw = pickStrongValue($, "Matrícula");
    if (!raw) return undefined;
    const parts = raw
      .split(/[,\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  })();
  const comarca = pickStrongValue($, "Comarca");
  const oficio = pickStrongValue($, "Ofício");
  const inscricaoImobiliaria = pickStrongValue($, "Inscrição imobiliária");
  const averbacaoLeiloesNegativos = pickStrongValue($, "Averbação dos leilões negativos");

  const areaTotalM2 = (() => {
    const raw = cleanText($("span:contains(\"Área total\") strong").first().text());
    const num = raw?.match(/([\d\.,]+)/)?.[1];
    return num ? parseBrazilianNumber(num) : undefined;
  })();
  const areaPrivativaM2 = (() => {
    const raw = cleanText($("span:contains(\"Área privativa\") strong").first().text());
    const num = raw?.match(/([\d\.,]+)/)?.[1];
    return num ? parseBrazilianNumber(num) : undefined;
  })();

  const relatedBoxText = cleanText($(".related-box").first().text());
  const endereco = (() => {
    const p = $(".related-box p:contains('Endereço:')").first();
    const t = cleanText(p.text());
    if (!t) return undefined;
    return cleanText(t.replace(/^Endereço:\s*/i, ""));
  })();
  const descricao = (() => {
    const p = $(".related-box p:contains('Descrição:')").first();
    const t = cleanText(p.text());
    if (!t) return undefined;
    return cleanText(t.replace(/^Descrição:\s*/i, ""));
  })();

  const formasPagamentoRaw = (() => {
    if (!relatedBoxText) return undefined;
    const start = relatedBoxText.toUpperCase().indexOf("FORMAS DE PAGAMENTO ACEITAS:");
    if (start === -1) return undefined;
    const tail = relatedBoxText.slice(start);
    const end = tail.toUpperCase().indexOf("REGRAS PARA PAGAMENTO");
    const section = end === -1 ? tail : tail.slice(0, end);
    return cleanText(section);
  })();

  const aceitaRecursosProprios = formasPagamentoRaw
    ? /recursos próprios/i.test(formasPagamentoRaw)
      ? true
      : undefined
    : undefined;
  const aceitaFGTS = formasPagamentoRaw
    ? /permite\s+utiliza(?:ç|c)[aã]o\s+de\s+fgts/i.test(formasPagamentoRaw)
      ? true
      : undefined
    : undefined;
  const aceitaFinanciamento = formasPagamentoRaw
    ? /financiamento/i.test(formasPagamentoRaw)
      ? true
      : undefined
    : undefined;

  return {
    ...(matriculaPdfUrl ? { matriculaPdfUrl } : {}),
    ...(galeriaFotoUrls.length ? { galeriaFotoUrls } : {}),
    ...(galeriaFotoFilenames.length ? { galeriaFotoFilenames } : {}),
    ...(tipoImovel ? { tipoImovel } : {}),
    ...(quartos !== undefined ? { quartos } : {}),
    ...(garagem !== undefined ? { garagem } : {}),
    ...(numeroImovel ? { numeroImovel } : {}),
    ...(matriculas ? { matriculas } : {}),
    ...(comarca ? { comarca } : {}),
    ...(oficio ? { oficio } : {}),
    ...(inscricaoImobiliaria ? { inscricaoImobiliaria } : {}),
    ...(averbacaoLeiloesNegativos ? { averbacaoLeiloesNegativos } : {}),
    ...(areaTotalM2 !== undefined ? { areaTotalM2 } : {}),
    ...(areaPrivativaM2 !== undefined ? { areaPrivativaM2 } : {}),
    ...(endereco ? { endereco } : {}),
    ...(descricao ? { descricao } : {}),
    ...(formasPagamentoRaw ? { formasPagamentoRaw } : {}),
    ...(aceitaRecursosProprios !== undefined ? { aceitaRecursosProprios } : {}),
    ...(aceitaFGTS !== undefined ? { aceitaFGTS } : {}),
    ...(aceitaFinanciamento !== undefined ? { aceitaFinanciamento } : {})
  };
}



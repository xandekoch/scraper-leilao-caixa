import * as cheerio from "cheerio";
import type { ImovelListItem, Uf } from "../models";
import { parseBRL, parseBrazilianNumber } from "../models";

function firstMatch(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m?.[1]?.trim() || undefined;
}

export function parseListPageHtml(args: Readonly<{
  html: string;
  uf: Uf;
  cidadeId: string;
  page: number;
}>): ImovelListItem[] {
  const { html, uf, cidadeId, page } = args;
  const $ = cheerio.load(html);

  const items: ImovelListItem[] = [];

  // Cada imóvel aparece em li.group-block-item
  $("li.group-block-item").each((_idx, el) => {
    const card = $(el);

    const onclick =
      card.find("[onclick*='detalhe_imovel']").first().attr("onclick") ??
      card.find("img[onclick*='detalhe_imovel']").first().attr("onclick") ??
      "";
    const imovelId = firstMatch(onclick, /detalhe_imovel\((\d+)\)/);
    if (!imovelId) return;

    const titulo = card
      .find("a[onclick*='detalhe_imovel']")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const modalidade =
      card.find("div[id^='divContador'] b").first().text().replace(/\s+/g, " ").trim() ||
      undefined;

    const cardText = card.text().replace(/\s+/g, " ").trim();

    const valorAvaliacao = (() => {
      const raw = firstMatch(cardText, /Valor de avaliação:\s*R\$\s*([\d\.\,]+)/i);
      return raw ? parseBRL(raw) : undefined;
    })();

    const valorMinimo = (() => {
      const raw = firstMatch(cardText, /Valor mínimo de venda:\s*R\$\s*([\d\.\,]+)/i);
      return raw ? parseBRL(raw) : undefined;
    })();

    const descontoPercent = (() => {
      const raw = firstMatch(cardText, /desconto de\s*([\d\.\,]+)\s*%/i);
      return raw ? parseBrazilianNumber(raw) : undefined;
    })();

    // Bloco de descrição (tipo/area/quartos/vaga/modalidade) + número + endereço/obs
    const detailsFont = card
      .find("font")
      .filter((_i, f) => (card.find(f).attr("style") ?? "").includes("0.75em"))
      .first();

    const detailsHtml = (detailsFont.html() ?? "").replace(/<br\s*\/?>/gi, "\n");
    const detailsText = cheerio.load(`<div>${detailsHtml}</div>`)("div")
      .text()
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const firstLine = detailsText[0] ?? "";
    const tipoImovel = firstMatch(firstLine, /^(.+?)\s*-\s*/);
    const areaUtilM2 = (() => {
      const raw = firstMatch(firstLine, /-\s*([\d\.\,]+)\s*m2/i);
      return raw ? parseBrazilianNumber(raw) : undefined;
    })();
    const quartos = (() => {
      const raw = firstMatch(firstLine, /,\s*(\d+)\s*quarto/i);
      return raw ? Number(raw) : undefined;
    })();
    const vagas = (() => {
      const raw = firstMatch(firstLine, /,\s*(\d+)\s*vaga/i);
      return raw ? Number(raw) : undefined;
    })();
    const modalidadeLinha = (() => {
      // último " - " costuma ser a modalidade (ex: Venda Direta Online)
      const parts = firstLine.split(" - ").map((p) => p.trim()).filter(Boolean);
      return parts.length >= 2 ? parts[parts.length - 1] : undefined;
    })();

    // Endereço e observações (heurística: linha após "Número do imóvel:" até "Despesas do imóvel" etc)
    const joined = detailsText.join("\n");
    const afterNumero = joined.split(/Número do imóvel:\s*/i)[1];
    const enderecoObsRaw = afterNumero ? afterNumero.split("\n").slice(1).join("\n").trim() : undefined;
    const [enderecoRaw, observacoesRaw] = (() => {
      if (!enderecoObsRaw) return [undefined, undefined] as const;
      const idx = enderecoObsRaw.search(/Despesas do imóvel/i);
      if (idx === -1) return [enderecoObsRaw, undefined] as const;
      return [enderecoObsRaw.slice(0, idx).trim(), enderecoObsRaw.slice(idx).trim()] as const;
    })();

    const modalidadeFinal = (modalidadeLinha || modalidade)?.trim();

    const item: ImovelListItem = {
      imovelId,
      uf,
      cidadeId,
      titulo,
      page,
      ...(modalidadeFinal ? { modalidade: modalidadeFinal } : {}),
      ...(tipoImovel ? { tipoImovel } : {}),
      ...(areaUtilM2 !== undefined ? { areaUtilM2 } : {}),
      ...(quartos !== undefined ? { quartos } : {}),
      ...(vagas !== undefined ? { vagas } : {}),
      ...(valorAvaliacao !== undefined ? { valorAvaliacao } : {}),
      ...(valorMinimo !== undefined ? { valorMinimo } : {}),
      ...(descontoPercent !== undefined ? { descontoPercent } : {}),
      ...(enderecoRaw ? { enderecoRaw } : {}),
      ...(observacoesRaw ? { observacoesRaw } : {})
    };

    items.push(item);
  });

  return items;
}



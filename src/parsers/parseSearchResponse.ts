import * as cheerio from "cheerio";
import type { CaixaSearchResult } from "../models";

function parseIntStrict(raw: string | undefined): number {
  const v = (raw ?? "").trim();
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Expected integer, got: "${raw ?? ""}"`);
  }
  return n;
}

export function parseSearchResponse(html: string): CaixaSearchResult {
  const $ = cheerio.load(html);

  const qtdPag = parseIntStrict($("#hdnQtdPag").attr("value"));
  const qtdRegistros = parseIntStrict($("#hdnQtdRegistros").attr("value"));
  const hdnFiltro = $("#hdnFiltro").attr("value")?.trim();

  const hdnImovByPage: string[] = [];
  for (let i = 1; ; i++) {
    const v = $(`#hdnImov${i}`).attr("value");
    if (!v) break;
    hdnImovByPage.push(v);
  }

  if (hdnImovByPage.length === 0) {
    throw new Error("Search response did not include any hdnImov{N} inputs.");
  }

  // Algumas respostas podem ter divergência; preferimos confiar no array real.
  const base: CaixaSearchResult = {
    hdnImovByPage,
    qtdPag: qtdPag > 0 ? qtdPag : hdnImovByPage.length,
    qtdRegistros
  };
  return hdnFiltro ? { ...base, hdnFiltro } : base;
}



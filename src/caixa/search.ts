import type { CaixaSearchPayload, CaixaSearchResult } from "../models";
import { parseSearchResponse } from "../parsers/parseSearchResponse";
import { HttpClient } from "./httpClient";

export async function runSearch(client: HttpClient, payload: CaixaSearchPayload): Promise<CaixaSearchResult> {
  // Estabelece sessão/cookies antes do POST (muito comum em ASP clássico)
  await client.get("/sistema/busca-imovel.asp?sltTipoBusca=imoveis");

  const res = await client.postForm("/sistema/carregaPesquisaImoveis.asp", payload, {
    headers: { "x-requested-with": "XMLHttpRequest" }
  });
  if (res.status !== 200) {
    throw new Error(`Search failed: HTTP ${res.status}`);
  }
  return parseSearchResponse(res.text);
}



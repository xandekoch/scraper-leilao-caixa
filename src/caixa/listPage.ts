import { HttpClient } from "./httpClient";

export async function fetchListPageHtml(client: HttpClient, hdnImov: string): Promise<string> {
  const res = await client.postForm(
    "/sistema/carregaListaImoveis.asp",
    { hdnImov },
    { headers: { "x-requested-with": "XMLHttpRequest" } }
  );
  if (res.status !== 200) {
    throw new Error(`List page failed: HTTP ${res.status}`);
  }
  return res.text;
}



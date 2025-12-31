import { HttpClient } from "./httpClient";

export async function fetchDetailPageHtml(client: HttpClient, imovelId: string): Promise<string> {
  const res = await client.postForm(
    "/sistema/detalhe-imovel.asp",
    { hdnimovel: imovelId },
    {
      headers: {
        // detalhe é navegação "normal" (não XHR)
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded"
      }
    }
  );

  if (res.status !== 200) {
    throw new Error(`Detail page failed: HTTP ${res.status} (imovelId=${imovelId})`);
  }
  return res.text;
}



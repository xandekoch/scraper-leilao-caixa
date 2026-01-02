/**
 * Script 1x: gera um JSON com { UF -> [{ id, nome }] } consultando o endpoint
 * https://venda-imoveis.caixa.gov.br/sistema/carregaListaCidades.asp
 *
 * Uso:
 *   node scripts/fetch-estados-cidades.js
 *
 * Saída:
 *   output/estados-cidades.json
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const BASE = "https://venda-imoveis.caixa.gov.br";
const REFERER = `${BASE}/sistema/busca-imovel.asp?sltTipoBusca=imoveis`;

const ESTADOS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO"
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultHeaders() {
  return {
    accept: "*/*",
    "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    origin: BASE,
    referer: REFERER,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
  };
}

/**
 * Cookie jar minimalista (suficiente pra endpoints ASP clássicos).
 * Mantém "name=value" e reusa em requests seguintes.
 */
function createCookieJar() {
  const jar = new Map();

  function setFromSetCookie(setCookie) {
    if (!setCookie) return;
    // set-cookie: "ASPSESSIONID...=...; path=/; ..."
    const first = String(setCookie).split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) return;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (!name) return;
    jar.set(name, value);
  }

  function cookieHeaderValue() {
    if (jar.size === 0) return "";
    return Array.from(jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  return { setFromSetCookie, cookieHeaderValue };
}

async function fetchWithCookies(url, init, cookieJar) {
  const headers = { ...defaultHeaders(), ...(init.headers || {}) };
  const cookie = cookieJar.cookieHeaderValue();
  if (cookie) headers.cookie = cookie;

  const res = await fetch(url, { ...init, headers });

  // Node (undici) expõe getSetCookie() em versões recentes
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (Array.isArray(setCookies)) {
    for (const sc of setCookies) cookieJar.setFromSetCookie(sc);
  } else {
    // fallback: tenta o header único (pode não cobrir múltiplos)
    cookieJar.setFromSetCookie(res.headers.get("set-cookie"));
  }

  return res;
}

function parseOptionsHtml(optionsHtml) {
  // Captura <option value='7269'> ACARI<br>
  const out = [];
  const re = /<option\s+value\s*=\s*['"]?(\d+)['"]?\s*>\s*([\s\S]*?)<br\s*\/?>/gi;
  let m;
  while ((m = re.exec(optionsHtml))) {
    const id = m[1];
    const nome = String(m[2] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!id || !nome) continue;
    out.push({ id, nome });
  }

  // Dedup por id (e ordena por nome)
  const byId = new Map();
  for (const c of out) byId.set(c.id, c.nome);
  return Array.from(byId.entries())
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

async function fetchCidadesPorEstado(uf, cookieJar, filters) {
  const url = `${BASE}/sistema/carregaListaCidades.asp`;
  const body = new URLSearchParams({
    cmb_estado: uf,
    // IMPORTANTE:
    // Esse endpoint não é uma "lista master" de cidades; ele costuma retornar as cidades
    // que possuem imóveis PARA a combinação de filtros informada.
    //
    // Para pegar a lista mais ampla possível (sem restringir por filtros), enviamos vazio.
    cmb_tp_venda: "",
    cmb_tp_imovel: "",
    cmb_area_util: "",
    cmb_faixa_vlr: "",
    cmb_quartos: "",
    cmb_vg_garagem: "",
    strValorSimulador: "",
    strAceitaFGTS: "",
    strAceitaFinanciamento: ""
  });

  const res = await fetchWithCookies(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
      },
      body
    },
    cookieJar
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ao buscar cidades de ${uf}. Body (início): ${text.slice(0, 120)}`);
  }

  const html = await res.text();
  return parseOptionsHtml(html);
}

async function main() {
  const cookieJar = createCookieJar();

  // hit 1º a página base pra setar cookies de sessão
  await fetchWithCookies(REFERER, { method: "GET" }, cookieJar);

  const estados = {};

  for (const uf of ESTADOS) {
    // delay leve pra não incomodar o endpoint
    await sleep(250);
    const cidades = await fetchCidadesPorEstado(uf, cookieJar);
    estados[uf] = cidades;
    console.log(`[${uf}] cidades=${cidades.length}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: `${BASE}/sistema/carregaListaCidades.asp`,
    estados
  };

  const outDir = path.join(process.cwd(), "output");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "estados-cidades.json");
  await fs.writeFile(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(`[done] wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});



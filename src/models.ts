export type Uf = string; // "RJ", "SP", ...

export type CaixaSearchPayload = Readonly<{
  hdn_estado: Uf;
  hdn_cidade: string; // ex: "7084"
  hdn_bairro: string; // "" ou "12345,23456" etc
  hdn_tp_venda: string; // "Selecione" (indiferente) ou código/modalidade
  hdn_tp_imovel: string; // ex: "4"
  hdn_area_util: string; // ex: "0"
  hdn_faixa_vlr: string; // ex: "1"
  hdn_quartos: string; // ex: "0"
  hdn_vg_garagem: string; // ex: "0"
  strValorSimulador: string;
  strAceitaFGTS: string;
  strAceitaFinanciamento: string;
}>;

export type CaixaSearchResult = Readonly<{
  hdnImovByPage: string[]; // index 0 => page 1
  qtdPag: number;
  qtdRegistros: number;
  hdnFiltro?: string;
}>;

export type ImovelListItem = Readonly<{
  imovelId: string;
  uf: Uf;
  cidadeId: string;
  titulo: string;
  fotoFilename?: string;
  fotoUrl?: string;
  modalidade?: string;
  tipoImovel?: string;
  areaUtilM2?: number;
  quartos?: number;
  vagas?: number;
  valorAvaliacao?: number;
  valorMinimo?: number;
  descontoPercent?: number;
  enderecoRaw?: string;
  observacoesRaw?: string;
  page: number;
}>;

export function parseBrazilianNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

export function parseBRL(raw: string): number | undefined {
  // Aceita: "R$ 117.000,00" / "117.000,00"
  const cleaned = raw.replace(/R\$\s*/i, "").trim();
  return parseBrazilianNumber(cleaned);
}



import { stringify } from "csv-stringify/sync";
import type { ImovelListItem } from "../models";
import { writeFile } from "node:fs/promises";

const COLUMNS: ReadonlyArray<keyof ImovelListItem> = [
  "imovelId",
  "uf",
  "cidadeId",
  "titulo",
  "modalidade",
  "tipoImovel",
  "areaUtilM2",
  "quartos",
  "vagas",
  "valorAvaliacao",
  "valorMinimo",
  "descontoPercent",
  "enderecoRaw",
  "observacoesRaw",
  "page"
];

export async function writeImoveisCsv(outPath: string, items: ImovelListItem[]): Promise<void> {
  const csv = stringify(items, {
    header: true,
    columns: COLUMNS as string[],
    quoted_match: /\n|,|"/
  });
  await writeFile(outPath, csv, "utf-8");
}



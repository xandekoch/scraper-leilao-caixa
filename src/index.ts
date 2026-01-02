import { Command } from "commander";
import { z } from "zod";
import { scrapeCaixa } from "./scrape";

const CliSchema = z.object({
  uf: z.string().min(2),
  cidade: z.string().min(1),
  bairro: z.string().optional().default(""),
  tpVenda: z.string().optional().default("Selecione"),
  tpImovel: z.string().optional().default("Selecione"),
  areaUtil: z.string().optional().default("Selecione"),
  faixaVlr: z.string().optional().default("Selecione"),
  quartos: z.string().optional().default("Selecione"),
  vagas: z.string().optional().default("Selecione"),
  out: z.string().min(1).default("output/output.csv"),
  concurrency: z.coerce.number().int().min(1).max(10).default(3),
  minDelayMs: z.coerce.number().int().min(0).max(10_000).default(500),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  retries: z.coerce.number().int().min(0).max(8).default(4),
  maxPages: z.coerce.number().int().min(1).optional(),
  withDetails: z.coerce.boolean().default(false),
  detailsConcurrency: z.coerce.number().int().min(1).max(10).default(2)
});

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("scrape-caixa")
    .description("Scraper da lista de imóveis do Venda Imóveis Caixa (HTTP puro).")
    .requiredOption("--uf <UF>", "UF (ex: RJ)")
    .requiredOption("--cidade <id>", "ID da cidade (ex: 7084)")
    .option("--bairro <ids>", 'IDs de bairro (string), ex: "12345,23456" (default: vazio)', "")
    .option("--tpVenda <v>", 'hdn_tp_venda (default: "Selecione")', "Selecione")
    .option("--tpImovel <v>", 'hdn_tp_imovel (default: "Selecione")', "Selecione")
    .option("--areaUtil <v>", 'hdn_area_util (default: "Selecione")', "Selecione")
    .option("--faixaVlr <v>", 'hdn_faixa_vlr (default: "Selecione")', "Selecione")
    .option("--quartos <v>", 'hdn_quartos (default: "Selecione")', "Selecione")
    .option("--vagas <v>", 'hdn_vg_garagem (default: "Selecione")', "Selecione")
    .option("--out <path>", "Arquivo CSV de saída", "output/output.csv")
    .option("--concurrency <n>", "Concorrência (1-10)", "3")
    .option("--minDelayMs <ms>", "Delay mínimo entre requests (ms)", "500")
    .option("--timeoutMs <ms>", "Timeout por request (ms)", "20000")
    .option("--retries <n>", "Retries para 429/5xx (0-8)", "4")
    .option("--maxPages <n>", "Limitar páginas (útil para teste)")
    .option("--withDetails", "Buscar detalhes por imóvel (galeria de fotos + matrícula PDF)", false)
    .option("--detailsConcurrency <n>", "Concorrência para detalhes (1-10)", "2");

  program.parse(process.argv);
  const raw = program.opts();

  const cfg = CliSchema.parse({
    uf: raw.uf,
    cidade: raw.cidade,
    bairro: raw.bairro,
    tpVenda: raw.tpVenda,
    tpImovel: raw.tpImovel,
    areaUtil: raw.areaUtil,
    faixaVlr: raw.faixaVlr,
    quartos: raw.quartos,
    vagas: raw.vagas,
    out: raw.out,
    concurrency: raw.concurrency,
    minDelayMs: raw.minDelayMs,
    timeoutMs: raw.timeoutMs,
    retries: raw.retries,
    maxPages: raw.maxPages,
    withDetails: raw.withDetails,
    detailsConcurrency: raw.detailsConcurrency
  });

  await scrapeCaixa(
    {
      uf: cfg.uf,
      cidade: cfg.cidade,
      bairro: cfg.bairro,
      tpVenda: cfg.tpVenda,
      tpImovel: cfg.tpImovel,
      areaUtil: cfg.areaUtil,
      faixaVlr: cfg.faixaVlr,
      quartos: cfg.quartos,
      vagas: cfg.vagas,
      out: cfg.out,
      concurrency: cfg.concurrency,
      minDelayMs: cfg.minDelayMs,
      timeoutMs: cfg.timeoutMs,
      retries: cfg.retries,
      withDetails: cfg.withDetails,
      detailsConcurrency: cfg.detailsConcurrency,
      ...(cfg.maxPages !== undefined ? { maxPages: cfg.maxPages } : {})
    },
    (line) => console.log(line)
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});



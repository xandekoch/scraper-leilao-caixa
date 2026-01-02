import express, { type Request, type Response } from "express";
import { readFile, readdir, stat } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parse as parseCsv } from "csv-parse/sync";
import { scrapeCaixa } from "./scrape";

type JobStatus = "queued" | "running" | "done" | "error";

type Job = {
  id: string;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  params: unknown;
  logs: string[];
  outPath?: string;
  rows?: number;
  error?: string;
};

const app = express();
app.use(express.json({ limit: "1mb" }));

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "output");

function safeOutputCsvPath(fileBase: string): string {
  const cleaned = fileBase
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  const name = cleaned.length ? cleaned : `output-${Date.now()}`;
  return path.join(OUTPUT_DIR, `${name}.csv`);
}

function safeOutputFileName(fileName: string): string | null {
  // impede path traversal
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) return null;
  if (!fileName.toLowerCase().endsWith(".csv")) return null;
  return fileName;
}

function nowId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const jobs = new Map<string, Job>();

const ScrapeRequestSchema = z.object({
  uf: z.string().min(2),
  cidade: z.string().min(1),
  bairro: z.string().optional().default(""),
  modalidade: z.string().optional().default("Selecione"), // tpVenda
  tpImovel: z.string().optional().default("Selecione"),
  quartos: z.string().optional().default("Selecione"),
  vagas: z.string().optional().default("Selecione"),
  areaUtil: z.string().optional().default("Selecione"),
  faixaVlr: z.string().optional().default("Selecione"),
  withDetails: z.boolean().optional().default(false),
  maxPages: z.number().int().min(1).optional(),
  concurrency: z.number().int().min(1).max(10).optional().default(3),
  detailsConcurrency: z.number().int().min(1).max(10).optional().default(2),
  minDelayMs: z.number().int().min(0).max(10_000).optional().default(500),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional().default(20_000),
  retries: z.number().int().min(0).max(8).optional().default(4),
  outFileBase: z.string().optional() // sem extensão; sempre salva em output/
});

app.get("/", async (_req: Request, res: Response) => {
  const html = await readFile(path.join(ROOT, "web", "index.html"), "utf-8");
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(html);
});

app.get("/api/estados-cidades", async (_req: Request, res: Response) => {
  try {
    const json = await readFile(path.join(OUTPUT_DIR, "estados-cidades.json"), "utf-8");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.send(json);
  } catch {
    res.status(404).json({
      error:
        "Arquivo output/estados-cidades.json não encontrado. Rode: node scripts/fetch-estados-cidades.js"
    });
  }
});

app.get("/api/outputs", async (_req: Request, res: Response) => {
  const entries = await readdir(OUTPUT_DIR).catch(() => []);
  const csvs: { name: string; size: number; mtimeMs: number }[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    const st = await stat(path.join(OUTPUT_DIR, name)).catch(() => null);
    if (!st) continue;
    csvs.push({ name, size: st.size, mtimeMs: st.mtimeMs });
  }
  csvs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  res.json({ files: csvs });
});

app.get("/api/outputs/:name", async (req: Request<{ name: string }>, res: Response) => {
  const safe = safeOutputFileName(req.params.name);
  if (!safe) return res.status(400).json({ error: "invalid file" });
  const p = path.join(OUTPUT_DIR, safe);
  const csv = await readFile(p, "utf-8");
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.send(csv);
});

app.get("/api/outputs/:name/json", async (req: Request<{ name: string }>, res: Response) => {
  const safe = safeOutputFileName(req.params.name);
  if (!safe) return res.status(400).json({ error: "invalid file" });
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit ?? 200)));
  const p = path.join(OUTPUT_DIR, safe);
  const csv = await readFile(p, "utf-8");
  const records = parseCsv(csv, { columns: true, skip_empty_lines: true });
  const rows = Array.isArray(records) ? records.slice(0, limit) : [];
  res.json({ rows, limit });
});

app.post("/api/scrape", async (req: Request, res: Response) => {
  const parsed = ScrapeRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const cfg = parsed.data;
  const outPath = safeOutputCsvPath(
    cfg.outFileBase ??
      `${cfg.uf}-${cfg.cidade}-${cfg.modalidade || "Selecione"}-${cfg.tpImovel || "Selecione"}-${Date.now()}`
  );

  const job: Job = {
    id: nowId(),
    status: "queued",
    createdAt: Date.now(),
    params: cfg,
    logs: []
  };
  jobs.set(job.id, job);

  // roda em background
  void (async () => {
    job.status = "running";
    job.startedAt = Date.now();
    const pushLog = (line: string) => {
      job.logs.push(line);
      if (job.logs.length > 500) job.logs.shift();
    };
    try {
      const r = await scrapeCaixa(
        {
          uf: cfg.uf,
          cidade: cfg.cidade,
          bairro: cfg.bairro,
          tpVenda: cfg.modalidade,
          tpImovel: cfg.tpImovel,
          areaUtil: cfg.areaUtil,
          faixaVlr: cfg.faixaVlr,
          quartos: cfg.quartos,
          vagas: cfg.vagas,
          out: outPath,
          concurrency: cfg.concurrency,
          minDelayMs: cfg.minDelayMs,
          timeoutMs: cfg.timeoutMs,
          retries: cfg.retries,
          withDetails: cfg.withDetails,
          detailsConcurrency: cfg.detailsConcurrency,
          ...(cfg.maxPages !== undefined ? { maxPages: cfg.maxPages } : {})
        },
        pushLog
      );
      job.status = "done";
      job.finishedAt = Date.now();
      job.outPath = r.outPath;
      job.rows = r.rows;
    } catch (err) {
      job.status = "error";
      job.finishedAt = Date.now();
      job.error = String(err);
      pushLog(`[error] ${job.error}`);
    }
  })();

  res.json({ jobId: job.id, outPath });
});

app.get("/api/jobs/:id", (req: Request<{ id: string }>, res: Response) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});

const PORT = Number(process.env.PORT ?? 5177);
void mkdir(OUTPUT_DIR, { recursive: true }).then(() => {
  app.listen(PORT, () => {
  // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${PORT}`);
  });
});



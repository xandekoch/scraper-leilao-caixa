import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";
import { sleep } from "../utils/sleep";

export type HttpClientOptions = Readonly<{
  baseUrl: string;
  userAgent: string;
  origin: string;
  referer: string;
  timeoutMs: number;
  retries: number;
  minDelayMs: number;
}>;

export type HttpResponse = Readonly<{
  status: number;
  text: string;
}>;

function jitter(ms: number): number {
  const delta = Math.floor(ms * 0.2);
  return ms - delta + Math.floor(Math.random() * (delta * 2 + 1));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

class RateLimiter {
  private nextAllowedAt = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly minDelayMs: number) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.chain;
    this.chain = new Promise<void>((r) => {
      release = r;
    });

    await prev;

    const now = Date.now();
    const waitMs = Math.max(0, this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(this.nextAllowedAt, now) + this.minDelayMs;
    release();

    if (waitMs > 0) await sleep(waitMs);
    return await fn();
  }
}

export class HttpClient {
  private readonly jar = new CookieJar();
  private readonly fetchImpl: typeof fetch;
  private readonly limiter: RateLimiter;

  constructor(private readonly opts: HttpClientOptions) {
    this.fetchImpl = fetchCookie(fetch, this.jar);
    this.limiter = new RateLimiter(opts.minDelayMs);
  }

  async get(path: string): Promise<HttpResponse> {
    return await this.request(path, { method: "GET" });
  }

  async postForm(path: string, form: Record<string, string>): Promise<HttpResponse> {
    const body = new URLSearchParams(form);
    return await this.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest"
      },
      body
    });
  }

  private async request(
    path: string,
    init: Readonly<{
      method: "GET" | "POST";
      headers?: Record<string, string>;
      body?: URLSearchParams;
    }>
  ): Promise<HttpResponse> {
    const url = new URL(path, this.opts.baseUrl).toString();

    const baseHeaders: Record<string, string> = {
      accept: "*/*",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      origin: this.opts.origin,
      referer: this.opts.referer,
      "user-agent": this.opts.userAgent
    };

    const headers = { ...baseHeaders, ...(init.headers ?? {}) };

    const attemptOnce = async (): Promise<HttpResponse> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        const fetchInit: RequestInit = {
          method: init.method,
          headers,
          signal: controller.signal
        };
        if (init.body) fetchInit.body = init.body;

        const res = await this.limiter.schedule(() => this.fetchImpl(url, fetchInit));
        const text = await res.text();
        return { status: res.status, text };
      } finally {
        clearTimeout(timeout);
      }
    };

    let last: HttpResponse | undefined;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      try {
        last = await attemptOnce();
        if (!isRetryableStatus(last.status)) return last;

        const base = Math.min(30_000, 750 * Math.pow(2, attempt));
        await sleep(jitter(base));
      } catch (err) {
        lastErr = err;
        const base = Math.min(30_000, 750 * Math.pow(2, attempt));
        await sleep(jitter(base));
      }
    }

    if (last) return last;
    throw new Error(`HTTP request failed (no response): ${String(lastErr)}`);
  }
}



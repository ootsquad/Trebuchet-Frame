import type { AppConfig } from "../config.js";

interface DataStoreEntry<T> {
  etag: string;
  value: T;
}

export interface UpdateOptions<T> {
  defaultValue: () => T;
  transform: (current: T) => T;
  userId?: number;
  beforeCommit?: (current: T, next: T) => Promise<void>;
}

class OpenCloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class OpenCloudDataStore {
  private readonly baseUrl: string;

  constructor(private readonly config: AppConfig) {
    const universe = encodeURIComponent(String(config.robloxUniverseId));
    const dataStore = encodeURIComponent(config.robloxDataStoreName);
    this.baseUrl = `https://apis.roblox.com/cloud/v2/universes/${universe}/data-stores/${dataStore}/entries`;
  }

  async get<T>(key: string): Promise<DataStoreEntry<T> | null> {
    const response = await this.request(`${this.entryUrl(key)}`, { method: "GET" }, true);
    if (response.status === 404) return null;
    return await this.decode<DataStoreEntry<T>>(response);
  }

  async update<T>(key: string, options: UpdateOptions<T>): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await this.get<T>(key);
      const current = structuredClone(existing?.value ?? options.defaultValue());
      const next = options.transform(structuredClone(current));

      if (options.beforeCommit) await options.beforeCommit(current, next);

      const body: Record<string, unknown> = { value: next };
      if (existing?.etag) body.etag = existing.etag;
      if (options.userId) body.users = [`users/${options.userId}`];

      try {
        const response = await this.request(`${this.entryUrl(key)}?allow_missing=true`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const saved = await this.decode<DataStoreEntry<T>>(response);
        return saved.value;
      } catch (error) {
        if (error instanceof OpenCloudError && (error.status === 409 || error.status === 412) && attempt < 7) {
          await sleep(100 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
    throw new Error("Roblox DataStore update failed after conflict retries.");
  }

  private entryUrl(key: string): string {
    return `${this.baseUrl}/${encodeURIComponent(key)}`;
  }

  private async request(url: string, init: RequestInit, allowNotFound = false): Promise<Response> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const headers = new Headers(init.headers);
      headers.set("x-api-key", this.config.robloxApiKey);
      const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
      if (response.ok || (allowNotFound && response.status === 404)) return response;

      const message = await this.errorText(response);
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 500 * 2 ** attempt);
        continue;
      }
      throw new OpenCloudError(`Roblox DataStore returned ${response.status}: ${message}`, response.status);
    }
    throw new Error("Roblox DataStore request failed after retries.");
  }

  private async decode<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text) throw new Error("Roblox DataStore returned an empty response.");
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Roblox DataStore returned invalid JSON.");
    }
  }

  private async errorText(response: Response): Promise<string> {
    const text = (await response.text()).slice(0, 1_500);
    if (!text) return response.statusText;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string; code?: string };
      return parsed.message ?? parsed.error ?? parsed.code ?? text;
    } catch {
      return text;
    }
  }
}

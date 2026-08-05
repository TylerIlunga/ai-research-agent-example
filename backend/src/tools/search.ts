import { config } from "../config/env";
import type { SearchProvider } from "../config/env";

const TIMEOUT_MS = 25_000;

export interface SearchResult {
  title: string;
  url: string;
  /** A short excerpt, always present. */
  snippet: string;
  /** Full page text, when the provider returns it. Only Tavily does. */
  raw?: string;
}

export class SearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

function budgetedSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `${response.status}: ${body.slice(0, 200)}`;
}

/**
 * Tavily — the preferred backend. It is the only one of the three that returns
 * full page text, which is what lets the agent condense a source rather than
 * cite a one-line snippet.
 */
async function tavily(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.search.tavilyKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: config.search.resultsPerSearch,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: true,
    }),
    signal: budgetedSignal(signal),
  });

  if (!response.ok) throw new Error(`Tavily responded ${await readError(response)}`);

  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string | null }>;
  };

  return (payload.results ?? [])
    .filter((item): item is { url: string } & typeof item => Boolean(item.url))
    .map((item) => ({
      title: item.title ?? "",
      url: item.url,
      snippet: item.content ?? "",
      raw: item.raw_content ?? undefined,
    }));
}

/** Brave descriptions arrive with `<strong>` markup and HTML entities. */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Brave — an independent index (not a Google or Bing reseller), 2,000 free
 * queries a month. Snippets only, so sources are cited from the excerpt.
 *
 * `extra_snippets` is deliberately not requested: Brave rejects the parameter
 * outright on plans that do not include the feature (the free tier among
 * them), which would turn every search into a 4xx.
 */
async function brave(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(config.search.resultsPerSearch));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": config.search.braveKey ?? "",
    },
    signal: budgetedSignal(signal),
  });

  if (!response.ok) throw new Error(`Brave responded ${await readError(response)}`);

  const payload = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
      }>;
    };
  };

  return (payload.web?.results ?? [])
    .filter((item): item is { url: string } & typeof item => Boolean(item.url))
    .map((item) => ({
      title: stripHtml(item.title ?? ""),
      url: item.url,
      snippet: stripHtml(
        [item.description, ...(item.extra_snippets ?? [])].filter(Boolean).join(" ")
      ).slice(0, 1_200),
    }));
}

/**
 * SearXNG — the keyless option. It is a metasearch front-end you host (or
 * point at an instance you trust), so it needs a URL rather than a credential.
 */
async function searxng(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const base = (config.search.searxngUrl ?? "").replace(/\/+$/, "");
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "1");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: budgetedSignal(signal),
  });

  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(
      response.status === 403
        ? `SearXNG rejected the request (${detail}). Instances must enable the JSON format in settings.yml.`
        : `SearXNG responded ${detail}`
    );
  }

  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (payload.results ?? [])
    .filter((item): item is { url: string } & typeof item => Boolean(item.url))
    .slice(0, config.search.resultsPerSearch)
    .map((item) => ({
      title: item.title ?? "",
      url: item.url,
      snippet: item.content ?? "",
    }));
}

const BACKENDS: Record<Exclude<SearchProvider, "none">, (q: string, s: AbortSignal) => Promise<SearchResult[]>> = {
  tavily,
  brave,
  searxng,
};

/** Human-facing name for the trace and the UI. */
export const SEARCH_LABELS: Record<SearchProvider, string> = {
  tavily: "Tavily",
  brave: "Brave Search",
  searxng: "SearXNG",
  none: "none",
};

/**
 * Runs one query against whichever backend is configured.
 *
 * Selection happens once at config level rather than per call: silently
 * retrying a failed query on a different index would make results
 * irreproducible, and a failed search is already handled — the agent is told
 * and moves on to the next sub-question.
 */
export async function runSearch(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const provider = config.searchProvider;
  if (provider === "none") {
    throw new SearchUnavailableError(
      "No search provider is configured. Set TAVILY_API_KEY, BRAVE_API_KEY, or SEARXNG_URL."
    );
  }
  return BACKENDS[provider](query, signal);
}

/** Whether the active backend returns full page text worth condensing. */
export function providesFullText(): boolean {
  return config.searchProvider === "tavily";
}

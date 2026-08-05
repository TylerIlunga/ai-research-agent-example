# AI Research Agent

A research agent that plans, searches, and writes a cited brief — built with LangGraph, Claude, and Next.js. Every step streams to the browser as it happens, and every claim links back to the source it came from.

## Demo

**v2 — the current interface**, one unedited run on Claude Opus 5: plan, live trace, sources landing one at a time, streamed brief with clickable citations, the failover panel, dark mode.

https://github.com/user-attachments/assets/fc7f26e8-ed10-47c5-a3f6-13875aeff408

**v1 — the original**, for comparison, built against Claude 4 Sonnet and Gemini 2.5 Pro:

https://github.com/user-attachments/assets/7b5ec23f-ea49-4b44-8238-ac237547edff

## What it does

Ask a question that needs looking up. The agent **plans** (2–5 sub-questions), **researches** (searches the live web, summarizing as it goes, within a fixed budget), and **synthesizes** (a brief that leads with the answer and cites its sources). You watch the whole process and can stop it at any point and keep the partial brief.

## Built with Claude — the honest lineage

| Pass | Model | What it did |
| --- | --- | --- |
| v1 | Claude 4 Sonnet + Gemini 2.5 Pro | Worked, but took many iterations of manual debugging. One tool loop, untyped events, chat-bubble UI. |
| v2 | **Claude Opus 5** | Rebuilt from an [HTML spec](docs/v2-spec.html) in one pass: the typed agent graph, the versioned event protocol, and the current interface. |
| v2.1 | **Claude Opus 5** | LangChain 1.x migration, provider/search failover chains, runtime key entry, per-tier model selection. |
| v2.2 | **Claude Fable 5** | Multi-lens review with adversarial verification. Fixed: search-budget accounting, an unbounded memory call, citation-collision and prompt-injection bugs, model-refusal handling, and a bug where a revoked server key broke the *keyless* CLI failover meant to survive it. Replaced the test suite (63 real unit tests) and CI (was invoking scripts that didn't exist). |

## Architecture

**Agent (LangGraph)** — a typed `StateGraph`, not one undifferentiated tool loop: `plan` → `research` (agentic, tool-calling) or `directResearch` (no tools — for the CLI and local models) → `synthesize`. Sources are typed state: the search tool registers each result with the run context, which assigns the citation number once and dedupes on a normalized URL.

**Event protocol** — the server owns a versioned SSE contract (`backend/src/types/events.ts`): `open`, `status`, `plan`, `step`, `search`, `source`, `token`, `report`, `usage`, `error`, `done`. `POST` + `fetch` rather than `EventSource`, so the client can abort and the server stops spending the moment it disconnects.

**Model roles, not a fixed model** — planner (medium effort), research loop (high), synthesis (high), page summarizer (low). `claude-opus-5` and `claude-sonnet-5` take the identical request shape (adaptive thinking + `output_config.effort`, no sampling params), so switching tiers is one line in `.env`. A measured Sonnet 5 run — 2 searches, 8 sources, 4.5K-char brief — costs about $0.075, roughly 2.5× less than the same run on Opus 5. Both models can decline with `stop_reason: "refusal"` (HTTP 200, empty content); the synthesis node detects that and returns a clear error instead of an empty brief.

**Failover** — two independent chains, each falling back to the next available option and reporting which one answered:

- **Model:** Anthropic → OpenAI (any compatible endpoint, including local models via `OPENAI_BASE_URL`) → Claude Code CLI (no key at all — uses your local login).
- **Search:** Tavily → Brave → SearXNG (keyless, self-hosted).

`RESEARCH_MODE=auto` picks agentic when the provider supports tool calling, otherwise direct (two model calls per run — what makes the CLI and local models usable). The **Providers & keys** panel accepts credentials at runtime, held in server memory only.

**Frontend** — Next.js + React 19. The brief renders as a document (serif body, GFM tables, citations that scroll to their source card), not a chat bubble. History lives in `localStorage`; the server checkpoints the matching thread so follow-ups keep context.

## Setup

```bash
git clone <repository-url> && cd ai-research-agent
cd backend && npm install
cd ../frontend && npm install
cp backend/.env.example backend/.env
```

Set at least one model provider in `backend/.env` — or nothing, if the `claude` CLI is installed and logged in:

```env
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5   # or claude-sonnet-5 for cheaper local runs
```

Run both servers:

```bash
cd backend && npm run dev     # http://localhost:3001
cd frontend && npm run dev    # http://localhost:3000
```

```bash
curl -s http://localhost:3001/api/agent/config | jq   # what the backend can actually do
```

## API

```bash
curl -N -X POST http://localhost:3001/api/agent/stream \
  -H 'Content-Type: application/json' \
  -d '{"query":"What changed in HTTP/3 adoption this year?"}'
```

## Stack

`@langchain/langgraph` 1.4.9 · `@langchain/core` 1.2.4 · `@langchain/anthropic` 1.5.2 · `@langchain/openai` 1.5.5 · `@pinecone-database/pinecone` 8.2.0 (direct — the LangChain wrapper still pins v5) · `langsmith` 0.8.9 · Next.js 15.3 / React 19.

## Development

- **Backend** — `tsx watch`, no build step. `npm run lint`, `npm test` (jest + ts-jest, 63 tests), `npx tsc -p tsconfig.check.json --noEmit`.
- **Frontend** — `npm run lint`, `npm run build`.
- **CI** (`.github/workflows/ci-cd.yml`) runs exactly those commands on every push and PR.
- **Tuning** — `SEARCH_BUDGET` and `RESULTS_PER_SEARCH` in `backend/.env` are the main cost/latency levers.

---

_Built with Claude — Opus 5 rebuilt the agent from scratch (v2), and Fable 5 ran the hardening pass that followed (v2.2). See the [rebuild spec](docs/v2-spec.html) for what v1 got wrong and why each v2 decision was made._

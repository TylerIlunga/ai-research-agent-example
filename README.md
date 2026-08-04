# AI Research Agent

A research agent that plans, searches, and writes a cited brief — built with LangGraph, Claude, and Next.js. Every step is streamed to the browser as it happens, and every claim in the answer links back to the source it came from.

## Demo

**v2 — the current interface**, one unedited run on Claude Sonnet 5. Plan, live trace, sources landing one at a time, streamed brief, clickable citations, the failover panel, dark mode:

https://github.com/TylerIlunga/ai-research-agent-example/raw/main/demo-v2.mp4

**v1 — the original**, for comparison. Same product idea, built against Claude 4 Sonnet and Gemini 2.5 Pro:

https://github.com/user-attachments/assets/7b5ec23f-ea49-4b44-8238-ac237547edff

Both are 1920×980 so they can be compared frame for frame. What changed between them is the subject of the next section.

---

## What changed, and which model changed it

Three passes, three different sets of tools. This is the honest lineage, because the difference between them is the most interesting thing about the project.

| Pass | Authored with | What came out of it |
| --- | --- | --- |
| **v1** | Claude 4 Sonnet + Gemini 2.5 Pro | Worked, but took many iterations and a lot of manual debugging. One undifferentiated tool loop, untyped events, chat-bubble UI. |
| **v2** | Claude Opus 5 | The agent graph, the typed event protocol, and the interface — planned in an [HTML spec](docs/v2-spec.html) and implemented in one pass. |
| **v2.1** | Claude Opus 5 | Stack migration to LangChain 1.x, a six-lens review pass, provider/search failover chains, runtime key entry, and per-tier model selection. |

The v1 → v2 jump is the one the two videos show. The concrete differences:

| | v1 | v2 |
| --- | --- | --- |
| Agent shape | one tool loop | typed `StateGraph` — `plan` → `research` \| `directResearch` → `synthesize` |
| Sources | parsed back out of the answer text | typed state; numbered once at discovery, deduped on normalized URL |
| Streaming | ad-hoc JSON chunks | versioned event contract (`backend/src/types/events.ts`) |
| Citations | plain text `[3]` | real links that scroll to the source card |
| Providers | Anthropic only | two independent failover chains, reported in the UI |
| Without an API key | unusable | still runs, via the Claude Code CLI |
| Follow-up questions | no shared context | checkpointed per thread |

### Model tiers

The agent asks for a **role**, not a model. Opus 5 and Sonnet 5 take the identical request shape — adaptive thinking plus `output_config.effort`, no sampling parameters — so switching between them is one line in `.env` and no code change at all. Both were verified against this app's exact parameter shape.

| `ANTHROPIC_MODEL` | Input / Output per MTok | When it's the right pick |
| --- | --- | --- |
| `claude-opus-5` | $5 / $25 | The default, and what the prompts were written and tuned against. Deepest reasoning and the best results on long agentic runs. |
| `claude-sonnet-5` | $2 / $10 *(intro rate through 2026-08-31; $3 / $15 after)* | Local development. A full run costs roughly 2.5× less than Opus 5 with the agentic tool loop intact. |

A measured run — *"What is QUIC and why was it created?"* — on Sonnet 5: 2 searches, 8 sources, 8 citations, a 4,519-character brief, 64s, 22.3K in / 3.0K out. About $0.075, against roughly $0.186 for the same run on Opus 5.

`claude-haiku-4-5` is deliberately **not** in that table. It is cheaper still, but it predates adaptive thinking and rejects both parameters `models/claude.ts` injects, so it would need per-model-family branching rather than a config change.

> **Known gap:** Opus 5 can decline a request with `stop_reason: "refusal"` rather than an error. The agent does not special-case that yet — a refusal currently surfaces as an empty response rather than a clear message.

## What it does

Ask a question that needs looking up. The agent:

1. **Plans** — decomposes the question into two to five sub-questions.
2. **Researches** — searches the live web for each, summarizing pages as it goes, within a fixed search budget.
3. **Synthesizes** — writes a brief that leads with the answer, cites its sources by number, and flags what it could not resolve.

You watch all of it: the sub-questions it chose, the literal queries it issued, and the sources landing one by one. Press Stop at any point and you keep the partial brief.

## Architecture

### The agent (LangGraph)

A typed state graph, rather than one undifferentiated tool loop:

| Node | Responsibility |
| --- | --- |
| `plan` | One structured call that produces the objective and the sub-questions. |
| `research` | *Agentic mode.* The tool loop — `web_search`, `recall_memory`, `save_memory` — bounded by a search budget. |
| `directResearch` | *Direct mode.* Searches each planned sub-question itself, no tool calling needed. |
| `synthesize` | The only node whose tokens reach the answer. Streams the final brief. |

Sources are typed state, not text. The search tool registers each result with the run context, which assigns the citation number once and dedupes on a normalized URL — so the number the brief cites is the number the UI shows.

There is no `think_tool`. Adaptive thinking gives the model reflection between tool calls without spending a turn writing a reflection nobody reads.

### The event protocol

The server owns a versioned event contract (`backend/src/types/events.ts`); the browser renders it. Adding a node does not mean teaching the client a new framework event shape.

| Event | Carries |
| --- | --- |
| `open` | protocol version, run id, capabilities, model and search provider, research mode |
| `status` | current phase |
| `plan` | objective and sub-questions |
| `step` | one trace row, transitioning `running` → `done` / `failed` |
| `search` | the literal query issued and how many results it returned |
| `source` | a numbered source, the moment it is found |
| `token` | answer text — emitted only by `synthesize` |
| `report` | the authoritative final brief and source list |
| `usage` | tokens, searches, elapsed time |
| `error` | code, message, and whether retrying is worth it |
| `done` | `completed`, `cancelled`, or `failed` |

Streaming is `POST` + `fetch` rather than `EventSource`: questions stay out of URLs and logs, there is no URL length ceiling, and the client can abort. Disconnecting aborts the run server-side instead of leaving it spending on APIs nobody is reading.

### Roles

Each role has a fixed budget, so switching providers changes which model answers — not how the agent is shaped.

| Role | Effort | Notes |
| --- | --- | --- |
| Planning | medium | Short, structured, cheap. |
| Research loop | high | Where research quality lives (agentic mode only). |
| Synthesis | high | Streams the brief. |
| Page summarization | low | Skipped on providers too expensive to call per page. |

Current Claude models reject `temperature`, `top_p`, and `top_k`, and do not accept LangChain's thinking config shape, so `backend/src/models/claude.ts` strips them and injects adaptive thinking plus `output_config.effort`. OpenAI has no effort parameter, so `models/openai.ts` approximates it with the levers that provider does expose.

### Failover

Two independent chains. Each takes the first option it can actually use, so a missing key costs quality rather than availability — and the UI names whichever one answered instead of leaving you to infer it.

**Model** (`MODEL_PROVIDER=auto`)

| Order | Provider | Needs | Notes |
| --- | --- | --- | --- |
| 1 | Anthropic | `ANTHROPIC_API_KEY` | What the prompts are written for. |
| 2 | OpenAI | `OPENAI_API_KEY` or `OPENAI_BASE_URL` | Any OpenAI-compatible endpoint. |
| 3 | Claude Code CLI | the `claude` binary | **No API key at all** — uses your local login. ~$0.15 and ~5s per call, so runs go into direct mode. |

**Search** (`SEARCH_PROVIDER=auto`)

| Order | Backend | Needs | Notes |
| --- | --- | --- | --- |
| 1 | Tavily | `TAVILY_API_KEY` | The only one returning full page text to summarize. |
| 2 | Brave Search | `BRAVE_API_KEY` | Independent index; 2,000 free queries a month. |
| 3 | SearXNG | `SEARXNG_URL` | Keyless. Self-hosted metasearch; snippets only. |

Point the OpenAI slot at a local model to avoid hosted providers entirely:

```env
OPENAI_BASE_URL=http://localhost:11434/v1   # Ollama
OPENAI_MODEL=llama3.1
```

Pin either chain (`MODEL_PROVIDER=claude-code`, `SEARCH_PROVIDER=brave`) — a pinned provider with no credential is reported as a misconfiguration rather than silently falling through.

### Research modes

`RESEARCH_MODE=auto` picks based on what the provider can do:

- **agentic** — the model drives its own search loop, following threads it did not anticipate at planning time. Needs tool calling.
- **direct** — each planned sub-question is searched directly. No tool calling required, and a run costs exactly two model calls. This is what makes the Claude Code CLI and most local models usable.

### Supplying keys from the UI

The **Providers & keys** panel explains both chains and accepts credentials at runtime, so the app can be made useful without editing `.env`. Keys are held in server memory only — never written to disk, never read back, cleared on restart. Disabled outside development unless `ALLOW_RUNTIME_KEYS=true`.

### Degradation

Every external dependency is optional, and the server reports what it can actually do at `/api/agent/config`:

| Missing | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Falls back to OpenAI, then to the Claude Code CLI. The UI shows which. |
| Every model provider | Research fails with one actionable message. The server still boots. |
| `TAVILY_API_KEY` | Falls back to Brave, then SearXNG. |
| Every search provider | The agent answers from model knowledge and the UI says so. |
| Pinecone / OpenAI | No long-term memory. Research is unaffected. |
| `JWT_SECRET` and friends | Generated in memory in development; required in production. |

### Frontend

Next.js and React 19. One token layer drives light and dark (`src/app/globals.css`) — components never reference a raw colour, and a manual theme choice beats the OS preference in both directions.

The brief is rendered as a document, not a chat bubble: serif body, GFM tables, and citation markers that scroll to their source card. Conversation history lives in `localStorage`; the server checkpoints the matching thread, so follow-up questions keep their context.

## Prerequisites

- Node.js 20+ (22 recommended — see `.nvmrc`)
- One model provider: an Anthropic key, an OpenAI key or compatible endpoint, or just the Claude Code CLI
- A Tavily API key (optional — live web search)
- Pinecone and OpenAI keys (optional — long-term memory)

## Setup

```bash
git clone <repository-url>
cd ai-research-agent

cd backend && npm install
cd ../frontend && npm install
```

Create `backend/.env` from the template:

```bash
cp backend/.env.example backend/.env
```

At minimum, set one model provider — or none at all, if the `claude` CLI is installed and logged in:

```env
ANTHROPIC_API_KEY=sk-ant-...          # preferred
ANTHROPIC_MODEL=claude-opus-5         # or claude-sonnet-5 for cheaper local runs
# or, as failovers:
OPENAI_API_KEY=sk-...
# or nothing: MODEL_PROVIDER=claude-code
```

You can also supply keys later from the app's **Providers & keys** panel.

Then run the two servers in separate terminals:

```bash
cd backend && npm run dev     # http://localhost:3001
cd frontend && npm run dev    # http://localhost:3000
```

Check what the backend can do:

```bash
curl -s http://localhost:3001/api/agent/config | jq
```

## API

```bash
# Streaming (server-sent events)
curl -N -X POST http://localhost:3001/api/agent/stream \
  -H 'Content-Type: application/json' \
  -d '{"query":"What changed in HTTP/3 adoption this year?"}'

# One-shot JSON
curl -X POST http://localhost:3001/api/agent/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"What changed in HTTP/3 adoption this year?"}'
```

## Stack

Current as of the last dependency pass:

| Package | Version |
| --- | --- |
| `@langchain/langgraph` | 1.4.9 |
| `@langchain/core` | 1.2.4 |
| `@langchain/anthropic` | 1.5.2 |
| `@langchain/openai` | 1.5.5 |
| `@pinecone-database/pinecone` | 8.2.0 |
| `langsmith` | 0.8.9 |
| Next.js / React | 16 / 19 |

`@langchain/pinecone` is deliberately absent: it still pins the Pinecone client to v5, so memory talks to the v8 SDK directly instead (`backend/src/tools/memory.ts`).

## Development

- **Backend** — `tsx watch`, no build step. `npm run lint`.
- **Frontend** — Next.js with Turbopack. `npm run lint`.
- **Tuning** — `SEARCH_BUDGET` and `RESULTS_PER_SEARCH` in `backend/.env` are the main cost and latency levers.

> **Known gap:** the test suite under `backend/src/__tests__` predates the v2 rebuild and imports exports that no longer exist, so `npm test` and the CI workflow do not currently pass.

---

_Built with Claude. v1 took several iterations and a lot of manual debugging against Claude 4 Sonnet and Gemini 2.5 Pro; the v2 rebuild — the agent graph, the event protocol, and the interface — was planned and implemented in one pass with Claude Opus 5. The [rebuild spec](docs/v2-spec.html) documents what was wrong with v1 and why each change was made._

# AI Research Agent - Backend

Backend service for the AI Research Agent, built with Express.js, TypeScript, and LangGraph.

## Features

- **Three-phase LangGraph agent**: `plan` → `research` → `synthesize` over a typed state, not one undifferentiated tool loop
- **Claude Opus 5**: adaptive thinking with per-role effort; sampling parameters stripped before they reach the wire
- **Provider failover**: no Anthropic key falls back to OpenAI — or any OpenAI-compatible endpoint, including a local model — so a missing key costs quality, not availability
- **Typed event protocol**: a versioned `ResearchEvent` union is the contract with the client (`src/types/events.ts`)
- **Structured citations**: numbers are assigned once, server-side, deduped on a normalized URL — never re-derived from text
- **Real SSE**: compression exempted, headers flushed, heartbeat, and client disconnect aborts the run
- **Graceful degradation**: every external dependency except the model provider is optional, and `/healthz` reports what is actually available

## Architecture

```
backend/src/
├── config/env.ts         # zod-validated config + capability/provider resolution
├── models/
│   ├── index.ts          # Role -> model dispatch across providers
│   ├── roles.ts          # Per-role budgets, shared by both providers
│   ├── claude.ts         # Opus 5 factory (preferred)
│   └── openai.ts         # Failover factory (any OpenAI-compatible endpoint)
├── agents/
│   ├── researchAgent.ts  # The graph: plan / research / tools / synthesize
│   └── runContext.ts     # Per-run emitter, citation table, search budget
├── tools/
│   ├── research.ts       # web_search (structured results)
│   └── memory.ts         # Optional Pinecone-backed recall
├── prompts/research.ts   # Planner, researcher, synthesis, page summary
├── types/events.ts       # The wire contract
├── controllers/          # SSE writer + one-shot JSON endpoint
├── middleware/           # Auth, rate limiting, security headers
├── observability/        # Metrics, tracing, error tracking
├── optimization/         # Connection pooling, cost controls
└── utils/logger.ts       # Structured logging
```

### The graph

| Node | Responsibility |
| --- | --- |
| `plan` | One call producing the objective and 2–5 sub-questions. Falls back to the raw question if it fails. |
| `research` | The tool loop, bounded by `SEARCH_BUDGET` and a hard ceiling on model↔tool round trips. |
| `tools` | Executes tool calls concurrently; a failing tool returns an error result rather than killing the run. |
| `synthesize` | The only node whose tokens reach the answer. Streams the brief. |

Tools are constructed per run so they close over that run's citation table, search budget, and abort signal — which is why sources arrive as typed events instead of being regex-extracted from tool text afterwards.

## Prerequisites

- Node.js 20+
- `ANTHROPIC_API_KEY` — or `OPENAI_API_KEY` / `OPENAI_BASE_URL` as the failover
- `TAVILY_API_KEY` (optional — live web search)
- Pinecone + OpenAI keys (optional — long-term memory; Anthropic has no embeddings endpoint)

## Installation

```bash
npm install
```

## Environment Configuration

Copy `.env.example` to `.env`. The only required value is the model key:

```env
# Model provider. `auto` prefers Anthropic and falls back to OpenAI.
MODEL_PROVIDER=auto
MODEL_MAX_RETRIES=2

ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5

# Failover. OPENAI_BASE_URL accepts any OpenAI-compatible endpoint, so a
# local model can stand in: http://localhost:11434/v1 with OPENAI_MODEL=llama3.1
OPENAI_MODEL=gpt-4o-mini
# OPENAI_BASE_URL=
OPENAI_MAX_OUTPUT_TOKENS=8192

# Optional — live web search
TAVILY_API_KEY=your_tavily_api_key
SEARCH_BUDGET=5
RESULTS_PER_SEARCH=4

# Optional — long-term memory
OPENAI_API_KEY=your_openai_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX=your_pinecone_index_name
EMBEDDING_MODEL=text-embedding-3-small

# Server
PORT=3001
NODE_ENV=development
LOG_LEVEL=info
```

`JWT_SECRET`, `MASTER_ENCRYPTION_KEY` and `KEY_DERIVATION_SALT` are generated in memory in development and required in production.

Check the resolved configuration at any time:

```bash
curl -s http://localhost:3001/healthz | jq
```

## Development

```bash
# Start development server
npm run dev
# or
bun dev

# Type checking
npm run type-check

# Linting
npm run lint

# Testing
npm run test
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Production

```bash
# Build the application
npm run build

# Start production server
npm start

# Run with PM2
pm2 start ecosystem.config.js
```

## Testing

Comprehensive testing suite with:

- **Unit Tests**: 95%+ coverage for agent state transitions
- **Integration Tests**: End-to-end workflow testing
- **Load Tests**: Performance benchmarking and stress testing
- **Security Tests**: Vulnerability scanning and penetration testing

```bash
# Run all tests
npm run test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:load
npm run test:security

# Coverage reports
npm run test:coverage
```

## Performance & Scaling

The backend includes:

- **Connection Pooling**: Optimized database and API connections
- **Request Queuing**: Intelligent request handling and prioritization
- **Caching**: Multi-level caching (memory, Redis, CDN)
- **Vector Optimization**: Advanced Pinecone query optimization
- **Cost Optimization**: Intelligent API usage and model selection

### Load Testing Results

```
Current Performance:
- P50: 2.8 seconds
- P95: 8.5 seconds
- P99: 15.2 seconds
- Throughput: 50 concurrent sessions

Target Performance:
- P50: <2 seconds
- P95: <5 seconds  
- P99: <10 seconds
- Throughput: 200+ concurrent sessions
```

## Monitoring & Observability

Production monitoring includes:

- **LangSmith Integration**: LLM application tracing
- **Prometheus Metrics**: System and business metrics
- **Grafana Dashboards**: Real-time visualization
- **Error Tracking**: Comprehensive error monitoring
- **Performance Monitoring**: Response times and throughput
- **Cost Tracking**: API usage and optimization

## API Endpoints

### Research

```
POST /api/agent/stream   # Run research, streaming ResearchEvents over SSE
GET  /api/agent/stream   # Same, for curl -N and EventSource clients
POST /api/agent/query    # Run research, single JSON response
```

Both accept `{ "query": string, "conversationId"?: string }`. Passing the same
`conversationId` again continues that thread — the graph is checkpointed per
conversation, so follow-up questions keep their context.

```bash
curl -N -X POST http://localhost:3001/api/agent/stream \
  -H 'Content-Type: application/json' \
  -d '{"query":"What changed in HTTP/3 adoption this year?"}'
```

The stream is a sequence of `data: {…}` frames, each one a `ResearchEvent`
(`src/types/events.ts`). `open` is always first and carries the protocol
version; `done` is always last. Disconnecting aborts the run server-side.

### Health & Monitoring

```
GET  /healthz            # Status, model, resolved capabilities, warnings
GET  /security/status    # Recent security events
```

## Security

- **Input Validation**: Comprehensive request validation
- **Rate Limiting**: Per-user and global rate limits
- **API Key Management**: Secure credential handling
- **CORS Configuration**: Secure cross-origin policies
- **Security Headers**: Comprehensive security middleware

## Deployment

### Docker

```bash
# Build image
docker build -t ai-research-agent-backend .

# Run container
docker run -p 3001:3001 ai-research-agent-backend
```

### Kubernetes

```bash
# Deploy to cluster
kubectl apply -f k8s/
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run linting and tests
6. Submit a pull request

## License

This project is licensed under the MIT License.
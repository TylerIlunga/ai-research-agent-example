# AI Research Agent - Frontend

Modern React frontend for the AI Research Agent, built with Next.js 15, React 19, and Tailwind CSS.

## Features

- **Next.js 15 + React 19**: App Router, Turbopack in development
- **Typed event protocol**: renders the server's `ResearchEvent` union directly — no framework internals are parsed in the browser
- **Live research trace**: the plan, the literal search queries issued, and sources landing one by one
- **Streaming brief**: token-by-token, with `[n]` citation markers that scroll to their source card
- **Stop, retry, copy, export**: a run can be aborted at any point and the partial brief is kept
- **Two themes**: one token layer drives light and dark; a manual choice overrides the OS preference
- **Conversation history**: kept in `localStorage`, matched to the server's checkpointed thread
- **Providers & keys panel**: explains both failover chains and accepts credentials at runtime (`Settings.tsx`); values go to the server's memory, never to disk
- **Accessible**: `aria-live` answer region, state carried in text as well as colour, full keyboard path, `prefers-reduced-motion` honoured

## Architecture

```
frontend/src/
├── app/
│   ├── globals.css        # Token layer (both themes) + brief typography
│   ├── layout.tsx         # Metadata, theme bootstrap (no-flash)
│   └── page.tsx           # Mounts the workspace
├── components/
│   ├── Chat.tsx           # Orchestrator: run lifecycle + event reducer
│   ├── Sidebar.tsx        # Conversation history, capability status, theme
│   ├── Composer.tsx       # Auto-growing input, send/stop
│   ├── Trace.tsx          # Live research trace, collapses when finished
│   ├── Settings.tsx       # Failover documentation + runtime key entry
│   ├── Brief.tsx          # Markdown brief + citation linking
│   ├── SourceList.tsx     # Numbered source cards (citation anchors)
│   └── Icon.tsx           # Inline 24px icon set
├── hooks/
│   ├── useConversations.ts # localStorage-backed history
│   └── useTheme.ts         # system / light / dark
├── services/api.ts        # POST + fetch streaming, SSE frame parser, abort
└── types/chat.ts          # Mirror of backend/src/types/events.ts
```

### Streaming

`services/api.ts` uses `POST` + `fetch` streaming rather than `EventSource`: questions stay out of URLs and server logs, there is no URL length ceiling, and an `AbortController` lets Stop actually halt the run server-side. Frames are split on the blank-line boundary, so a partial frame waits for the next chunk instead of being dropped.

Answer tokens are batched per animation frame before hitting React, and the in-flight turn is held in a ref — event folding must not happen inside a state updater, which React double-invokes in development.

## Prerequisites

- Node.js 20+ (22 recommended)
- Backend API running on port 3001

## Installation

```bash
# Using npm
npm install

# Using bun (faster)
bun install
```

## Environment Configuration

Create a `.env.local` file in the frontend directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

If port 3000 is taken, run `npm run dev -- --port 3010`. The backend accepts any
loopback origin in development, so no CORS change is needed.

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
```

The development server will start at [http://localhost:3000](http://localhost:3000).

## Building

```bash
# Build for production
npm run build

# Start production server
npm start

# Export static site
npm run export
```

## Testing

Comprehensive testing suite including:

- **Unit Tests**: Component testing with React Testing Library
- **Integration Tests**: End-to-end user workflows
- **Visual Tests**: Component visual regression testing
- **Accessibility Tests**: WCAG compliance testing

```bash
# Run all tests
npm run test

# Run in watch mode
npm run test:watch

# Run E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage
```

## Key Components

### `Chat.tsx`

Orchestrates a run: creates the turn, folds protocol events into it, batches
answer tokens per animation frame, and owns stop/retry. The in-flight turn
lives in a ref — event folding must not happen inside a React state updater.

### `Trace.tsx`

The live research trace: the plan's sub-questions, then a row per action with
the literal search query issued. Collapses to a one-line summary when the run
finishes. State is carried in text as well as colour.

### `Brief.tsx`

Renders the answer as a document — serif body, GFM tables — and rewrites `[n]`
markers into links that scroll to the matching source card. Only numbers that
exist as sources are rewritten, and the transform is idempotent because it runs
on every streamed frame.

### `SourceList.tsx`

Numbered source cards. The number is assigned server-side, so what the brief
cites and what the card shows can never drift apart.

### `Settings.tsx`

Documents both failover chains against live server state and accepts API keys
at runtime. Values are posted to the server and held in its memory only.

## Styling

The frontend uses Tailwind CSS 4 for styling:

- **Utility-first approach**: Rapid development with utility classes
- **Custom design system**: Consistent colors, spacing, and typography
- **Dark mode support**: Automatic theme switching
- **Responsive design**: Mobile-first responsive layout
- **Animations**: Smooth transitions and micro-interactions

### Design System

```css
/* Custom color palette */
--primary: 200 100% 50%;
--secondary: 220 100% 96%;
--accent: 280 100% 70%;
--background: 0 0% 100%;
--foreground: 240 10% 4%;

/* Typography scale */
--font-sans: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

## Performance Optimization

- **Code Splitting**: Automatic route-based code splitting
- **Image Optimization**: Next.js Image component with WebP support
- **Lazy Loading**: Components and routes loaded on demand
- **Bundle Analysis**: Monitor and optimize bundle size
- **Caching**: Aggressive caching of static assets

### Performance Metrics

```
Lighthouse Scores:
- Performance: 95+
- Accessibility: 100
- Best Practices: 100
- SEO: 95+

Core Web Vitals:
- LCP: <1.5s
- FID: <100ms
- CLS: <0.1
```

## Accessibility

- **WCAG 2.1 AA Compliance**: Full accessibility support
- **Keyboard Navigation**: Complete keyboard navigation
- **Screen Reader Support**: ARIA labels and semantic HTML
- **Color Contrast**: High contrast ratios for readability
- **Focus Management**: Proper focus handling and indicators

## Browser Support

- **Modern Browsers**: Chrome 88+, Firefox 85+, Safari 14+
- **Mobile**: iOS Safari 14+, Chrome Mobile 88+
- **Progressive Enhancement**: Graceful degradation for older browsers

## State Management

- **React State**: Local component state with hooks
- **Context API**: Global state for user preferences
- **URL State**: Router-based state for navigation
- **Server State**: SWR for server data synchronization

## API Integration

The frontend communicates with the backend through:

- **REST API**: Standard HTTP requests for CRUD operations
- **Server-Sent Events**: Real-time updates and progress streaming
- **WebSocket Fallback**: Fallback for SSE when unavailable
- **Error Handling**: Comprehensive error boundary implementation

## Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Docker

```bash
# Build image
docker build -t ai-research-agent-frontend .

# Run container
docker run -p 3000:3000 ai-research-agent-frontend
```

### Static Export

```bash
# Build static site
npm run export

# Deploy to any static hosting
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run linting and tests
6. Submit a pull request

### Development Guidelines

- Follow React best practices
- Use TypeScript for all new code
- Write tests for components
- Maintain accessibility standards
- Follow the existing code style

## License

This project is licensed under the MIT License.
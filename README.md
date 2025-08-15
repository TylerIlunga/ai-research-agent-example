# AI Research Agent

A modern AI research agent built with LangGraph and React that provides intelligent research capabilities with real-time progress tracking and source citations.

## Features

- **Intelligent Research Pipeline**: Multi-step research workflow with search, analysis, and synthesis phases
- **Real-time Progress Tracking**: Visual progress indicators showing research steps in real-time
- **Source Citations**: Comprehensive source tracking with clickable references
- **Streaming Responses**: Real-time streaming of research results and progress updates
- **Vector Memory**: Persistent knowledge storage using Pinecone for context retention
- **Modern UI/UX**: Clean, responsive interface built with Next.js 15 and Tailwind CSS

## Architecture

### Frontend (Next.js 15 + React 19)

- **Next.js 15** with Turbopack for fast development
- **React 19** with modern hooks and components
- **TypeScript** for type safety
- **Tailwind CSS 4** for styling
- **Server-Sent Events** for real-time communication
- **React Markdown** for content rendering

**Key Components:**

- `Chat.tsx` - Main chat interface with streaming support
- `ResearchProgress.tsx` - Real-time research pipeline visualization
- `Message.tsx` - Message rendering with markdown support
- `SourceList.tsx` - Interactive source citations

### Backend (Node.js + Express)

- **Express.js** web server with TypeScript
- **TSX** for runtime TypeScript execution
- **CORS** enabled for cross-origin requests
- **Structured project organization** with separated concerns

**Architecture:**

- `agents/researchAgent.ts` - Core LangGraph research agent
- `tools/research.ts` - Research tool implementations
- `prompts/research.ts` - Structured prompt templates
- `types/state.ts` - TypeScript types and Zod schemas
- `controllers/agentController.ts` - Request handling logic

### AI Stack

- **LangGraph** (v0.2.67) - Agent workflow orchestration
- **LangChain** (v0.3.x) - LLM application framework
- **OpenAI API** - GPT models for reasoning and generation
- **Tavily Search API** - Web search capabilities
- **Pinecone** - Vector database for memory storage
- **LangSmith** - Observability and debugging

## Technical Highlights

- **Type-Safe State Management**: Uses LangGraph MessagesAnnotation with Zod schemas
- **Modular Tool Architecture**: Separated tools for better maintainability
- **Structured Workflows**: 3-phase research pipeline (search → analyze → synthesize)
- **Real-time Updates**: Server-sent events for progress tracking
- **Memory Integration**: Vector-based knowledge persistence
- **Error Handling**: Comprehensive error states and user feedback

---

## Demo

<video width="600" height="400" autoplay muted loop>
  <source src="demo.mp4">
  Your browser does not support the video tag.
</video>

_Note: Made using Claude, Gemini - It took several iterations and manual searching due to bugs outputted by both LLMs (Claude 4 Sonnet, Gemini 2.5 Pro)_

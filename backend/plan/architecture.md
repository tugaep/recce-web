# Architecture Overview

## 1. System Overview

Recce is a multi-agent, AI-powered interactive storytelling platform. A user submits a raw movie idea; a coordinated set of LLM agents produces characters, world art, and a branching, choice-driven narrative that the user plays through in a browser.

### Design Principles

- **Multi-agent specialization** — each agent has a narrow, well-defined role. Shorter prompts, more reliable outputs, easier debugging.
- **Streaming-first UX** — narrative text streams to the client as it is generated. The user sees text appear at reading pace, not after a long wait.
- **Two agent families** — story agents (language) and visual agents (image generation) operate as separate teams coordinated by the orchestrator.

## 2. Components

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│              (Vite + React 18 + Tailwind)                │
└──────────────────────┬──────────────────────────────────┘
                       │ WebSocket / REST
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   FastAPI Backend                         │
│                  (Python 3.11)                            │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │            LangGraph Orchestrator                │    │
│  │                                                  │    │
│  │  ┌──────────────┐  ┌──────────────┐             │    │
│  │  │ Story Agents  │  │ Visual Agents │             │    │
│  │  │              │  │              │             │    │
│  │  │ Orchestrator │  │ Visual Dir.  │             │    │
│  │  │ Char Designer│  │ Portrait Art.│             │    │
│  │  │ World Builder│  │ Environ. Art.│             │    │
│  │  │ Storyteller  │  │ Scene Comp.  │             │    │
│  │  │ Judge        │  │ Vis. Checker │             │    │
│  │  └──────┬───────┘  └──────┬───────┘             │    │
│  │         │                 │                      │    │
│  │    Claude API         fal.ai API                 │    │
│  │  (Sonnet 4.6)       (gpt-image-2)               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                     Supabase                             │
│                                                          │
│  PostgreSQL    │    Auth    │    Storage                  │
│  (narrative    │  (users,   │  (generated                │
│   state,       │   sessions)│   images)                  │
│   characters,  │            │                            │
│   scenes)      │            │                            │
└─────────────────────────────────────────────────────────┘
```

## 3. Request Lifecycle

A typical run through the system:

1. User types a movie idea on the React frontend
2. Frontend opens a WebSocket connection to the FastAPI backend
3. Backend hands the idea to the LangGraph orchestrator
4. Orchestrator calls **Character Designer** and **World Builder** in parallel (both use Claude Sonnet 4.6)
5. Those outputs go to the **Visual Director**, which writes image prompts
6. Visual Director dispatches to **Character Portrait Artist** and **World & Environment Artist** (both call gpt-image-2 via fal.ai)
7. Generated images are uploaded to Supabase Storage
8. **Storyteller** writes the opening scene
9. **Scene Composer** renders an illustration for the scene (gpt-image-2)
10. **Judge** and **Visual Continuity Checker** validate everything
11. Scene text + choices + image URLs stream back over the WebSocket to the frontend
12. User makes a choice → choice updates LangGraph's narrative state → loop repeats from step 8

## 4. Data Flow

Narrative state flows through the LangGraph state graph:

- **Input**: user idea (string) or user choice (choice ID)
- **Shared state**: character roster, world description, scene history, style guide, generated image URLs
- **Output per cycle**: scene text, 2-4 choices, image URLs, agent status updates

State is persisted to Supabase PostgreSQL as an append-only event log per playthrough. Users can close the browser and resume exactly where they left off.

## 5. Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **Supabase for everything** (DB + auth + storage) | Single service covers three needs. Reduces integration complexity. PostgreSQL for state, Auth for login, Storage for images. |
| **No task queue** (no Celery/Redis) | Simplifies the stack. Image generation runs as async calls within the FastAPI process. Acceptable for local/demo deployment. |
| **Streaming-first** | Narrative tokens stream from Claude → FastAPI WebSocket → browser. This is the difference between "AI tool" and "experience." |
| **Two agent families** | Story and visual concerns are separated. Language agents never call image APIs directly; the Visual Director translates between the two worlds. |
| **LangGraph for orchestration** | Graph-based framework maps naturally to branching narratives. Nodes are agents, edges define routing, shared state flows through the graph. |
| **Local backend deployment** | Backend runs locally during development and live demo. No cloud hosting needed for the backend. |

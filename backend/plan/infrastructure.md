# Infrastructure & Deployment

## 1. Overview

The backend runs locally during development and live demos. The frontend is deployed as static assets on Hostinger. Supabase provides managed PostgreSQL, auth, and object storage in the cloud.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│  Hostinger   │     │   Supabase   │
│  (React app) │     │ (static HTML)│     │  (cloud)     │
└──────┬───────┘     └──────────────┘     │              │
       │                                   │  PostgreSQL  │
       │ WebSocket / REST                  │  Auth        │
       ▼                                   │  Storage     │
┌──────────────┐                          └──────┬───────┘
│  Local PC    │                                 │
│              │                                 │
│  FastAPI     │─────────────────────────────────┘
│  Python 3.11 │──────▶ Claude API (Anthropic)
│              │──────▶ fal.ai (gpt-image-2)
└──────────────┘
```

## 2. Local Development Setup

### Python Environment

```bash
# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt
```

### Core Dependencies

```
fastapi
uvicorn[standard]
websockets
pydantic>=2.0
langgraph
langsmith
anthropic
fal-client
supabase
python-dotenv
httpx
```

### Running the Server

```bash
uvicorn app.main:app --reload --port 8000
```

### Environment Variables

Create a `.env` file in the backend root:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# fal.ai
FAL_KEY=your-fal-key

# LangSmith (optional, for tracing)
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your-langsmith-key
LANGCHAIN_PROJECT=recce

# App
APP_ENV=development
```

**Security:** `.env` must be in `.gitignore`. Never commit API keys.

## 3. fal.ai Integration

### Image Generation Flow

1. Visual Director writes an image prompt (text)
2. Rendering agent (Portrait Artist / Environment Artist / Scene Composer) sends the prompt to fal.ai
3. fal.ai runs gpt-image-2 and returns the image
4. Backend uploads the image to Supabase Storage
5. Public URL is stored in the database and sent to the frontend

### fal.ai Client Usage

```python
import fal_client

result = fal_client.subscribe(
    "fal-ai/gpt-image-2",
    arguments={
        "prompt": "A rain-soaked neon alley in 1940s Tokyo...",
        "image_size": "landscape_16_9",  # or square, portrait
        "num_images": 1,
        "quality": "low"  # low | medium | high
    }
)

image_url = result["images"][0]["url"]
```

### Quality / Cost Trade-offs

| Quality | Resolution | Approximate Cost | Use Case |
|---------|-----------|-----------------|----------|
| Low | 1024x768 | ~$0.01 | Development, testing |
| Medium | 1024x1024 | ~$0.05 | Default for playthroughs |
| High | 4K | ~$0.41 | Hero shots (optional) |

Default to **low-to-medium quality at 1024x1024** for the best balance of visual quality and cost.

## 4. Supabase Storage Upload Flow

```python
from supabase import create_client
import httpx

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async def upload_image(image_url: str, bucket: str, path: str) -> str:
    """Download image from fal.ai and upload to Supabase Storage."""
    # Download from fal.ai
    async with httpx.AsyncClient() as client:
        response = await client.get(image_url)
        image_bytes = response.content

    # Upload to Supabase
    supabase.storage.from_(bucket).upload(
        path,
        image_bytes,
        {"content-type": "image/png"}
    )

    # Return public URL
    return supabase.storage.from_(bucket).get_public_url(path)
```

## 5. LangSmith Tracing

LangSmith provides agent-level observability. When enabled, every LangGraph run is traced — you can see exactly what each agent received and produced.

### Setup

1. Create a LangSmith account and project
2. Set the environment variables (`LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`)
3. LangGraph automatically sends traces when the env vars are set

### What Gets Traced

- Each agent node execution (input, output, latency)
- LLM calls (prompt, completion, token usage)
- Tool calls (fal.ai image generation)
- Graph transitions (which edge was taken)

### When to Use

- **Development**: always on — debug agent behavior, prompt issues, routing problems
- **Demo**: can be left on for post-demo analysis or turned off to reduce latency

## 6. Project Structure

```
backend/
├── plan/                    # Planning documents (this folder)
│   ├── architecture.md
│   ├── api-design.md
│   ├── agent-system.md
│   ├── database-schema.md
│   └── infrastructure.md
├── app/
│   ├── main.py              # FastAPI app entry point
│   ├── config.py            # Environment variables, settings
│   ├── api/
│   │   ├── routes/
│   │   │   ├── stories.py   # REST endpoints for stories
│   │   │   ├── sessions.py  # REST endpoints for sessions
│   │   │   └── health.py    # Health check
│   │   └── websocket.py     # WebSocket handler
│   ├── agents/
│   │   ├── graph.py         # LangGraph state graph definition
│   │   ├── state.py         # NarrativeState TypedDict
│   │   ├── story/
│   │   │   ├── orchestrator.py
│   │   │   ├── character_designer.py
│   │   │   ├── world_builder.py
│   │   │   ├── storyteller.py
│   │   │   └── judge.py
│   │   └── visual/
│   │       ├── visual_director.py
│   │       ├── portrait_artist.py
│   │       ├── environment_artist.py
│   │       ├── scene_composer.py
│   │       └── continuity_checker.py
│   ├── services/
│   │   ├── supabase.py      # Supabase client (DB, auth, storage)
│   │   └── fal.py           # fal.ai client wrapper
│   └── models/
│       ├── story.py         # Pydantic models for stories
│       ├── character.py     # Pydantic models for characters
│       ├── scene.py         # Pydantic models for scenes
│       └── world.py         # Pydantic models for worlds
├── requirements.txt
├── .env                     # Local only, gitignored
└── .gitignore
```

## 7. Demo Deployment Considerations

Since the backend runs locally during the live demo:

- **Network**: the presenter's machine must be on a network the frontend can reach. Options:
  - Run frontend locally too (localhost)
  - Use a tunnel (e.g., ngrok) to expose the local backend to the Hostinger-hosted frontend
- **Pre-warming**: run a test playthrough before the demo to warm up API connections and catch any config issues
- **Fallback**: pre-cache a complete demo playthrough in the database so it can be replayed if APIs are down
- **API rate limits**: request rate-limit increases from Anthropic and fal.ai ahead of the demo if needed

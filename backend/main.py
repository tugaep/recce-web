"""
FastAPI entry point for the interactive storytelling backend.

WebSocket clients connect at /ws and exchange JSON messages. Agent/graph
integration will be wired in later; handlers currently return placeholders.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Awaitable, Callable, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from dataclasses import asdict

from graph.graph import run_continuation, run_narrative
from graph.state import NarrativeState
from db.supabase_client import get_session, save_scene, save_session, update_session_state

# Visual agents (Visual Director -> rendering artists -> continuity checker)
from agents.visual_director import run_scene_director, run_visual_director
from agents.character_portrait_artist import render_portrait
from agents.world_environment_artist import render_environment
from agents.scene_composer import render_scene
from agents.visual_continuity_checker import run_continuity_check
# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

# Load variables from .env before the app reads configuration (API keys, etc.)
load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Recce Studio",
    description="Interactive storytelling API",
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS (development: allow all origins)
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# HTTP routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness check for load balancers and local dev."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# WebSocket helpers
# ---------------------------------------------------------------------------


async def send_message(websocket: WebSocket, message_type: str, payload: Any) -> None:
    """Send a JSON envelope with type and payload fields."""
    await websocket.send_json({"type": message_type, "payload": payload})


# ---------------------------------------------------------------------------
# Visual agents — render + stream image URLs over the socket
# ---------------------------------------------------------------------------

# Signature shared by the rendering artists: prompt -> image URL.
Renderer = Callable[[str], Awaitable[str]]


async def _stream_renders(
    websocket: WebSocket,
    session_id: str,
    style_guide: str,
    jobs: list[tuple[str, Optional[int], str, Renderer]],
) -> dict[tuple[str, Optional[int]], Optional[str]]:
    """
    Run render jobs concurrently, emitting an ``image_ready`` the moment each
    image renders — then refine it in the background via the continuity checker.

    ``jobs`` is a list of ``(target, index, prompt, render_fn)``. For each job:
      1. render the image and emit ``image_ready`` immediately (fastest UX), then
      2. run a best-effort continuity check; if it flags an inconsistency,
         regenerate once and emit again — the frontend replaces the prior image.

    Socket sends are serialized with a lock so frames never interleave. Returns a
    map of ``(target, index) -> final url`` for persistence.
    """
    lock = asyncio.Lock()
    results: dict[tuple[str, Optional[int]], Optional[str]] = {}

    async def emit(target: str, index: Optional[int], url: Optional[str], error: str | None = None) -> None:
        payload: dict[str, Any] = {
            "session_id": session_id,
            "target": target,
            "index": index,
            "url": url,
        }
        if error:
            payload["error"] = error
        async with lock:
            await send_message(websocket, "image_ready", payload)

    async def run_job(target: str, index: Optional[int], prompt: str, render_fn: Renderer) -> None:
        try:
            url = await render_fn(prompt)
        except Exception as exc:  # rendering failed — tell the UI to stop the skeleton
            logger.exception("Render failed for target=%s index=%s", target, index)
            await emit(target, index, None, str(exc))
            return

        results[(target, index)] = url
        await emit(target, index, url)  # show it as soon as it exists

        # Best-effort continuity refinement (never blocks the already-shown image).
        try:
            check = await run_continuity_check(style_guide, prompt)
            revised = check.get("revised_prompt") or prompt
            if not check.get("consistent", True) and revised != prompt:
                refined = await render_fn(revised)
                results[(target, index)] = refined
                await emit(target, index, refined)  # frontend swaps to the refined image
        except Exception:
            logger.warning("Continuity refine failed for %s; keeping first render", target)

    await asyncio.gather(
        *(run_job(target, index, prompt, fn) for (target, index, prompt, fn) in jobs if prompt)
    )
    return results


async def generate_initial_visuals(
    websocket: WebSocket,
    session_id: str,
    *,
    story_outline: dict,
    characters: list,
    world: Any,
    scene: Any,
) -> None:
    """
    Story-start visual pass: Visual Director -> render cast/world/scene -> stream.

    Sends ``image_ready`` per image as it finishes, then re-persists the session
    with image prompts/URLs and the style guide (so continuation turns stay
    visually consistent). Fail-open: any error leaves the text experience intact.
    """
    if not characters or world is None:
        return

    try:
        plan = await run_visual_director(story_outline or {}, characters, world)
    except Exception as exc:
        logger.warning("Visual Director failed; skipping initial visuals: %s", exc)
        return

    style_guide = plan["style_guide"]
    story_outline["visual_style_guide"] = style_guide

    # Attach prompts onto the domain objects for persistence.
    char_prompts = plan.get("characters") or []
    for i, c in enumerate(characters):
        if i < len(char_prompts):
            c.image_prompt = char_prompts[i].get("prompt") or None
    world.image_prompt = (plan.get("world") or {}).get("prompt") or None
    scene_prompt = (plan.get("scene") or {}).get("prompt") or ""

    jobs: list[tuple[str, Optional[int], str, Renderer]] = []
    for i, c in enumerate(characters):
        if c.image_prompt:
            jobs.append(("character", i, c.image_prompt, render_portrait))
    if world.image_prompt:
        jobs.append(("world", None, world.image_prompt, render_environment))
    if scene_prompt:
        jobs.append(("scene", None, scene_prompt, render_scene))

    results = await _stream_renders(websocket, session_id, style_guide, jobs)

    # Record URLs back onto the objects.
    for i, c in enumerate(characters):
        c.image_url = results.get(("character", i))
    world.image_url = results.get(("world", None))
    if scene is not None:
        scene.image_url = results.get(("scene", None))

    # Persist the enriched session (style guide + image prompts/URLs).
    try:
        await update_session_state(
            session_id,
            scene_count=0,
            story_outline=story_outline,
            characters=[asdict(c) for c in characters],
            world=asdict(world),
        )
    except Exception as exc:
        logger.warning("Failed to persist visual data for %s: %s", session_id, exc)


async def generate_scene_visual(
    websocket: WebSocket,
    session_id: str,
    *,
    style_guide: str,
    scene: Any,
    characters: list,
    world: Any,
) -> None:
    """
    Continuation visual pass: Scene Director -> Scene Composer -> stream one image.

    Reuses the established ``style_guide`` so the new scene matches prior images.
    Fail-open: any error simply omits the scene image.
    """
    if scene is None or not (scene.scene_text or "").strip():
        return

    try:
        prompt = await run_scene_director(style_guide, scene.scene_text, characters, world)
    except Exception as exc:
        logger.warning("Scene Director failed; skipping scene visual: %s", exc)
        return

    results = await _stream_renders(
        websocket, session_id, style_guide, [("scene", None, prompt, render_scene)]
    )
    scene.image_url = results.get(("scene", None))


def _placeholder_story_started(idea: str, session_id: str) -> dict[str, Any]:
    """Stub payload until the LangGraph pipeline is connected."""
    return {
        "session_id": session_id,
        "message": "Story session started (placeholder).",
        "user_idea": idea,
        "scene": {
            "scene_text": "The story begins here. (Placeholder scene.)",
            "location": "Unknown",
            "status": "active",
        },
        "choices": [
            {"choice_text": "Explore further", "consequence": "You move ahead."},
            {"choice_text": "Wait and observe", "consequence": "You learn more."},
        ],
    }


def _placeholder_choice_applied(choice: str, session_id: str) -> dict[str, Any]:
    """Stub payload until choice handling is wired to the graph."""
    return {
        "session_id": session_id,
        "message": "Choice recorded (placeholder).",
        "user_choice": choice,
        "scene": {
            "scene_text": f"You chose: {choice}. The narrative continues. (Placeholder.)",
            "location": "Unknown",
            "status": "active",
        },
        "choices": [
            {"choice_text": "Continue", "consequence": "The plot advances."},
            {"choice_text": "Turn back", "consequence": "You reconsider."},
        ],
    }


async def handle_start_story(
    websocket: WebSocket, payload: dict[str, Any], session_id: str
) -> None:
    idea = payload.get("idea", "")
    if not isinstance(idea, str) or not idea.strip():
        await send_message(
            websocket,
            "error",
            {"message": "start_story requires a non-empty string 'idea' in payload."},
        )
        return

    state: NarrativeState = {
        "user_idea": idea.strip(),
        "session_id": session_id,
        "characters": [],
        "choices": [],
        "scene_history": [],
        "user_choice": "",
        "is_valid": False,
        "error_message": "",
        "storyteller_retry_count": 0,
    }

    final_state = await run_narrative(state)

    # Serialize rich state objects for DB persistence
    story_outline: dict = final_state.get("story_outline") or {}
    characters_dicts = [asdict(c) for c in final_state.get("characters") or []]
    world_dict = asdict(final_state["world"]) if final_state.get("world") else {}

    await save_session(
        session_id,
        idea.strip(),
        scene_count=0,
        story_outline=story_outline,
        characters=characters_dicts,
        world=world_dict,
    )

    if final_state.get("current_scene"):
        await save_scene(
            session_id,
            {
                "scene_text": final_state["current_scene"].scene_text,
                "location": final_state["current_scene"].location,
                "status": final_state["current_scene"].status,
            },
        )

    await send_message(
        websocket,
        "story_started",
        {
            "session_id": session_id,
            "is_final": False,
            "scene": {
                "scene_text": final_state["current_scene"].scene_text
                if final_state.get("current_scene")
                else "",
                "location": final_state["current_scene"].location
                if final_state.get("current_scene")
                else "",
            },
            "choices": [
                {"choice_text": c.choice_text, "consequence": c.consequence}
                for c in final_state.get("choices") or []
            ],
            "characters": [
                {"name": c.name, "description": c.description}
                for c in final_state.get("characters") or []
            ],
            "world": world_dict,
        },
    )

    # Visual layer: generate and stream images now that the text is on screen.
    await generate_initial_visuals(
        websocket,
        session_id,
        story_outline=story_outline,
        characters=final_state.get("characters") or [],
        world=final_state.get("world"),
        scene=final_state.get("current_scene"),
    )


async def handle_make_choice(
    websocket: WebSocket, payload: dict[str, Any], session_id: str
) -> None:
    choice = payload.get("choice", "")
    if not isinstance(choice, str) or not choice.strip():
        await send_message(
            websocket,
            "error",
            {"message": "make_choice requires a non-empty string 'choice' in payload."},
        )
        return

    # --- Load existing session from DB ---
    session = await get_session(session_id)
    if not session:
        await send_message(websocket, "error", {"message": "Session not found."})
        return

    scene_count = session.get("scene_count", 0) + 1
    is_final = scene_count >= 3  # 3rd choice triggers the conclusive ending

    # --- Build state from persisted session data ---
    state: NarrativeState = {
        "user_idea": session.get("user_idea", ""),
        "session_id": session_id,
        "user_choice": choice.strip(),
        "storyteller_retry_count": 0,
        "scene_count": scene_count,
        "is_final": is_final,
        # Richly-typed objects restored by get_session
        "story_outline": session.get("story_outline") or {},
        "characters": session.get("characters") or [],
        "world": session.get("world"),
        "scene_history": session.get("scene_history") or [],
        # Reset per-turn fields
        "current_scene": None,
        "choices": [],
        "is_valid": False,
        "error_message": "",
    }

    # --- Run storyteller + judge only (no orchestrator / world / character setup) ---
    final_state = await run_continuation(state)

    # --- Persist updated session state ---
    updated_characters = [asdict(c) for c in final_state.get("characters") or []]
    updated_world = asdict(final_state["world"]) if final_state.get("world") else {}
    updated_outline = final_state.get("story_outline") or {}

    await update_session_state(
        session_id,
        scene_count=scene_count,
        story_outline=updated_outline,
        characters=updated_characters,
        world=updated_world,
    )

    # --- Persist the new scene ---
    if final_state.get("current_scene"):
        await save_scene(
            session_id,
            {
                "scene_text": final_state["current_scene"].scene_text,
                "location": final_state["current_scene"].location,
                "status": final_state["current_scene"].status,
            },
        )

    # --- Build response payload ---
    response: dict[str, Any] = {
        "session_id": session_id,
        "is_final": is_final,
        "scene": {
            "scene_text": final_state["current_scene"].scene_text
            if final_state.get("current_scene")
            else "",
            "location": final_state["current_scene"].location
            if final_state.get("current_scene")
            else "",
        },
    }

    if is_final:
        # Finale: send story summary; no choices needed
        response["story_summary"] = final_state.get("story_summary") or ""
        response["choices"] = []
    else:
        response["choices"] = [
            {"choice_text": c.choice_text, "consequence": c.consequence}
            for c in final_state.get("choices") or []
        ]

    await send_message(websocket, "choice_applied", response)

    # Visual layer: stream the scene illustration, reusing the saved style guide.
    style_guide = (final_state.get("story_outline") or {}).get("visual_style_guide", "")
    await generate_scene_visual(
        websocket,
        session_id,
        style_guide=style_guide,
        scene=final_state.get("current_scene"),
        characters=final_state.get("characters") or [],
        world=final_state.get("world"),
    )


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    Real-time channel for story sessions.

    Incoming JSON shape: {"type": "<message_type>", "payload": {...}}

    Supported types:
      - start_story: payload.idea — begin a new story from the user's idea
      - make_choice: payload.choice — advance the story with a user selection
    """
    await websocket.accept()
    session_id = str(uuid.uuid4())
    logger.info("WebSocket connected, session_id=%s", session_id)

    await send_message(
        websocket,
        "connected",
        {
            "session_id": session_id,
            "message": "Connected to Recce Studio. Send start_story or make_choice.",
        },
    )

    try:
        while True:
            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await send_message(
                    websocket,
                    "error",
                    {"message": "Invalid JSON. Send an object with 'type' and 'payload'."},
                )
                continue

            if not isinstance(data, dict):
                await send_message(
                    websocket,
                    "error",
                    {"message": "Message must be a JSON object."},
                )
                continue

            message_type = data.get("type")
            payload = data.get("payload", {})

            if not isinstance(message_type, str):
                await send_message(
                    websocket,
                    "error",
                    {"message": "Missing or invalid 'type' field."},
                )
                continue

            if not isinstance(payload, dict):
                await send_message(
                    websocket,
                    "error",
                    {"message": "'payload' must be a JSON object."},
                )
                continue

            if message_type == "start_story":
                await handle_start_story(websocket, payload, session_id)
            elif message_type == "make_choice":
                await handle_make_choice(websocket, payload, session_id)
            else:
                await send_message(
                    websocket,
                    "error",
                    {
                        "message": f"Unknown message type: {message_type}",
                        "supported_types": ["start_story", "make_choice"],
                    },
                )

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected, session_id=%s", session_id)
    except Exception:
        logger.exception("WebSocket error, session_id=%s", session_id)
        try:
            await send_message(
                websocket,
                "error",
                {"message": "An unexpected server error occurred."},
            )
        except Exception:
            pass

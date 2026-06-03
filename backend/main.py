"""
FastAPI entry point for the interactive storytelling backend.

WebSocket clients connect at /ws and exchange JSON messages. Agent/graph
integration will be wired in later; handlers currently return placeholders.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from dataclasses import asdict

from graph.graph import run_continuation, run_narrative
from graph.state import NarrativeState
from db.supabase_client import get_session, save_scene, save_session, update_session_state
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

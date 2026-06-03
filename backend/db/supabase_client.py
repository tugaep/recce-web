"""
Supabase persistence for story sessions and scene history.

Expected tables (create in Supabase SQL editor):

    create table story_sessions (
        id text primary key,
        user_idea text not null,
        scene_count integer default 0,
        story_outline jsonb,
        characters jsonb,
        world jsonb,
        created_at timestamptz default now()
    );

    create table scenes (
        id uuid primary key default gen_random_uuid(),
        session_id text not null references story_sessions (id) on delete cascade,
        scene jsonb not null,
        created_at timestamptz default now()
    );
"""

from __future__ import annotations

import logging
import os
from typing import Any, List, Optional

from dotenv import load_dotenv
from postgrest.exceptions import APIError as PostgrestAPIError
from supabase import AsyncClient, create_async_client

from graph.state import Character, Scene, WorldInfo

# ---------------------------------------------------------------------------
# Environment and logging
# ---------------------------------------------------------------------------

load_dotenv()

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

SESSIONS_TABLE = "story_sessions"
SCENES_TABLE = "scenes"

# Lazily initialized async client (created on first database call)
_client: Optional[AsyncClient] = None


class SupabaseConfigError(Exception):
    """Raised when required Supabase environment variables are missing."""


class SupabaseOperationError(Exception):
    """Raised when a Supabase query fails after handling."""


# ---------------------------------------------------------------------------
# Client initialization
# ---------------------------------------------------------------------------


async def get_client() -> AsyncClient:
    """
    Return the shared async Supabase client, creating it on first use.

    Reads SUPABASE_URL and SUPABASE_KEY from the environment (via .env).
    """
    global _client

    if _client is not None:
        return _client

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SupabaseConfigError(
            "SUPABASE_URL and SUPABASE_KEY must be set in the environment or .env file."
        )

    try:
        _client = await create_async_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase async client initialized")
        return _client
    except Exception as exc:
        logger.exception("Failed to initialize Supabase client")
        raise SupabaseOperationError("Could not connect to Supabase.") from exc


# ---------------------------------------------------------------------------
# Session persistence
# ---------------------------------------------------------------------------


async def save_session(
    session_id: str,
    user_idea: str,
    scene_count: int = 0,
    story_outline: Optional[dict] = None,
    characters: Optional[List[dict]] = None,
    world: Optional[dict] = None,
) -> dict[str, Any]:
    """
    Insert a new story session row.

    Args:
        session_id: Unique id for the WebSocket / graph session.
        user_idea: The user's initial story prompt.
        scene_count: Number of scenes played so far (default 0).
        story_outline: High-level story plan dict (genre, tone, setting, conflict).
        characters: List of character dicts (name, description, personality, backstory).
        world: World-building dict (location_name, atmosphere, time_period, description).

    Returns:
        The inserted row as returned by Supabase.

    Raises:
        SupabaseOperationError: On insert failure or invalid configuration.
    """
    try:
        client = await get_client()
        row: dict[str, Any] = {
            "id": session_id,
            "user_idea": user_idea,
            "scene_count": scene_count,
            "story_outline": story_outline or {},
            "characters": characters or [],
            "world": world or {},
        }
        response = await (
            client.table(SESSIONS_TABLE).insert(row).execute()
        )
        data = response.data
        if not data:
            raise SupabaseOperationError("save_session returned no data")
        return data[0] if isinstance(data, list) else data
    except SupabaseConfigError:
        raise
    except PostgrestAPIError as exc:
        logger.error("save_session failed for %s: %s", session_id, exc)
        raise SupabaseOperationError(f"Failed to save session: {exc}") from exc
    except Exception as exc:
        logger.exception("Unexpected error in save_session for %s", session_id)
        raise SupabaseOperationError("Failed to save session.") from exc


async def save_scene(session_id: str, scene: dict[str, Any]) -> dict[str, Any]:
    """
    Append a scene to the session's scene history.

    Args:
        session_id: Parent story session id.
        scene: Scene payload (e.g. scene_text, location, status).

    Returns:
        The inserted scene row as returned by Supabase.

    Raises:
        SupabaseOperationError: On insert failure or invalid configuration.
    """
    try:
        client = await get_client()
        row = {"session_id": session_id, "scene": scene}
        response = await client.table(SCENES_TABLE).insert(row).execute()
        data = response.data
        if not data:
            raise SupabaseOperationError("save_scene returned no data")
        return data[0] if isinstance(data, list) else data
    except SupabaseConfigError:
        raise
    except PostgrestAPIError as exc:
        logger.error("save_scene failed for session %s: %s", session_id, exc)
        raise SupabaseOperationError(f"Failed to save scene: {exc}") from exc
    except Exception as exc:
        logger.exception("Unexpected error in save_scene for %s", session_id)
        raise SupabaseOperationError("Failed to save scene.") from exc


async def get_session(session_id: str) -> Optional[dict[str, Any]]:
    """
    Load a story session and all of its scenes, ordered by creation time.

    Args:
        session_id: Session primary key.

    Returns:
        A dict with session fields plus richly-typed objects:
          - ``scene_count`` (int)
          - ``story_outline`` (dict)
          - ``characters`` (list[Character])
          - ``world`` (WorldInfo | None)
          - ``scene_history`` (list[Scene]) — parsed from the scenes table
        Returns None if the session is not found; logs and returns None on errors.
    """
    try:
        client = await get_client()

        session_response = await (
            client.table(SESSIONS_TABLE)
            .select("*")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        session_row = session_response.data
        if not session_row:
            return None

        scenes_response = await (
            client.table(SCENES_TABLE)
            .select("id, session_id, scene, created_at")
            .eq("session_id", session_id)
            .order("created_at")
            .execute()
        )
        raw_scenes = scenes_response.data or []

        # --- Parse characters into Character dataclasses ---
        raw_characters: List[dict] = session_row.get("characters") or []
        characters: List[Character] = [
            Character(
                name=c.get("name", ""),
                description=c.get("description", ""),
                personality=c.get("personality", ""),
                backstory=c.get("backstory", ""),
            )
            for c in raw_characters
        ]

        # --- Parse world into WorldInfo dataclass ---
        raw_world: Optional[dict] = session_row.get("world") or None
        world: Optional[WorldInfo] = (
            WorldInfo(
                location_name=raw_world.get("location_name", ""),
                atmosphere=raw_world.get("atmosphere", ""),
                time_period=raw_world.get("time_period", ""),
                description=raw_world.get("description", ""),
            )
            if raw_world
            else None
        )

        # --- Parse scenes into Scene dataclasses (scene_history) ---
        scene_history: List[Scene] = [
            Scene(
                scene_text=row["scene"].get("scene_text", ""),
                location=row["scene"].get("location", ""),
                status=row["scene"].get("status", ""),
            )
            for row in raw_scenes
            if isinstance(row.get("scene"), dict)
        ]

        return {
            **session_row,
            "session_id": session_row.get("id", session_id),
            "scene_count": session_row.get("scene_count", 0),
            "story_outline": session_row.get("story_outline") or {},
            "characters": characters,
            "world": world,
            "scene_history": scene_history,
        }
    except SupabaseConfigError:
        raise
    except PostgrestAPIError as exc:
        logger.error("get_session failed for %s: %s", session_id, exc)
        return None
    except Exception:
        logger.exception("Unexpected error in get_session for %s", session_id)
        return None


async def update_session_state(
    session_id: str,
    scene_count: int,
    story_outline: dict,
    characters: List[dict],
    world: dict,
) -> dict[str, Any]:
    """
    Update the story session row with the latest narrative state.

    Args:
        session_id: Session primary key to update.
        scene_count: Current number of scenes played.
        story_outline: Updated high-level story plan dict.
        characters: Updated list of character dicts.
        world: Updated world-building dict.

    Returns:
        The updated row as returned by Supabase.

    Raises:
        SupabaseOperationError: On update failure or invalid configuration.
    """
    try:
        client = await get_client()
        payload: dict[str, Any] = {
            "scene_count": scene_count,
            "story_outline": story_outline,
            "characters": characters,
            "world": world,
        }
        response = await (
            client.table(SESSIONS_TABLE)
            .update(payload)
            .eq("id", session_id)
            .execute()
        )
        data = response.data
        if not data:
            raise SupabaseOperationError("update_session_state returned no data")
        return data[0] if isinstance(data, list) else data
    except SupabaseConfigError:
        raise
    except PostgrestAPIError as exc:
        logger.error("update_session_state failed for %s: %s", session_id, exc)
        raise SupabaseOperationError(f"Failed to update session state: {exc}") from exc
    except Exception as exc:
        logger.exception("Unexpected error in update_session_state for %s", session_id)
        raise SupabaseOperationError("Failed to update session state.") from exc

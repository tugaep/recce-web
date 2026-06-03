"""
World builder agent: generates the story setting from outline and characters.

Runs after the character designer and sets ``state["world"]`` to a WorldInfo instance.
"""

from __future__ import annotations

import json
import logging
import re

from dotenv import load_dotenv

from graph.state import NarrativeState, StoryOutline, WorldInfo
from llm.fal_llm import complete as fal_complete

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a world builder for an interactive fiction platform.

You will receive a story outline and a list of characters. Design a rich, immersive setting where their story can unfold. The world should align with the outline's genre, tone, and conflict, and feel grounded in who the characters are.

Respond with a single JSON object only—no markdown fences, no preamble, no explanation.
Use exactly these keys (all string values):
- "location_name": the primary place name where much of the story happens
- "atmosphere": the mood and sensory feel of the environment (2-3 sentences)
- "time_period": the era or timeframe (e.g. near-future Mars, medieval kingdom)
- "description": broader world-building: geography, culture, rules, and details players should know (3-5 sentences)

Example shape:
{"location_name": "...", "atmosphere": "...", "time_period": "...", "description": "..."}"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_json_fences(text: str) -> str:
    """Remove optional markdown code fences around JSON."""
    text = text.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence_match:
        return fence_match.group(1).strip()
    return text


def _format_prompt_context(
    outline: StoryOutline
) -> str:
    """Build the human message payload from outline."""
    payload = {"story_outline": outline}
    return json.dumps(payload, indent=2)


def _parse_world_json(raw: str) -> WorldInfo:
    """
    Parse Claude's JSON response into a WorldInfo dataclass.

    Accepts a flat object or {"world": {...}} wrapper.
    """
    text = _strip_json_fences(raw)
    data = json.loads(text)

    if isinstance(data, dict) and "world" in data:
        data = data["world"]

    if not isinstance(data, dict):
        raise ValueError("Response must be a JSON object")

    required = ("location_name", "atmosphere", "time_period", "description")
    missing = [key for key in required if key not in data]
    if missing:
        raise ValueError(f"Missing keys in world JSON: {', '.join(missing)}")

    return WorldInfo(
        location_name=str(data["location_name"]).strip(),
        atmosphere=str(data["atmosphere"]).strip(),
        time_period=str(data["time_period"]).strip(),
        description=str(data["description"]).strip(),
    )


def _invalid_state(state: NarrativeState, message: str) -> NarrativeState:
    """Return state marked invalid with an error message."""
    return {
        **state,
        "is_valid": False,
        "error_message": message,
    }


# ---------------------------------------------------------------------------
# World builder node
# ---------------------------------------------------------------------------


async def run_world_builder(state: NarrativeState) -> NarrativeState:
    """
    Generate ``WorldInfo`` from ``story_outline`` and ``characters``.

    On success, sets ``state["world"]`` and ``is_valid`` to True.
    On failure, sets ``is_valid`` to False and records the error.
    """
    story_outline = state.get("story_outline")
    if not story_outline:
        return _invalid_state(
            state, "story_outline is required for the world builder."
        )

#    characters = state.get("characters") or []
#    if not characters:
#        return _invalid_state(
#            state, "characters are required for the world builder."
#        )

    characters = []

    try:
        raw_content = await fal_complete(
            system_prompt=SYSTEM_PROMPT,
            prompt=f"Story outline:\n{_format_prompt_context(story_outline)}",
            temperature=0.4,
        )
        world = _parse_world_json(raw_content)

        logger.info(
            "World builder for session %s: location=%s",
            state.get("session_id", ""),
            world.location_name,
        )

        return {
            **state,
            "world": world,
            "is_valid": True,
            "error_message": "",
        }

    except json.JSONDecodeError as exc:
        logger.error("World builder JSON parse failed: %s", exc)
        return _invalid_state(state, f"Could not parse world as JSON: {exc}")
    except ValueError as exc:
        logger.error("World builder validation failed: %s", exc)
        return _invalid_state(state, str(exc))
    except Exception as exc:
        logger.exception("World builder failed")
        return _invalid_state(state, f"World builder error: {exc}")

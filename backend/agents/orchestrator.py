"""
Orchestrator agent: turns the user's story idea into a structured story outline.

Runs early in the LangGraph pipeline and populates ``story_outline`` on state.
"""

from __future__ import annotations

import json
import logging
import re

from dotenv import load_dotenv

from graph.state import NarrativeState, StoryOutline
from llm.fal_llm import complete as fal_complete

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a creative story development assistant for an interactive fiction platform.

The user will provide a short story idea. Analyze it and extract a clear story framework.

Respond with a single JSON object only—no markdown fences, no preamble, no explanation.
Use exactly these keys (all string values):
- "genre": the primary genre (e.g. fantasy, sci-fi, romance, thriller)
- "tone": the emotional tone and mood (e.g. dark and suspenseful, lighthearted)
- "setting": where and when the story takes place (one or two sentences)
- "conflict": the main conflict or dramatic question that drives the plot

Example shape:
{"genre": "...", "tone": "...", "setting": "...", "conflict": "..."}"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_outline_json(raw: str) -> StoryOutline:
    """
    Parse Claude's JSON response into a StoryOutline.

    Strips optional markdown code fences if the model includes them.
    """
    text = raw.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence_match:
        text = fence_match.group(1).strip()

    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Response must be a JSON object")

    required = ("genre", "tone", "setting", "conflict")
    missing = [key for key in required if key not in data]
    if missing:
        raise ValueError(f"Missing keys in outline JSON: {', '.join(missing)}")

    return StoryOutline(
        genre=str(data["genre"]).strip(),
        tone=str(data["tone"]).strip(),
        setting=str(data["setting"]).strip(),
        conflict=str(data["conflict"]).strip(),
    )


def _invalid_state(state: NarrativeState, message: str) -> NarrativeState:
    """Return state marked invalid with an error message."""
    return {
        **state,
        "is_valid": False,
        "error_message": message,
    }


# ---------------------------------------------------------------------------
# Orchestrator node
# ---------------------------------------------------------------------------


async def run_orchestrator(state: NarrativeState) -> NarrativeState:
    """
    Analyze ``user_idea`` with Claude and attach a ``story_outline`` to state.

    On success, sets ``is_valid`` to True and clears ``error_message``.
    On failure, sets ``is_valid`` to False and records the error.
    """
    user_idea = (state.get("user_idea") or "").strip()
    if not user_idea:
        return _invalid_state(state, "user_idea is required for the orchestrator.")

    try:
        raw_content = await fal_complete(
            system_prompt=SYSTEM_PROMPT,
            prompt=f"User story idea:\n{user_idea}",
            temperature=0.3,
        )
        story_outline = _parse_outline_json(raw_content)

        logger.info(
            "Orchestrator outline for session %s: genre=%s",
            state.get("session_id", ""),
            story_outline["genre"],
        )

        return {
            **state,
            "story_outline": story_outline,
            "is_valid": True,
            "error_message": "",
        }

    except json.JSONDecodeError as exc:
        logger.error("Orchestrator JSON parse failed: %s", exc)
        return _invalid_state(
            state, f"Could not parse story outline as JSON: {exc}"
        )
    except ValueError as exc:
        logger.error("Orchestrator validation failed: %s", exc)
        return _invalid_state(state, str(exc))
    except Exception as exc:
        logger.exception("Orchestrator failed")
        return _invalid_state(state, f"Orchestrator error: {exc}")

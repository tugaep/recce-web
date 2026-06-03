"""
Character designer agent: generates the story cast from the orchestrator outline.

Runs after the orchestrator and fills ``state["characters"]`` with Character instances.
"""

from __future__ import annotations

import json
import logging
import re

from dotenv import load_dotenv

from graph.state import Character, NarrativeState, StoryOutline
from llm.fal_llm import complete as fal_complete

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()

logger = logging.getLogger(__name__)

MIN_CHARACTERS = 2
MAX_CHARACTERS = 3

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a character designer for an interactive fiction platform.

You will receive a story outline (genre, tone, setting, conflict). Create a compelling cast of 2 to 3 characters who fit that outline and can drive an interactive narrative.

Respond with a single JSON object only—no markdown fences, no preamble, no explanation.
Use exactly this shape:
{
  "characters": [
    {
      "name": "Character display name",
      "description": "Physical appearance and role in the story (2-3 sentences)",
      "personality": "Traits, motivations, and how they speak (2-3 sentences)",
      "backstory": "Relevant history before the story begins (2-3 sentences)"
    }
  ]
}

Rules:
- Include between 2 and 3 characters in the "characters" array.
- Every character must have all four keys: name, description, personality, backstory.
- Make characters distinct and relevant to the outline's conflict and setting."""

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


def _format_outline_for_prompt(outline: StoryOutline) -> str:
    """Serialize the story outline for the human message."""
    return json.dumps(outline, indent=2)


def _parse_characters_json(raw: str) -> list[Character]:
    """
    Parse Claude's JSON response into Character dataclass instances.

    Expects {"characters": [{name, description, personality, backstory}, ...]}.
    """
    text = _strip_json_fences(raw)
    data = json.loads(text)

    if isinstance(data, list):
        entries = data
    elif isinstance(data, dict) and "characters" in data:
        entries = data["characters"]
    else:
        raise ValueError(
            'Response must be a JSON object with a "characters" array or a top-level array'
        )

    if not isinstance(entries, list):
        raise ValueError('"characters" must be a JSON array')

    if not MIN_CHARACTERS <= len(entries) <= MAX_CHARACTERS:
        raise ValueError(
            f"Expected {MIN_CHARACTERS}-{MAX_CHARACTERS} characters, got {len(entries)}"
        )

    required = ("name", "description", "personality", "backstory")
    characters: list[Character] = []

    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"Character at index {index} must be a JSON object")
        missing = [key for key in required if key not in entry]
        if missing:
            raise ValueError(
                f"Character at index {index} missing keys: {', '.join(missing)}"
            )
        characters.append(
            Character(
                name=str(entry["name"]).strip(),
                description=str(entry["description"]).strip(),
                personality=str(entry["personality"]).strip(),
                backstory=str(entry["backstory"]).strip(),
            )
        )

    return characters


def _invalid_state(state: NarrativeState, message: str) -> NarrativeState:
    """Return state marked invalid with an error message."""
    return {
        **state,
        "is_valid": False,
        "error_message": message,
    }


# ---------------------------------------------------------------------------
# Character designer node
# ---------------------------------------------------------------------------


async def run_character_designer(state: NarrativeState) -> NarrativeState:
    """
    Generate 2–3 characters from ``story_outline`` and update ``state["characters"]``.

    On success, sets ``is_valid`` to True and clears ``error_message``.
    On failure, sets ``is_valid`` to False and records the error.
    """
    story_outline = state.get("story_outline")
    if not story_outline:
        return _invalid_state(
            state, "story_outline is required for the character designer."
        )

    try:
        raw_content = await fal_complete(
            system_prompt=SYSTEM_PROMPT,
            prompt=f"Story outline:\n{_format_outline_for_prompt(story_outline)}",
            temperature=0.5,
        )
        characters = _parse_characters_json(raw_content)

        logger.info(
            "Character designer for session %s: created %d characters",
            state.get("session_id", ""),
            len(characters),
        )

        return {
            **state,
            "characters": characters,
            "is_valid": True,
            "error_message": "",
        }

    except json.JSONDecodeError as exc:
        logger.error("Character designer JSON parse failed: %s", exc)
        return _invalid_state(
            state, f"Could not parse characters as JSON: {exc}"
        )
    except ValueError as exc:
        logger.error("Character designer validation failed: %s", exc)
        return _invalid_state(state, str(exc))
    except Exception as exc:
        logger.exception("Character designer failed")
        return _invalid_state(state, f"Character designer error: {exc}")

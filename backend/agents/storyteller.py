"""
Storyteller agent: generates the next interactive scene and branching choices.

Uses outline, characters, world, and the user's latest choice (if any) to advance the story.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict

from dotenv import load_dotenv

from graph.state import (
    Character,
    Choice,
    NarrativeState,
    Scene,
    StoryOutline,
    WorldInfo,
)
from llm.fal_llm import complete as fal_complete

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()

logger = logging.getLogger(__name__)

REQUIRED_CHOICES = 3

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = f"""You are the storyteller for an interactive fiction platform.

You will receive a story outline, characters, world details, prior scenes, and optionally the player's latest choice. Write the next scene in vivid second-person or third-person prose (consistent within the story).

If the player's choice is empty, this is the opening scene—hook the reader and establish the situation.
If a choice is provided, continue the narrative based on that decision and its implied consequences.

Respond with a single JSON object only—no markdown fences, no preamble, no explanation.
Use exactly this shape:
{{
  "scene_text": "The narrative prose for this scene (1-2 paragraphs)",
  "location": "Where this scene takes place",
  "status": "active",
  "choices": [
    {{
      "choice_text": "Short label shown to the player",
      "consequence": "What happens narratively if they pick this (1-2 sentences)"
    }}
  ]
}}

Rules:
- Include exactly {REQUIRED_CHOICES} items in the "choices" array.
- Every choice must have both "choice_text" and "consequence".
- Set "status" to "active" for the new scene.
- Choices should be meaningfully different and advance the plot toward the outline's conflict.
- Do not repeat prior scenes verbatim; build on scene history and the player's choice."""

FINAL_SCENE_PROMPT = """You are the storyteller for an interactive fiction platform.

You will receive a story outline, characters, world details, prior scenes, and the player's latest choice. This is the FINAL SCENE of the story. Write a conclusive ending that:
- Wraps up all character arcs and story threads
- Provides emotional resolution and a satisfying conclusion
- References key moments from the scene history
- Ends with a sense of finality and closure

Respond with a single JSON object only—no markdown fences, no preamble, no explanation.
Use exactly this shape:
{{
  "scene_text": "The conclusive ending prose (2-3 paragraphs, rich and final)",
  "location": "Where this final scene takes place",
  "status": "completed",
  "choices": [],
  "story_summary": "A 2-3 sentence summary of the entire story from beginning to end."
}}

Rules:
- The "choices" array MUST be empty — this is the ending.
- The "story_summary" must capture the full arc of the story in 2-3 sentences.
- Set "status" to "completed" for the final scene.
- Make the ending memorable and emotionally resonant.
- Do not leave any plot threads unresolved."""

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
    outline: StoryOutline,
    characters: list[Character],
    world: WorldInfo,
    user_choice: str,
    scene_history: list[Scene],
) -> str:
    """Build the human message payload for scene generation."""
    is_opening = not user_choice.strip()
    payload = {
        "story_outline": outline,
        "characters": [asdict(character) for character in characters],
        "world": asdict(world),
        "scene_history": [asdict(scene) for scene in scene_history],
        "user_choice": user_choice.strip() if user_choice.strip() else None,
        "scene_type": "opening" if is_opening else "continuation",
    }
    return json.dumps(payload, indent=2)


def _parse_scene_response(raw: str) -> tuple[Scene, list[Choice]]:
    """
    Parse Claude's JSON into a Scene and exactly three Choice instances.

    Accepts a flat object or {"scene": {...}} with nested choices.
    """
    text = _strip_json_fences(raw)
    data = json.loads(text)

    if isinstance(data, dict) and "scene" in data and isinstance(data["scene"], dict):
        scene_data = data["scene"]
        choices_data = data.get("choices", scene_data.get("choices", []))
    else:
        if not isinstance(data, dict):
            raise ValueError("Response must be a JSON object")
        scene_data = data
        choices_data = data.get("choices", [])

    scene_required = ("scene_text", "location", "status")
    missing_scene = [key for key in scene_required if key not in scene_data]
    if missing_scene:
        raise ValueError(f"Missing scene keys: {', '.join(missing_scene)}")

    scene = Scene(
        scene_text=str(scene_data["scene_text"]).strip(),
        location=str(scene_data["location"]).strip(),
        status=str(scene_data["status"]).strip(),
    )

    if not isinstance(choices_data, list):
        raise ValueError('"choices" must be a JSON array')

    if len(choices_data) != REQUIRED_CHOICES:
        raise ValueError(
            f"Expected exactly {REQUIRED_CHOICES} choices, got {len(choices_data)}"
        )

    choices: list[Choice] = []
    for index, entry in enumerate(choices_data):
        if not isinstance(entry, dict):
            raise ValueError(f"Choice at index {index} must be a JSON object")
        if "choice_text" not in entry or "consequence" not in entry:
            raise ValueError(
                f"Choice at index {index} must include choice_text and consequence"
            )
        choices.append(
            Choice(
                choice_text=str(entry["choice_text"]).strip(),
                consequence=str(entry["consequence"]).strip(),
            )
        )

    return scene, choices


def _parse_final_scene_response(raw: str) -> tuple[Scene, list[Choice], str]:
    """
    Parse Claude's JSON for a final ending scene.

    Returns a Scene, an empty list of choices, and a story_summary string.
    """
    text = _strip_json_fences(raw)
    data = json.loads(text)

    if not isinstance(data, dict):
        raise ValueError("Response must be a JSON object")

    scene_data = data
    if "scene" in data and isinstance(data["scene"], dict):
        scene_data = data["scene"]

    scene_required = ("scene_text", "location", "status")
    missing_scene = [key for key in scene_required if key not in scene_data]
    if missing_scene:
        raise ValueError(f"Missing scene keys: {', '.join(missing_scene)}")

    scene = Scene(
        scene_text=str(scene_data["scene_text"]).strip(),
        location=str(scene_data["location"]).strip(),
        status=str(scene_data.get("status", "completed")).strip(),
    )

    story_summary = str(data.get("story_summary", scene_data.get("story_summary", ""))).strip()
    if not story_summary:
        story_summary = "The story has reached its conclusion."

    return scene, [], story_summary


def _invalid_state(state: NarrativeState, message: str) -> NarrativeState:
    """Return state marked invalid with an error message."""
    return {
        **state,
        "is_valid": False,
        "error_message": message,
    }


# ---------------------------------------------------------------------------
# Storyteller node
# ---------------------------------------------------------------------------


async def run_storyteller(state: NarrativeState) -> NarrativeState:
    """
    Generate the next ``Scene`` and ``choices`` from story context and ``user_choice``.

    Empty ``user_choice`` means the opening scene. Appends the new scene to
    ``scene_history``. On success, sets ``is_valid`` to True.

    When ``is_final`` is True, generates a conclusive ending scene with no
    choices and produces a ``story_summary``.
    """
    story_outline = state.get("story_outline")
    if not story_outline:
        return _invalid_state(
            state, "story_outline is required for the storyteller."
        )

    characters = state.get("characters") or []
    if not characters:
        return _invalid_state(state, "characters are required for the storyteller.")

    world = state.get("world")
    if world is None:
        return _invalid_state(state, "world is required for the storyteller.")

    user_choice = state.get("user_choice") or ""
    scene_history = list(state.get("scene_history") or [])
    is_final = state.get("is_final", False)

    prompt = FINAL_SCENE_PROMPT if is_final else SYSTEM_PROMPT

    try:
        raw_content = await fal_complete(
            system_prompt=prompt,
            prompt=(
                "Generate the next scene:\n"
                f"{_format_prompt_context(story_outline, characters, world, user_choice, scene_history)}"
            ),
            temperature=0.7,
        )

        if is_final:
            scene, choices, story_summary = _parse_final_scene_response(raw_content)
        else:
            scene, choices = _parse_scene_response(raw_content)
            story_summary = ""

        updated_history = scene_history + [scene]

        logger.info(
            "Storyteller for session %s: scene at %s (%d choices, is_final=%s)",
            state.get("session_id", ""),
            scene.location,
            len(choices),
            is_final,
        )

        result: NarrativeState = {
            **state,
            "current_scene": scene,
            "choices": choices,
            "scene_history": updated_history,
            "is_valid": True,
            "error_message": "",
        }

        if is_final:
            result["story_summary"] = story_summary

        return result

    except json.JSONDecodeError as exc:
        logger.error("Storyteller JSON parse failed: %s", exc)
        return _invalid_state(state, f"Could not parse scene as JSON: {exc}")
    except ValueError as exc:
        logger.error("Storyteller validation failed: %s", exc)
        return _invalid_state(state, str(exc))
    except Exception as exc:
        logger.exception("Storyteller failed")
        return _invalid_state(state, f"Storyteller error: {exc}")

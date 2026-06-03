"""
Judge agent: validates scene and choice quality before presenting them to the player.

Runs after the storyteller and sets ``is_valid`` / ``error_message`` on state.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict

from dotenv import load_dotenv

from graph.state import Choice, NarrativeState, Scene
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

SYSTEM_PROMPT = f"""You are a quality judge for an interactive fiction platform.

You will receive a scene and its branching choices. Decide whether they are ready to show to a player.

Evaluate all of the following:
1. scene_text is engaging and detailed (not a single vague sentence; has narrative depth)
2. Exactly {REQUIRED_CHOICES} choices are present
3. Each choice has a non-empty choice_text and a non-empty consequence
4. Choices are meaningfully different from each other (not duplicates or trivial rephrasings)

Respond with a single JSON object only—no markdown fences, no preamble, no explanation.
Use exactly these keys:
- "is_valid": boolean (true only if every check passes)
- "reason": string (brief explanation; if valid, summarize what passed; if invalid, state what failed)

Example when valid:
{{"is_valid": true, "reason": "Scene is vivid; three distinct choices with clear consequences."}}

Example when invalid:
{{"is_valid": false, "reason": "Choices 2 and 3 are too similar."}}"""

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


def _format_scene_and_choices(scene: Scene, choices: list[Choice]) -> str:
    """Serialize the scene and choices for the human message."""
    payload = {
        "current_scene": asdict(scene),
        "choices": [asdict(choice) for choice in choices],
    }
    return json.dumps(payload, indent=2)


def _structural_preflight(scene: Scene | None, choices: list[Choice], is_final: bool = False) -> str | None:
    """
    Fast local checks before calling Claude.

    Returns an error message if structure is invalid, else None.
    """
    if scene is None:
        return "current_scene is missing."

    if not (scene.scene_text or "").strip():
        return "scene_text is empty."

    if is_final:
        if len(choices) != 0:
            return f"Final scene must have 0 choices, got {len(choices)}."
    else:
        if len(choices) != REQUIRED_CHOICES:
            return f"Expected {REQUIRED_CHOICES} choices, got {len(choices)}."

    for index, choice in enumerate(choices, start=1):
        if not (choice.choice_text or "").strip():
            return f"Choice {index} is missing choice_text."
        if not (choice.consequence or "").strip():
            return f"Choice {index} is missing consequence."

    return None


def _parse_judgment_json(raw: str) -> tuple[bool, str]:
    """Parse Claude's JSON verdict into is_valid and reason."""
    text = _strip_json_fences(raw)
    data = json.loads(text)

    if not isinstance(data, dict):
        raise ValueError("Response must be a JSON object")

    if "is_valid" not in data or "reason" not in data:
        raise ValueError('Response must include "is_valid" and "reason"')

    is_valid_raw = data["is_valid"]
    if isinstance(is_valid_raw, bool):
        is_valid = is_valid_raw
    elif isinstance(is_valid_raw, str):
        is_valid = is_valid_raw.strip().lower() in ("true", "yes", "1")
    else:
        raise ValueError('"is_valid" must be a boolean')

    reason = str(data["reason"]).strip()
    if not reason:
        raise ValueError('"reason" must be a non-empty string')

    return is_valid, reason


# ---------------------------------------------------------------------------
# Judge node
# ---------------------------------------------------------------------------


async def run_judge(state: NarrativeState) -> NarrativeState:
    """
    Evaluate ``current_scene`` and ``choices`` quality via Claude.

    Sets ``is_valid`` to True with an empty ``error_message`` when approved.
    Sets ``is_valid`` to False and ``error_message`` to the failure reason otherwise.
    """
    current_scene = state.get("current_scene")
    choices = state.get("choices") or []
    is_final = state.get("is_final", False)

    preflight_error = _structural_preflight(current_scene, choices, is_final)
    if not preflight_error and is_final:
        return {
            **state,
            "is_valid": True,
            "error_message": "",
        }
    if preflight_error:
        logger.warning("Judge preflight failed: %s", preflight_error)
        return {
            **state,
            "is_valid": False,
            "error_message": preflight_error,
        }

    assert current_scene is not None  # narrowed after preflight

    try:
        raw_content = await fal_complete(
            system_prompt=SYSTEM_PROMPT,
            prompt=(
                "Evaluate this scene and choices:\n"
                f"{_format_scene_and_choices(current_scene, choices)}"
            ),
            temperature=0.2,
        )
        is_valid, reason = _parse_judgment_json(raw_content)

        logger.info(
            "Judge for session %s: is_valid=%s",
            state.get("session_id", ""),
            is_valid,
        )

        return {
            **state,
            "is_valid": is_valid,
            "error_message": "" if is_valid else reason,
        }

    except json.JSONDecodeError as exc:
        logger.error("Judge JSON parse failed: %s", exc)
        return {
            **state,
            "is_valid": False,
            "error_message": f"Could not parse judge response as JSON: {exc}",
        }
    except ValueError as exc:
        logger.error("Judge validation failed: %s", exc)
        return {
            **state,
            "is_valid": False,
            "error_message": str(exc),
        }
    except Exception as exc:
        logger.exception("Judge failed")
        return {
            **state,
            "is_valid": False,
            "error_message": f"Judge error: {exc}",
        }

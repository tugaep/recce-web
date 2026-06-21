"""
Judge agent: validates scene and choice quality before presenting them to the player.

Two-phase approach:
  Phase 1 – Local checks (no LLM):
    - _structural_preflight: hard structural errors → immediate rejection
    - _compute_risk_flags:   soft quality signals → produces risk_flags list

  Phase 2 – LLM evaluation (only when risk_flags is non-empty):
    - Sends scene + choices to the LLM for a quality verdict
    - On failure → retry via storyteller (max 1 retry, unchanged)

Final scene behaviour is unchanged: preflight pass → accepted immediately.
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

# Minimum word count for scene prose to be considered substantial
_MIN_SCENE_WORDS = 50
# Minimum word count for a single choice label
_MIN_CHOICE_WORDS = 3
# Minimum word count for a consequence description
_MIN_CONSEQUENCE_WORDS = 5
# Jaccard similarity threshold above which two choices are flagged as too similar
_CHOICE_SIMILARITY_THRESHOLD = 0.6
# Number of leading words used in choice similarity comparison
_CHOICE_COMPARE_WORDS = 5

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


def _compute_risk_flags(scene: Scene, choices: list[Choice]) -> list[str]:
    """
    Cheap local quality checks — no LLM, no I/O.

    Returns a list of flag strings. An empty list means the scene looks clean
    and can be accepted without an LLM round-trip.

    Checks performed:
      - scene_too_short     : prose word-count below _MIN_SCENE_WORDS
      - choice_too_vague    : any choice label below _MIN_CHOICE_WORDS
      - consequence_too_vague: any consequence below _MIN_CONSEQUENCE_WORDS
      - format_leak         : JSON/markdown artefacts visible in prose
      - incomplete_text     : prose does not end with sentence-ending punctuation
      - choices_too_similar : two or more choices share high Jaccard overlap
    """
    flags: list[str] = []
    scene_text = (scene.scene_text or "").strip()

    # --- Scene prose length ---
    word_count = len(scene_text.split())
    if word_count < _MIN_SCENE_WORDS:
        flags.append("scene_too_short")

    # --- Choice label / consequence length ---
    for choice in choices:
        if len((choice.choice_text or "").split()) < _MIN_CHOICE_WORDS:
            flags.append("choice_too_vague")
            break  # one flag per category is enough

    for choice in choices:
        if len((choice.consequence or "").split()) < _MIN_CONSEQUENCE_WORDS:
            flags.append("consequence_too_vague")
            break

    # --- Format leak: raw JSON or markdown fences in prose ---
    if re.search(r"```|^\s*\{", scene_text, re.MULTILINE):
        flags.append("format_leak")

    # --- Incomplete sentence (no terminal punctuation) ---
    if not re.search(r"[.!?][\"']?\s*$", scene_text):
        flags.append("incomplete_text")

    # --- Choice similarity (Jaccard on first N words) ---
    choice_word_sets = [
        set((c.choice_text or "").lower().split()[:_CHOICE_COMPARE_WORDS])
        for c in choices
    ]
    similarity_found = False
    for i in range(len(choice_word_sets)):
        for j in range(i + 1, len(choice_word_sets)):
            a, b = choice_word_sets[i], choice_word_sets[j]
            if a and b:
                jaccard = len(a & b) / len(a | b)
                if jaccard > _CHOICE_SIMILARITY_THRESHOLD:
                    similarity_found = True
                    break
        if similarity_found:
            break
    if similarity_found:
        flags.append("choices_too_similar")

    return flags


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
    Validate ``current_scene`` and ``choices`` using a two-phase approach.

    Phase 1 — Local checks (always, no LLM):
      a) _structural_preflight: hard errors (missing fields, wrong counts) →
         immediate rejection without retry.
      b) _compute_risk_flags: soft quality signals → produces risk_flags list.
         If risk_flags is empty the scene is accepted right away.

    Phase 2 — LLM evaluation (only when risk_flags is non-empty):
      Sends scene + choices to the configured LLM. On is_valid=False the
      graph's retry logic (max 1 pass) re-runs the storyteller.

    Final scene (is_final=True):
      Preflight pass → accepted immediately; LLM is never called.
      Preflight fail  → rejected immediately (unchanged behaviour).
    """
    current_scene = state.get("current_scene")
    choices = state.get("choices") or []
    is_final = state.get("is_final", False)

    # ------------------------------------------------------------------
    # Phase 1a: structural preflight (hard errors → immediate rejection)
    # ------------------------------------------------------------------
    preflight_error = _structural_preflight(current_scene, choices, is_final)
    if preflight_error:
        logger.warning("Judge preflight failed: %s", preflight_error)
        return {
            **state,
            "is_valid": False,
            "error_message": preflight_error,
            "risk_flags": [],
        }

    # Final scene: preflight passed → accept without LLM (unchanged behaviour)
    if is_final:
        logger.info(
            "Judge: final scene for session %s — preflight passed, accepted.",
            state.get("session_id", ""),
        )
        return {
            **state,
            "is_valid": True,
            "error_message": "",
            "risk_flags": [],
        }

    assert current_scene is not None  # narrowed by preflight

    # ------------------------------------------------------------------
    # Phase 1b: risk flag computation (soft quality checks, no LLM)
    # ------------------------------------------------------------------
    risk_flags = _compute_risk_flags(current_scene, choices)

    if not risk_flags:
        logger.info(
            "Judge: session %s — no risk flags, scene accepted without LLM.",
            state.get("session_id", ""),
        )
        return {
            **state,
            "is_valid": True,
            "error_message": "",
            "risk_flags": [],
        }

    # ------------------------------------------------------------------
    # Phase 2: LLM evaluation (only reached when risk_flags is non-empty)
    # ------------------------------------------------------------------
    logger.info(
        "Judge: session %s — risk flags %s, calling LLM.",
        state.get("session_id", ""),
        risk_flags,
    )

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
            "Judge LLM verdict for session %s: is_valid=%s, risk_flags=%s",
            state.get("session_id", ""),
            is_valid,
            risk_flags,
        )

        return {
            **state,
            "is_valid": is_valid,
            "error_message": "" if is_valid else reason,
            "risk_flags": risk_flags,
        }

    except json.JSONDecodeError as exc:
        logger.error("Judge JSON parse failed: %s", exc)
        return {
            **state,
            "is_valid": False,
            "error_message": f"Could not parse judge response as JSON: {exc}",
            "risk_flags": risk_flags,
        }
    except ValueError as exc:
        logger.error("Judge validation failed: %s", exc)
        return {
            **state,
            "is_valid": False,
            "error_message": str(exc),
            "risk_flags": risk_flags,
        }
    except Exception as exc:
        logger.exception("Judge failed")
        return {
            **state,
            "is_valid": False,
            "error_message": f"Judge error: {exc}",
            "risk_flags": risk_flags,
        }

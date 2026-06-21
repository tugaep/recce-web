"""
Judge: a structural gate (blocking) plus a forward quality advisor (non-blocking).

  run_gate(state) — local structural checks ONLY (no LLM). The single thing that
    can block a scene reaching the player: missing scene, wrong choice count,
    empty fields. Instant.

  review_for_next_scene(scene, choices) — runs AFTER the scene is shown. Local
    risk flags first, then an LLM verdict only when flags exist. Returns short,
    actionable guidance that the caller appends to ``next_scene_guidance`` so the
    NEXT storyteller call avoids the problem. Never blocks or regenerates the
    current scene.

Feed-forward: the player never waits on quality judgement — it compounds forward.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict

from dotenv import load_dotenv

from graph.state import Choice, NarrativeState, Scene
from llm.fal_llm import complete as fal_complete, FAST_LLM_MODEL

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
- "reason": string (if valid, a short summary; if invalid, an ACTIONABLE instruction the writer should follow in the NEXT scene to avoid this — not just what failed)

Example when valid:
{{"is_valid": true, "reason": "Scene is vivid; three distinct choices with clear consequences."}}

Example when invalid:
{{"is_valid": false, "reason": "Make the three choices clearly distinct next time — two were near-duplicates."}}"""

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
# Gate (synchronous, blocking) + forward advisor (async, non-blocking)
# ---------------------------------------------------------------------------


async def run_gate(state: NarrativeState) -> NarrativeState:
    """
    Structural gate — local checks only, no LLM. The ONLY validation that blocks
    a scene from reaching the player.

    Catches genuinely-broken output (missing scene, wrong choice count, empty
    fields) that can't be rendered in the UI. Soft quality is no longer judged
    here — that moves to :func:`review_for_next_scene`, which runs after the
    scene is shown and feeds guidance forward.

    Returns state with ``is_valid``/``error_message`` set. On failure the graph's
    retry logic re-runs the storyteller once (structural errors only, unchanged).
    """
    current_scene = state.get("current_scene")
    choices = state.get("choices") or []
    is_final = state.get("is_final", False)

    preflight_error = _structural_preflight(current_scene, choices, is_final)
    if preflight_error:
        logger.warning("Gate failed (structural): %s", preflight_error)
        return {**state, "is_valid": False, "error_message": preflight_error}

    logger.info(
        "Gate passed for session %s (is_final=%s).",
        state.get("session_id", ""),
        is_final,
    )
    return {**state, "is_valid": True, "error_message": ""}


async def review_for_next_scene(
    scene: Scene | None, choices: list[Choice]
) -> str | None:
    """
    Forward quality review — runs AFTER the scene is shown; never blocks it.

    Two phases, both advisory:
      1. Local risk flags (no LLM). Empty → clean → return None.
      2. LLM verdict only when flags exist. If the verdict is invalid, return a
         short, actionable guidance string; the caller appends it to
         ``next_scene_guidance`` so the storyteller avoids it on the next scene.

    Returns None when clean — or on ANY error (fail open; guidance is best-effort
    and must never break the turn).
    """
    if scene is None:
        return None

    risk_flags = _compute_risk_flags(scene, choices)
    if not risk_flags:
        return None

    try:
        raw_content = await fal_complete(
            system_prompt=SYSTEM_PROMPT,
            prompt=(
                "Evaluate this scene and choices:\n"
                f"{_format_scene_and_choices(scene, choices)}"
            ),
            temperature=0.2,
            model=FAST_LLM_MODEL,  # a short verdict JSON — keep it cheap
            max_tokens=512,
        )
        is_valid, reason = _parse_judgment_json(raw_content)
    except Exception as exc:
        logger.warning("Forward review failed (no guidance produced): %s", exc)
        return None

    if is_valid:
        return None

    logger.info("Forward review flagged scene (flags=%s); guidance: %s", risk_flags, reason)
    return reason

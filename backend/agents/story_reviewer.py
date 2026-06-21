"""
Story Reviewer agent: holistic post-story quality analysis.

Unlike the Judge (which validates individual scenes during generation),
the Story Reviewer runs once after the full story is complete — at the
user's explicit request.  It reads all scenes together and evaluates
the story as a whole: character consistency, world coherence, narrative
arc, and the meaningfulness of the player's choices.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict
from typing import Any

from llm.fal_llm import complete as fal_complete

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a literary editor reviewing a complete interactive story.

You will receive the story outline, cast, world, and all scenes in chronological order.
Evaluate the story as a whole — not individual scenes in isolation.

Focus on:
1. Character consistency — Do characters behave according to their established personalities across all scenes?
2. World consistency — Does the setting remain coherent? Are the rules of the world respected?
3. Narrative arc — Is there a satisfying beginning, middle, and end? Does the conflict resolve meaningfully?
4. Choice impact — Did the player's choices feel consequential and meaningfully different?
5. Overall craft — Pacing, tone, imagery, and emotional resonance.

Respond with a single JSON object only — no markdown fences, no preamble, no explanation outside the JSON.
Use exactly this shape:
{
  "overall_impression": "2-3 sentences summarising the story's overall quality and feel",
  "narrative_arc": "Assessment of the story structure — does it have a clear arc and satisfying resolution?",
  "inconsistencies": [
    {"type": "character|world|narrative", "description": "What is inconsistent and in which scene"}
  ],
  "highlights": ["What worked particularly well — 2 to 4 specific items"],
  "suggestions": ["Concrete improvements for a future telling — 2 to 4 specific items"]
}

Rules:
- If there are no inconsistencies, return an empty array: "inconsistencies": []
- Keep each highlight and suggestion to 1-2 sentences.
- Be honest but constructive.
- Reference specific scenes or character names when relevant."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_fences(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    return m.group(1).strip() if m else text


def _to_dict(obj: Any) -> Any:
    """Safely convert dataclasses to dicts; pass plain dicts/lists through."""
    if hasattr(obj, "__dataclass_fields__"):
        return asdict(obj)
    if isinstance(obj, list):
        return [_to_dict(item) for item in obj]
    return obj


def _build_prompt(
    story_outline: dict,
    characters: list,
    world: Any,
    scene_history: list,
    user_idea: str,
) -> str:
    payload = {
        "user_idea": user_idea,
        "story_outline": story_outline,
        "characters": _to_dict(characters),
        "world": _to_dict(world),
        "scenes": _to_dict(scene_history),
        "total_scenes": len(scene_history),
    }
    return f"Please review this complete story:\n{json.dumps(payload, indent=2, default=str)}"


def _parse(raw: str) -> dict[str, Any]:
    data = json.loads(_strip_fences(raw))
    if not isinstance(data, dict):
        raise ValueError("Review response must be a JSON object")
    required = ("overall_impression", "narrative_arc", "inconsistencies", "highlights", "suggestions")
    missing = [k for k in required if k not in data]
    if missing:
        raise ValueError(f"Review missing keys: {', '.join(missing)}")
    data["inconsistencies"] = data.get("inconsistencies") or []
    data["highlights"] = data.get("highlights") or []
    data["suggestions"] = data.get("suggestions") or []
    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def run_story_reviewer(
    story_outline: dict,
    characters: list,
    world: Any,
    scene_history: list,
    user_idea: str,
) -> dict[str, Any]:
    """
    Run a holistic review of a completed story.

    Returns a dict with keys: overall_impression, narrative_arc,
    inconsistencies, highlights, suggestions.
    """
    raw = await fal_complete(
        system_prompt=SYSTEM_PROMPT,
        prompt=_build_prompt(story_outline, characters, world, scene_history, user_idea),
        temperature=0.4,
    )
    review = _parse(raw)
    logger.info(
        "Story review complete — %d inconsistencies, %d highlights, %d suggestions",
        len(review["inconsistencies"]),
        len(review["highlights"]),
        len(review["suggestions"]),
    )
    return review

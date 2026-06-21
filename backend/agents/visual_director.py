"""
Visual Director agent (Claude Sonnet 4.6).

Establishes the project's visual style guide and writes detailed, self-contained
gpt-image-2 prompts for the rendering agents (Character Portrait Artist, World &
Environment Artist, Scene Composer). Every rendering prompt restates the style
guide so independently-generated images stay visually coherent.

Two entry points:
  - ``run_visual_director`` — full pass on story start (style guide + prompts for
    every character, the world establishing shot, and the opening scene).
  - ``run_scene_director`` — lightweight per-turn pass that writes only the next
    scene's prompt, reusing the already-established style guide.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict

from dotenv import load_dotenv

from graph.state import Character, StoryOutline, WorldInfo
from llm.fal_llm import complete as fal_complete

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are the Visual Director for an interactive cinematic storytelling platform.

You receive a story outline, the cast, and the world. Your job is to (1) define one cohesive visual style guide for the whole production, and (2) write a detailed, self-contained image-generation prompt for each character portrait, for the world establishing shot, and for the opening scene.

The style guide must lock in: medium/render (e.g. cinematic digital painting, 35mm film still), color palette, lighting, lens/composition, and era/mood. Every image prompt you write MUST restate the key style-guide cues verbatim so that images generated independently look like they belong to the same film.

Write prompts the way a concept artist would brief an image model: concrete, visual, specific (framing, subject, environment, light, color, mood). No narrative exposition, no second person, no choices — only what should be visible in the frame.

Respond with a single JSON object only—no markdown fences, no preamble, no explanation.
Use exactly this shape:
{
  "style_guide": "One paragraph locking medium, palette, lighting, lens, era, mood.",
  "characters": [
    {"name": "<must match a provided character name>", "prompt": "Full portrait prompt restating the style guide."}
  ],
  "world": {"prompt": "Establishing-shot prompt for the primary location, restating the style guide."},
  "scene": {"prompt": "Cinematic prompt for the opening scene moment, restating the style guide."}
}

Rules:
- Include exactly one entry in "characters" for each character you are given, with matching names.
- Keep each prompt vivid but under ~90 words.
- Do not include any text, captions, watermarks, or UI in the images."""

SCENE_SYSTEM_PROMPT = """You are the Visual Director for an interactive cinematic storytelling platform.

You receive an established visual style guide, the cast, the world, and the prose of the scene currently being shown to the player. Write ONE cinematic gpt-image-2 prompt that illustrates the pivotal moment of this scene, combining the relevant characters and environment into a single dramatic frame.

The prompt MUST restate the key cues from the style guide verbatim so this image matches every other image in the production.

Respond with a single JSON object only—no markdown fences, no preamble, no explanation:
{"prompt": "Full cinematic scene prompt restating the style guide."}

Rules:
- Describe only what is visible in the frame (framing, subjects, environment, light, color, mood).
- No text, captions, watermarks, or UI in the image.
- Keep it vivid but under ~90 words."""


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


def _character_brief(characters: list[Character]) -> list[dict]:
    """Slim character payload for the director prompt (name + description only)."""
    return [{"name": c.name, "description": c.description} for c in characters]


async def run_visual_director(
    outline: StoryOutline | dict,
    characters: list[Character],
    world: WorldInfo,
) -> dict:
    """
    Produce the style guide plus image prompts for cast, world, and opening scene.

    Returns a dict:
        {
          "style_guide": str,
          "characters": [{"name": str, "prompt": str}, ...],  # one per input character
          "world": {"prompt": str},
          "scene": {"prompt": str},
        }

    Raises on parse/validation failure so the caller can fall back gracefully.
    """
    payload = {
        "story_outline": outline,
        "characters": _character_brief(characters),
        "world": asdict(world),
    }

    raw = await fal_complete(
        system_prompt=SYSTEM_PROMPT,
        prompt="Design the visual plan:\n" + json.dumps(payload, indent=2),
        temperature=0.6,
    )

    data = json.loads(_strip_json_fences(raw))
    if not isinstance(data, dict):
        raise ValueError("Visual Director response must be a JSON object")

    style_guide = str(data.get("style_guide", "")).strip()
    char_entries = data.get("characters") or []
    world_prompt = ((data.get("world") or {}) if isinstance(data.get("world"), dict) else {}).get(
        "prompt", ""
    )
    scene_prompt = ((data.get("scene") or {}) if isinstance(data.get("scene"), dict) else {}).get(
        "prompt", ""
    )

    if not style_guide or not world_prompt or not scene_prompt:
        raise ValueError("Visual Director response missing style_guide/world/scene prompts")

    # Normalise character prompts and align them to the input cast by name (best effort).
    by_name: dict[str, str] = {}
    if isinstance(char_entries, list):
        for entry in char_entries:
            if isinstance(entry, dict) and entry.get("name"):
                by_name[str(entry["name"]).strip().lower()] = str(entry.get("prompt", "")).strip()

    characters_out: list[dict] = []
    for index, c in enumerate(characters):
        prompt = by_name.get(c.name.strip().lower(), "")
        if not prompt and index < len(char_entries) and isinstance(char_entries[index], dict):
            prompt = str(char_entries[index].get("prompt", "")).strip()
        characters_out.append({"name": c.name, "prompt": prompt})

    logger.info("Visual Director produced %d character prompts", len(characters_out))

    return {
        "style_guide": style_guide,
        "characters": characters_out,
        "world": {"prompt": str(world_prompt).strip()},
        "scene": {"prompt": str(scene_prompt).strip()},
    }


def build_scene_prompt(
    style_guide: str,
    scene_text: str,
    location: str,
    characters: list[Character],
    world: WorldInfo | None,
    continuity_notes: list[str] | None = None,
) -> str:
    """
    Compose a scene-illustration prompt deterministically — no LLM call.

    The style guide is already established at story start, so per-scene images can
    skip the Scene Director round-trip (~15s) and assemble a strong prompt from the
    style guide + scene prose + cast. Keeps choices snappy.

    ``continuity_notes`` are forward corrections from the visual continuity checker
    on earlier frames (e.g. "palette drifted warm"); prepending them steers this
    render back on-style instead of re-rendering the previous one.
    """
    cast = ", ".join(c.name for c in characters[:3])
    where = location or (world.location_name if world else "")
    # Trim prose to keep the prompt focused on the visible moment.
    summary = " ".join((scene_text or "").split())[:320]
    notes = "; ".join(n for n in (continuity_notes or []) if n)
    parts = [
        style_guide.strip(),
        f"Continuity corrections to apply: {notes}." if notes else "",
        f"Cinematic frame{f' at {where}' if where else ''}.",
        summary,
        f"Featuring {cast}." if cast else "",
        "Single dramatic composition. No text, captions, watermarks, or UI.",
    ]
    return " ".join(p for p in parts if p)


async def run_scene_director(
    style_guide: str,
    scene_text: str,
    characters: list[Character],
    world: WorldInfo | None,
) -> str:
    """
    Write a single scene-illustration prompt for a continuation turn.

    Reuses the established ``style_guide`` so the new scene matches prior images.
    Returns the prompt string; raises on parse/validation failure.
    """
    payload = {
        "style_guide": style_guide,
        "characters": _character_brief(characters),
        "world": asdict(world) if world is not None else None,
        "scene_text": scene_text,
    }

    raw = await fal_complete(
        system_prompt=SCENE_SYSTEM_PROMPT,
        prompt="Illustrate this scene:\n" + json.dumps(payload, indent=2),
        temperature=0.6,
    )

    data = json.loads(_strip_json_fences(raw))
    if not isinstance(data, dict):
        raise ValueError("Scene Director response must be a JSON object")

    prompt = str(data.get("prompt", "")).strip()
    if not prompt:
        raise ValueError("Scene Director response missing 'prompt'")

    return prompt

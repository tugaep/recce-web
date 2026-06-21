"""
Visual Continuity Checker (Claude Sonnet 4.6).

Reviews each rendering prompt against the production's style guide and flags
inconsistent ones for regeneration, returning a tightened prompt when needed.

This is a best-effort, text-based check: it evaluates whether the image prompt
faithfully encodes the style guide. It is intentionally non-blocking — any error
results in the image being accepted as-is.

TODO: upgrade to true vision review — send the rendered image URL to a
vision-capable model (once exposed through fal) and compare the actual pixels
against the style guide, rather than reviewing the prompt alone.
"""

from __future__ import annotations

import json
import logging
import re

from dotenv import load_dotenv

from llm.fal_llm import complete as fal_complete, FAST_LLM_MODEL

load_dotenv()

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are the Visual Continuity Checker for a cinematic storytelling production.

You are given the production's visual style guide and a single image-generation prompt. Decide whether the prompt faithfully encodes the style guide's key cues (medium/render, color palette, lighting, lens/composition, era/mood) so the resulting image will match the rest of the film.

Respond with a single JSON object only—no markdown fences, no preamble:
{"consistent": true|false, "issues": "brief note", "revised_prompt": "a tightened prompt that restates the missing style cues; echo the original if already consistent"}

Be lenient: only mark "consistent": false when key style cues are clearly missing or contradicted."""


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fence_match:
        return fence_match.group(1).strip()
    return text


async def run_continuity_check(style_guide: str, prompt: str) -> dict:
    """
    Check a rendering prompt against the style guide.

    Returns ``{"consistent": bool, "issues": str, "revised_prompt": str}``. On any
    error, returns ``consistent=True`` (fail-open, never blocks rendering).

    ``issues`` is the actionable note the caller feeds FORWARD into the next scene's
    image prompt — the shown image is never re-rendered.
    """
    if not style_guide or not prompt:
        return {"consistent": True, "issues": "", "revised_prompt": prompt}

    try:
        raw = await fal_complete(
            system_prompt=SYSTEM_PROMPT,
            prompt=json.dumps({"style_guide": style_guide, "prompt": prompt}, indent=2),
            temperature=0.2,
            model=FAST_LLM_MODEL,  # mechanical consistency check — keep it cheap
        )
        data = json.loads(_strip_json_fences(raw))
        consistent = bool(data.get("consistent", True))
        issues = str(data.get("issues") or "").strip()
        revised = str(data.get("revised_prompt") or "").strip() or prompt
        if not consistent:
            logger.info("Continuity Checker flagged a prompt: %s", issues)
        return {"consistent": consistent, "issues": issues, "revised_prompt": revised}
    except Exception as exc:
        # Fail open: never block image generation on a continuity hiccup.
        logger.warning("Continuity check failed (accepting image as-is): %s", exc)
        return {"consistent": True, "issues": "", "revised_prompt": prompt}

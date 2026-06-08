"""
World & Environment Artist (gpt-image-2).

Renders the key location of the story as a landscape establishing shot from the
Visual Director's prompt. Thin wrapper over :func:`llm.fal_image.generate_image`.
"""

from __future__ import annotations

import logging

from llm.fal_image import generate_image

logger = logging.getLogger(__name__)


async def render_environment(prompt: str) -> str:
    """Render a world establishing shot and return its URL. Raises on failure."""
    logger.info("World & Environment Artist rendering establishing shot")
    return await generate_image(prompt)

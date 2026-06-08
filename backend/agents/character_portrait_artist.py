"""
Character Portrait Artist (gpt-image-2).

Renders a character portrait from the Visual Director's prompt. Thin wrapper over
:func:`llm.fal_image.generate_image` using a portrait aspect ratio.
"""

from __future__ import annotations

import logging

from llm.fal_image import PORTRAIT_SIZE, generate_image

logger = logging.getLogger(__name__)


async def render_portrait(prompt: str) -> str:
    """Render a character portrait and return its URL. Raises on failure."""
    logger.info("Character Portrait Artist rendering portrait")
    return await generate_image(prompt, image_size=PORTRAIT_SIZE)

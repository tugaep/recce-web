"""
Scene Composer (gpt-image-2).

Renders a pivotal story moment by combining characters and environment into a
single dramatic landscape frame from the Visual Director's prompt. Thin wrapper
over :func:`llm.fal_image.generate_image`.
"""

from __future__ import annotations

import logging

from llm.fal_image import generate_image

logger = logging.getLogger(__name__)


async def render_scene(prompt: str) -> str:
    """Render a scene illustration and return its URL. Raises on failure."""
    logger.info("Scene Composer rendering scene frame")
    return await generate_image(prompt)

"""
fal-routed image client.

Every visual rendering agent (Character Portrait Artist, World & Environment
Artist, Scene Composer) calls :func:`generate_image` instead of talking to a
model directly. Image generation (gpt-image-2) is served through fal's
``fal-ai/gpt-image-2`` endpoint, which takes a ``prompt`` plus sizing options and
returns CDN-hosted image URLs.

Mirrors the shape of :mod:`llm.fal_llm` (lazy fal import, env-overridable model).
"""

from __future__ import annotations

import logging
import os
from typing import Union

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# fal endpoint serving OpenAI's gpt-image-2 text-to-image model.
FAL_IMAGE_MODEL = os.getenv("FAL_IMAGE_MODEL", "fal-ai/gpt-image-2")

# Rendering quality: low | medium | high. Measured gpt-image-2 latency per image:
# low ~27s, medium ~60s, high ~140s. Default to "low" so the live demo stays
# responsive; bump via FAL_IMAGE_QUALITY for richer (but much slower) images.
FAL_IMAGE_QUALITY = os.getenv("FAL_IMAGE_QUALITY", "low")

# Default aspect for establishing shots and scenes (landscape).
FAL_IMAGE_SIZE = os.getenv("FAL_IMAGE_SIZE", "landscape_4_3")

# Portrait aspect for character art (taller than wide).
PORTRAIT_SIZE: dict[str, int] = {"width": 1024, "height": 1280}


def _ensure_fal_key() -> None:
    if not os.getenv("FAL_KEY"):
        raise ValueError(
            "FAL_KEY is not set. Add it to backend/.env or the environment."
        )


async def generate_image(
    prompt: str,
    image_size: Union[str, dict[str, int], None] = None,
    quality: str | None = None,
    model: str | None = None,
) -> str:
    """
    Render a single image via fal and return its URL.

    Args:
        prompt: Full text-to-image prompt (the Visual Director writes these).
        image_size: Preset name (e.g. ``landscape_4_3``) or ``{"width", "height"}``.
                    Defaults to :data:`FAL_IMAGE_SIZE`.
        quality: ``low`` | ``medium`` | ``high`` for gpt-image-2. Pass ``""`` or set the
            module default empty to omit it entirely — fast diffusion models (e.g.
            flux/schnell) reject the gpt-image-2 ``quality`` knob.
        model: Optional fal model id; defaults to :data:`FAL_IMAGE_MODEL`.

    Returns:
        The first generated image's URL (hosted on fal's CDN).

    Raises:
        ValueError: If FAL_KEY is missing or the response carries no image URL.
    """
    _ensure_fal_key()

    if not prompt or not prompt.strip():
        raise ValueError("generate_image requires a non-empty prompt.")

    # Lazy import keeps the module importable without fal installed (tests/tooling).
    import fal_client

    resolved_model = model or FAL_IMAGE_MODEL
    resolved_quality = quality if quality is not None else FAL_IMAGE_QUALITY

    arguments: dict = {
        "prompt": prompt,
        "image_size": image_size if image_size is not None else FAL_IMAGE_SIZE,
        "num_images": 1,
        "output_format": "png",
    }
    # Only gpt-image-2 takes `quality`; omit it for models that don't (keeps the
    # fast-model preset from erroring on an unknown argument).
    if resolved_quality:
        arguments["quality"] = resolved_quality

    logger.info("fal image generate: model=%s quality=%s", resolved_model, resolved_quality or "-")
    result = await fal_client.subscribe_async(resolved_model, arguments=arguments)

    images = (result or {}).get("images") or []
    if not images or not isinstance(images, list):
        raise ValueError(
            f"fal image model returned no images (model={resolved_model}); "
            f"raw keys: {sorted((result or {}).keys())}"
        )

    url = images[0].get("url") if isinstance(images[0], dict) else None
    if not isinstance(url, str) or not url.strip():
        raise ValueError(
            f"fal image model returned no usable URL (model={resolved_model})."
        )

    return url

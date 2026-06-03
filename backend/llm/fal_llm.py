"""
fal-routed LLM client.

Every story agent calls :func:`complete` instead of talking to Anthropic
directly. Text generation (Claude Sonnet 4.6) is served through fal's
``openrouter/router`` endpoint, which exposes the newest Claude models via an
OpenRouter-style id and a simple ``prompt`` + ``system_prompt`` schema that maps
cleanly onto the agents' existing system/human two-message pattern.

The dedicated ``fal-ai/any-llm`` endpoint is deprecated, so ``openrouter/router``
is used as the default. Endpoint and model are overridable via env so the model
id can be re-pointed (e.g. to ``anthropic/claude-sonnet-4.5``) without code
changes if 4.6 is not yet resolvable.
"""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# fal endpoint that proxies to OpenRouter's model catalog (covers newest Claude).
FAL_LLM_ENDPOINT = os.getenv("FAL_LLM_ENDPOINT", "openrouter/router")

# OpenRouter-style model id. Falls back via env if 4.6 is unavailable on fal.
FAL_LLM_MODEL = os.getenv("FAL_LLM_MODEL", "anthropic/claude-sonnet-4.6")

# Generous default; storyteller scenes can be long. Overridable per call.
DEFAULT_MAX_TOKENS = int(os.getenv("FAL_LLM_MAX_TOKENS", "4096"))


def _ensure_fal_key() -> None:
    if not os.getenv("FAL_KEY"):
        raise ValueError(
            "FAL_KEY is not set. Add it to backend/.env or the environment."
        )


async def complete(
    system_prompt: str,
    prompt: str,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> str:
    """
    Generate a completion via fal and return the raw text output.

    Args:
        system_prompt: System/instruction context for the model.
        prompt: The user/human message content.
        temperature: Sampling temperature (per-agent value preserved by callers).
        max_tokens: Optional generation cap; defaults to ``DEFAULT_MAX_TOKENS``.

    Returns:
        The model's text output (callers parse JSON out of it, as before).
    """
    _ensure_fal_key()

    # Imported lazily so importing this module never hard-requires the package
    # at collection time (keeps tests/tooling importable without fal installed).
    import fal_client

    arguments = {
        "model": FAL_LLM_MODEL,
        "prompt": prompt,
        "system_prompt": system_prompt,
        "temperature": temperature,
        "max_tokens": max_tokens if max_tokens is not None else DEFAULT_MAX_TOKENS,
    }

    result = await fal_client.subscribe_async(FAL_LLM_ENDPOINT, arguments=arguments)

    output = (result or {}).get("output")
    if not isinstance(output, str) or not output.strip():
        raise ValueError(
            f"fal LLM returned no usable output (endpoint={FAL_LLM_ENDPOINT}, "
            f"model={FAL_LLM_MODEL}); raw keys: {sorted((result or {}).keys())}"
        )
    return output

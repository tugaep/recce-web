"""
LangGraph workflow for the interactive storytelling pipeline.

Flow:
  START -> orchestrator
       -> character_designer ─┐
       -> world_builder      ├─> merge_node -> storyteller -> judge -> END
       (parallel)            ┘                              └-> prepare_retry -> storyteller
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Literal, Optional

from langgraph.graph import END, START, StateGraph

from agents.character_designer import run_character_designer
from agents.judge import run_judge
from agents.orchestrator import run_orchestrator
from agents.storyteller import run_storyteller
from agents.world_builder import run_world_builder
from graph.state import NarrativeState

# ---------------------------------------------------------------------------
# Debug helpers
# ---------------------------------------------------------------------------


def _debug_keys(node_name: str, label: str, data: dict[str, Any]) -> None:
    """Print state keys and selected values for pipeline tracing."""
    keys = sorted(data.keys())
    print(f"[DEBUG {node_name}] {label} keys: {keys}")
    if "world" in data:
        world = data.get("world")
        print(
            f"[DEBUG {node_name}] {label} world present: {world is not None}"
            + (
                f" (location_name={getattr(world, 'location_name', None)})"
                if world is not None
                else ""
            )
        )
    if "characters" in data:
        chars = data.get("characters") or []
        print(f"[DEBUG {node_name}] {label} characters count: {len(chars)}")
    if "current_scene" in data:
        scene = data.get("current_scene")
        print(f"[DEBUG {node_name}] {label} current_scene present: {scene is not None}")


# ---------------------------------------------------------------------------
# Parallel-safe node wrappers
# ---------------------------------------------------------------------------


async def character_designer_node(state: NarrativeState) -> dict:
    """
    Run the character designer; write only to ``characters_from_designer``.

    Avoids concurrent updates to ``characters`` with world_builder.
    """
    _debug_keys("character_designer", "incoming state", dict(state))
    result = await run_character_designer(state)
    out = {"characters_from_designer": list(result.get("characters") or [])}
    print(
        f"[DEBUG character_designer] returning characters_from_designer count: "
        f"{len(out['characters_from_designer'])}"
    )
    return out


async def world_builder_node(state: NarrativeState) -> dict:
    """
    Run the world builder; write only ``world``.

    Avoids concurrent updates with character_designer.
    """
    _debug_keys("world_builder", "incoming state", dict(state))
    result = await run_world_builder(state)
    world = result.get("world")
    if world is None:
        print("[DEBUG world_builder] returning: {} (world is None)")
        return {}
    out = {"world": world}
    print(
        f"[DEBUG world_builder] returning world: "
        f"location_name={world.location_name!r}, time_period={world.time_period!r}"
    )
    return out


async def merge_node(state: NarrativeState) -> dict:
    """
    Fan-in after parallel branches: copy staged cast into ``characters``.

    Re-emits ``world`` so it is not lost after parallel fan-in merges.
    """
    state_dict = dict(state)
    _debug_keys("merge_node", "incoming state", state_dict)

    out: dict[str, Any] = {}

    designed = state.get("characters_from_designer")
    if designed is not None:
        out["characters"] = list(designed)
        print(f"[DEBUG merge_node] setting characters count: {len(out['characters'])}")

    world = state.get("world")
    if world is not None:
        out["world"] = world
        print(
            f"[DEBUG merge_node] preserving world: "
            f"location_name={world.location_name!r}"
        )
    else:
        print("[DEBUG merge_node] WARNING: world is None in incoming state")

    print(f"[DEBUG merge_node] returning keys: {list(out.keys())}")
    return out


async def storyteller_node(state: NarrativeState) -> dict:
    """
    Run the storyteller and return explicit scene fields (plus preserved context).
    """
    state_dict = dict(state)
    _debug_keys("storyteller", "incoming state", state_dict)

    world = state.get("world")
    print(f"[DEBUG storyteller] state['world'] exists before agent: {world is not None}")

    result = await run_storyteller(state)

    out: dict[str, Any] = {
        "current_scene": result.get("current_scene"),
        "choices": result.get("choices") or [],
        "scene_history": result.get("scene_history") or [],
        "is_valid": result.get("is_valid", True),
        "error_message": result.get("error_message", ""),
    }

    # Re-emit context so downstream state stays complete after partial updates
    if result.get("world") is not None:
        out["world"] = result.get("world")
    elif world is not None:
        out["world"] = world

    if result.get("characters"):
        out["characters"] = result.get("characters")

    scene = out.get("current_scene")
    print(
        f"[DEBUG storyteller] returning keys: {list(out.keys())}, "
        f"current_scene present: {scene is not None}, "
        f"choices count: {len(out.get('choices') or [])}"
    )
    return out


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------


def route_after_judge(state: NarrativeState) -> Literal["end", "retry"]:
    """
    After the judge: finish if valid, or retry storyteller once if not.

    Uses ``storyteller_retry_count`` to allow a single regeneration pass.
    """
    if state.get("is_valid"):
        return "end"

    retries = state.get("storyteller_retry_count", 0)
    if retries < 1:
        return "retry"

    return "end"


async def prepare_retry(state: NarrativeState) -> dict:
    """Increment retry counter before re-running the storyteller."""
    retries = state.get("storyteller_retry_count", 0)
    print(f"[DEBUG prepare_retry] storyteller_retry_count: {retries} -> {retries + 1}")
    return {"storyteller_retry_count": retries + 1}


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------


def _build_narrative_graph():
    """Wire agent nodes into a compiled LangGraph."""
    workflow = StateGraph(NarrativeState)

    workflow.add_node("orchestrator", run_orchestrator)
    workflow.add_node("character_designer", character_designer_node)
    workflow.add_node("world_builder", world_builder_node)
    workflow.add_node("merge_node", merge_node)
    workflow.add_node("storyteller", storyteller_node)
    workflow.add_node("judge", run_judge)
    workflow.add_node("prepare_retry", prepare_retry)

    # Entry: begin with story outline from the user's idea
    workflow.add_edge(START, "orchestrator")

    # Fan-out: build cast and world in parallel (disjoint state keys)
    workflow.add_edge("orchestrator", "character_designer")
    workflow.add_edge("orchestrator", "world_builder")

    # Fan-in: merge staged characters, then generate the scene
    workflow.add_edge(
        ["character_designer", "world_builder"],
        "merge_node",
    )
    workflow.add_edge("merge_node", "storyteller")

    workflow.add_edge("storyteller", "judge")

    workflow.add_conditional_edges(
        "judge",
        route_after_judge,
        {
            "end": END,
            "retry": "prepare_retry",
        },
    )
    workflow.add_edge("prepare_retry", "storyteller")

    return workflow.compile()


# Compiled graph used by the API and tests
narrative_graph = _build_narrative_graph()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def run_narrative(
    state: NarrativeState,
    on_progress: Optional[Callable[[str], Awaitable[None]]] = None,
) -> NarrativeState:
    """
    Run the full narrative pipeline from user idea through scene generation.

    Args:
        state: Initial narrative state (must include ``user_idea`` and ``session_id``).
        on_progress: Optional async callback invoked with a milestone key
            ("shaping" | "casting" | "building" | "writing") the first time each
            becomes available, so callers can stream real progress to the UI.

    Returns:
        Final state after orchestration, world/character setup, storytelling, and judging.
    """
    if "storyteller_retry_count" not in state:
        state = {**state, "storyteller_retry_count": 0}

    if on_progress is None:
        return await narrative_graph.ainvoke(state)

    # Stream full state values after each node so we can surface real milestones.
    # The last yielded value is the final state (equivalent to ainvoke). Falls back
    # to ainvoke if streaming yields nothing.
    final: Optional[NarrativeState] = None
    seen: set[str] = set()

    async def fire(stage: str, ready: bool) -> None:
        if ready and stage not in seen:
            seen.add(stage)
            try:
                await on_progress(stage)
            except Exception:  # progress is best-effort; never break the pipeline
                pass

    async for values in narrative_graph.astream(state, stream_mode="values"):
        final = values
        await fire("shaping", bool(values.get("story_outline")))
        await fire("casting", bool(values.get("characters")))
        await fire("building", values.get("world") is not None)
        await fire("writing", values.get("current_scene") is not None)

    return final if final is not None else await narrative_graph.ainvoke(state)


async def run_continuation(state: NarrativeState) -> NarrativeState:
    """
    Continue an existing story session with a new scene — skips the setup pipeline.

    Only storyteller_node and judge logic are executed.  orchestrator,
    character_designer, world_builder and merge_node are **not** called because
    world/character context is already established in the incoming state.

    Two-phase judge logic mirrors judge.py:
      Phase 1a – _structural_preflight: hard errors → immediate rejection.
      Phase 1b – _compute_risk_flags:  soft quality checks → risk_flags list.
                 Empty flags → scene accepted without LLM.
      Phase 2  – LLM judge (run_judge): called only when risk_flags non-empty.

    Retry logic:
      - If phase 1a or 2 marks the scene invalid and storyteller_retry_count < 1,
        the storyteller is called once more with an incremented counter.
      - A second failure is accepted as-is and returned to the caller.

    Args:
        state: Current narrative state.  Must include ``characters``, ``world``,
               ``scene_history``, ``user_choice``, and ``session_id``.

    Returns:
        Final state after storytelling and judging (with possible single retry).
    """
    from agents.judge import _structural_preflight, _compute_risk_flags

    # Ensure retry counter is present
    if "storyteller_retry_count" not in state:
        state = {**state, "storyteller_retry_count": 0}

    is_final = state.get("is_final", False)

    print(
        f"[DEBUG run_continuation] starting — session_id={state.get('session_id')!r}, "
        f"retry_count={state.get('storyteller_retry_count')}, is_final={is_final}"
    )

    async def _run_once(current_state: NarrativeState) -> tuple[NarrativeState, bool, str | None, list[str]]:
        """
        Run storyteller + local phase-1 checks.

        Returns (new_state, is_valid, preflight_error, risk_flags).
        """
        storyteller_delta = await storyteller_node(current_state)
        new_state = {**current_state, **storyteller_delta}

        # Phase 1a: structural preflight
        preflight_error = _structural_preflight(
            new_state.get("current_scene"), new_state.get("choices") or [], is_final
        )
        if preflight_error:
            print(f"[DEBUG run_continuation] preflight failed: {preflight_error!r}")
            return new_state, False, preflight_error, []

        # Final scene: preflight passed → accept immediately (no LLM)
        if is_final:
            print("[DEBUG run_continuation] final scene — preflight passed, accepted.")
            return new_state, True, None, []

        # Phase 1b: risk flags (soft quality checks, no LLM)
        scene = new_state.get("current_scene")
        choices = new_state.get("choices") or []
        risk_flags = _compute_risk_flags(scene, choices)  # type: ignore[arg-type]

        print(
            f"[DEBUG run_continuation] risk_flags={risk_flags}, "
            f"retry_count={new_state.get('storyteller_retry_count')}"
        )
        return new_state, len(risk_flags) == 0, None, risk_flags

    # --- First storyteller pass ---
    state, is_valid, preflight_error, risk_flags = await _run_once(state)

    # --- Single retry if local checks failed and no retries used yet ---
    if not is_valid and state.get("storyteller_retry_count", 0) < 1:
        print("[DEBUG run_continuation] local check failed — retrying storyteller once")
        state = {**state, "storyteller_retry_count": state.get("storyteller_retry_count", 0) + 1}
        state, is_valid, preflight_error, risk_flags = await _run_once(state)
        print(f"[DEBUG run_continuation] after retry — is_valid={is_valid}")

    # --- Phase 2: LLM judge only if risk flags remain after retry ---
    if is_valid is False and preflight_error is not None:
        # Hard structural error — reject without LLM
        return {**state, "is_valid": False, "error_message": preflight_error, "risk_flags": []}

    if risk_flags:
        # Soft quality issue — escalate to LLM judge
        print(f"[DEBUG run_continuation] escalating to LLM judge — flags={risk_flags}")
        judged = await run_judge(state)
        return judged

    # Clean scene — accept without LLM
    return {**state, "is_valid": is_valid, "error_message": preflight_error or "", "risk_flags": risk_flags}


# ---------------------------------------------------------------------------
# Two-phase story initialisation helpers
# ---------------------------------------------------------------------------


async def run_setup(
    state: NarrativeState,
    on_progress: Optional[Callable[[str], Awaitable[None]]] = None,
) -> NarrativeState:
    """
    Phase 1 of story initialisation: orchestrator → character_designer + world_builder
    (parallel fan-out) → merge_node.

    Returns state with ``story_outline``, ``characters``, and ``world`` populated.
    Does **not** run the storyteller — call ``run_first_scene`` for that so the
    frontend can display the world/character page while the scene generates.

    Args:
        state:       Initial narrative state (must include ``user_idea`` and ``session_id``).
        on_progress: Optional async callback fired with milestone keys
                     ("shaping" | "casting" | "building") as each stage completes.
    """
    async def _fire(stage: str) -> None:
        if on_progress:
            try:
                await on_progress(stage)
            except Exception:  # progress is best-effort; never break the pipeline
                pass

    # --- Orchestrator: build story outline ---
    orchestrator_result = await run_orchestrator(state)
    state = {**state, **orchestrator_result}
    await _fire("shaping")

    # --- Parallel fan-out: character designer + world builder ---
    # Both nodes write to disjoint keys so concurrent execution is safe.
    char_result, world_result = await asyncio.gather(
        character_designer_node(state),
        world_builder_node(state),
    )
    state = {**state, **char_result, **world_result}
    await _fire("casting")
    await _fire("building")

    # --- Fan-in: merge staged characters into the live characters field ---
    merge_result = await merge_node(state)
    state = {**state, **merge_result}

    return state


async def run_first_scene(state: NarrativeState) -> NarrativeState:
    """
    Phase 2 of story initialisation: storyteller → judge (with single retry on failure).

    Semantically identical to ``run_continuation`` — both run the storyteller and
    the two-phase judge (local risk-flags + optional LLM) with a single retry guard.
    Named distinctly so call-sites read clearly as "Phase 2 of setup" rather than
    "a continuation turn".

    Args:
        state: State returned by ``run_setup`` (must include ``characters`` and ``world``).
    """
    return await run_continuation(state)


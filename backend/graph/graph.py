"""
LangGraph workflow for the interactive storytelling pipeline.

Flow:
  START -> orchestrator
       -> character_designer ─┐
       -> world_builder      ├─> merge_node -> storyteller -> judge -> END
       (parallel)            ┘                              └-> prepare_retry -> storyteller
"""

from __future__ import annotations

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

    Only storyteller_node and run_judge are executed.  orchestrator,
    character_designer, world_builder and merge_node are **not** called because
    world/character context is already established in the incoming state.

    Retry logic mirrors the compiled graph:
      - If the judge marks the scene invalid **and** ``storyteller_retry_count``
        is 0, the storyteller is called once more with an incremented counter.
      - A second failure (or any subsequent call with retry_count >= 1) is
        accepted as-is and returned to the caller.

    Args:
        state: Current narrative state.  Must include ``characters``, ``world``,
               ``scene_history``, ``user_choice``, and ``session_id``.

    Returns:
        Final state after storytelling and judging (with possible single retry).
    """
    # Ensure retry counter is present
    if "storyteller_retry_count" not in state:
        state = {**state, "storyteller_retry_count": 0}

    print(
        f"[DEBUG run_continuation] starting — session_id={state.get('session_id')!r}, "
        f"retry_count={state.get('storyteller_retry_count')}"
    )

    # --- First storyteller pass ---
    storyteller_delta = await storyteller_node(state)
    state = {**state, **storyteller_delta}

    # --- Judge ---
    judge_delta = await run_judge(state)
    state = {**state, **judge_delta}

    print(
        f"[DEBUG run_continuation] after judge — is_valid={state.get('is_valid')}, "
        f"retry_count={state.get('storyteller_retry_count')}"
    )

    # --- Single retry if invalid and no retries used yet ---
    if not state.get("is_valid") and state.get("storyteller_retry_count", 0) < 1:
        print("[DEBUG run_continuation] scene invalid — retrying storyteller once")
        state = {**state, "storyteller_retry_count": state.get("storyteller_retry_count", 0) + 1}

        storyteller_delta = await storyteller_node(state)
        state = {**state, **storyteller_delta}

        judge_delta = await run_judge(state)
        state = {**state, **judge_delta}

        print(
            f"[DEBUG run_continuation] after retry judge — is_valid={state.get('is_valid')}"
        )

    return state

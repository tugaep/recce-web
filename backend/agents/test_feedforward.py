"""
Feed-forward checker self-check (no network, no pytest).

Verifies the ship-now / fix-next contract:
  - run_gate blocks ONLY on structural breakage (wrong choice count, empty scene)
  - review_for_next_scene is a no-op (no LLM call) on a clean scene
  - _forward_scene_review writes guidance into the session AFTER the scene was sent
    (the task is scheduled, not awaited, so the send is never blocked)

Run: backend/.venv/bin/python agents/test_feedforward.py
"""

from __future__ import annotations

import asyncio

from graph.state import Scene, Choice


def _choices_ok() -> list[Choice]:
    return [
        Choice("Climb the spiral stair", "You ascend toward the flickering light above the landing."),
        Choice("Search the flooded cellar", "You wade into the dark water looking for another way out."),
        Choice("Call out to the stranger", "Your voice echoes and something below stirs in reply."),
    ]


def _scene_ok() -> Scene:
    text = (
        "Rain hammers the lighthouse windows as you trace the seam of a door that "
        "should not exist, cut into the living rock of the cliff. The lamp above "
        "stutters, throwing long shadows that seem to lean toward you, and from "
        "somewhere below comes the slow drip of water against stone, patient as a "
        "tide that has waited a very long time for you to finally arrive here."
    )
    return Scene(scene_text=text, location="The Lighthouse", status="active")


async def test_run_gate() -> None:
    from agents.judge import run_gate

    s = await run_gate({"current_scene": _scene_ok(), "choices": _choices_ok(), "is_final": False})
    assert s["is_valid"] is True, "clean 3-choice scene should pass the gate"

    # Wrong choice count → blocked (the one thing that must STILL block).
    s = await run_gate({"current_scene": _scene_ok(), "choices": _choices_ok()[:2], "is_final": False})
    assert s["is_valid"] is False, "2 choices must fail the structural gate"

    # Empty scene → blocked.
    s = await run_gate({"current_scene": Scene("", "X", "active"), "choices": _choices_ok(), "is_final": False})
    assert s["is_valid"] is False, "empty scene_text must fail the gate"
    print("run_gate: ok")


async def test_review_clean_is_noop() -> None:
    from agents.judge import review_for_next_scene, _compute_risk_flags

    # Clean scene → no risk flags → returns None WITHOUT calling the LLM (no network).
    assert _compute_risk_flags(_scene_ok(), _choices_ok()) == [], "clean scene should have no risk flags"
    guidance = await review_for_next_scene(_scene_ok(), _choices_ok())
    assert guidance is None, "clean scene should produce no forward guidance (and no network call)"

    # A too-short scene DOES flag → the forward review path would fire.
    short = Scene("Too short.", "X", "active")
    assert _compute_risk_flags(short, _choices_ok()), "short scene should raise a risk flag"
    print("review_for_next_scene (clean no-op): ok")


async def test_forward_review_is_after_send() -> None:
    import main

    # Stub the LLM verdict with a slow async fn so we can observe ordering.
    async def slow_guidance(scene, choices):
        await asyncio.sleep(0.05)
        return "Make the three choices clearly distinct next time."

    original = main.review_for_next_scene
    main.review_for_next_scene = slow_guidance
    try:
        session: dict = {"next_scene_guidance": []}
        # This mirrors handle_make_choice AFTER send_message("choice_applied"):
        session["_pending_review"] = asyncio.create_task(
            main._forward_scene_review(session, _scene_ok(), _choices_ok())
        )
        # Immediately after scheduling, the send has "already happened" and guidance
        # is NOT yet present — the player never waited on the review.
        assert session["next_scene_guidance"] == [], "review must not block the send"

        # By the next turn (think time), the guidance has landed.
        await main._await_pending_review(session)
        assert session["next_scene_guidance"] == [
            "Make the three choices clearly distinct next time."
        ], "forward guidance should be queued for the next scene"
        assert session["_pending_review"].done(), "pending review should be complete"
    finally:
        main.review_for_next_scene = original
    print("forward review ordering: ok")


async def test_scene_text_streamer() -> None:
    from agents.storyteller import _SceneTextStreamer

    # Cumulative chunks of a streaming JSON response, including escaped \n and \".
    full = (
        '{"scene_text": "The door creaks open.\\nShe says \\"run\\".", '
        '"location": "Hall", "status": "active", "choices": []}'
    )
    chunks = [full[:i] for i in (5, 14, 19, 28, 41, 55, 75, len(full))]
    s = _SceneTextStreamer()
    out = "".join(s.feed(c) for c in chunks)
    assert out == 'The door creaks open.\nShe says "run".', repr(out)
    # Idempotent once the value is closed: no extra prose on repeat feeds.
    assert s.feed(full) == ""
    print("scene_text streamer: ok")


async def _run() -> None:
    await test_run_gate()
    await test_review_clean_is_noop()
    await test_forward_review_is_after_send()
    await test_scene_text_streamer()
    print("ALL FEED-FORWARD CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(_run())

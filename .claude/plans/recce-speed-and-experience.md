# Recce — Speed & Experience Implementation Plan

Two goals: **make recce faster** and **make it more engaging**. Two design
directives layered on top:

1. **Feed-forward checkers** — judges/checkers stop blocking and re-generating the
   *current* output. They ship the current scene/image immediately and turn their
   findings into directives that prevent the same problem in the *next* scene/image.
   (This also deletes the blocking retry + re-render loops, so it's a speed win.)
2. **Cinema everywhere** — every loading/animation state reads as film
   (projector, film gate, light-leak, focus pull, leader countdown), and icons
   move to [hugeicons](https://hugeicons.com/) (camera/film/image set).

Build order is dependency-ordered. Each phase is independently shippable.

---

## Phase 0 — State plumbing for feed-forward (S)

Enables Phase 1. No behaviour change on its own.

**`backend/graph/state.py`** — add two carry fields to `NarrativeState`:
```python
next_scene_guidance: NotRequired[List[str]]      # judge notes → next storyteller call
visual_continuity_notes: NotRequired[List[str]]  # checker notes → next image prompt
```
These ride in the connection-scoped session dict and are mirrored into the
`story_outline` jsonb (same no-schema-change pattern already used for
`text_preset`/`image_preset` at `main.py:386`). Survives reconnect/resume.

**Check:** `assert "next_scene_guidance" in NarrativeState.__annotations__`.

---

## Phase 1 — Feed-forward checkers & judges (M) — *the centerpiece*

Today the checkers **block**:
- Graph judge → `route_after_judge` retries the storyteller (`graph.py:166`, blocking LLM + regen).
- `run_continuation` escalates risk-flags to a blocking LLM judge + storyteller retry (`graph.py:372-381`).
- Visual continuity checker re-renders the current image inline (`main.py:183-192`, worst case ~+27s/image).

Convert all three to **ship-now, fix-next**.

### 1a. Split the judge into "gate" vs "advisor"
- **Keep** `_structural_preflight` as the *only* synchronous gate (`judge.py:97`). It's
  local, instant, and catches genuinely-broken output (empty scene, wrong choice
  count) you can't ship into the UI. Keep the single structural retry. *(ponytail:
  this stays — it's correctness, not quality, and costs ~0ms.)*
- **Remove** the soft-quality LLM judge from the blocking path. `run_judge`'s LLM
  verdict no longer triggers a retry.

`graph.py`: `route_after_judge` retries only on structural failure; delete the
risk-flag → LLM-judge → retry escalation in `run_continuation` (`graph.py:372-384`).

### 1b. Run the quality judge *after* the scene is sent, as forward guidance
In `handle_make_choice` (after `send_message("choice_applied")`, `main.py:561`) and
`handle_start_story` (after `story_started`, `main.py:438`):
```python
async def _forward_review(session, scene, choices):
    verdict = await run_judge_llm(scene, choices)        # the old Phase-2 LLM call
    if not verdict.is_valid:
        session["next_scene_guidance"].append(verdict.reason)
session["_pending_review"] = asyncio.create_task(_forward_review(...))
```
The user reads the scene (20-60s+); the verdict (~2-4s) lands long before the next
choice. At the top of the next turn, `await asyncio.wait_for(session["_pending_review"], 0.1)`
so guidance is incorporated when ready, never waited on when not.

### 1c. Inject guidance into the next storyteller call
`storyteller.py:107` `_format_prompt_context` — add a field:
```python
"continuity_directives": state.get("next_scene_guidance") or [],
```
and one line in `SYSTEM_PROMPT`: *"Honor any `continuity_directives`: these are
fixes flagged in the previous scene — do not repeat those issues."*

### 1d. Visual checker → forward notes instead of re-render
`main.py:183-192` `run_job`: drop the inline re-render. After the continuity check,
append `issues` to `session["visual_continuity_notes"]`. Keep it fully non-blocking.

`visual_director.py` — `build_scene_prompt` (`:164`) and `run_visual_director` (`:94`)
take optional `continuity_notes: list[str]` and prepend them to the prompt so the
*next* render corrects course (e.g. "earlier frames drifted warm — hold the cold
palette").

**Net speed effect:** choice-turn critical path drops from
`storyteller + maybe judge-LLM + maybe storyteller-retry` → `storyteller` only;
image path loses the worst-case re-render (~27s). Quality is preserved — it just
compounds forward instead of stalling the user.

**Check:** `backend/agents/test_feedforward.py` — feed a deliberately-short scene,
assert the judge marks it invalid AND that the reason lands in
`next_scene_guidance` AND that `choice_applied` was emitted *before* the review task
resolved (ordering is the whole point).

---

## Phase 2 — Progressive reveal + overlap visuals (M) — *perceived speed + engagement*

`run_setup` + `run_first_scene` already exist (`graph.py:392-450`) but aren't used —
`handle_start_story` calls the combined `run_narrative`. Rewire it:

```python
state = await run_setup(state, on_progress=emit_progress)   # orchestrator → cast ‖ world
await send_message(ws, "cast_ready",  {"characters": ...})  # reveal cast NOW
await send_message(ws, "world_ready", {"world": ...})       # reveal world NOW
visuals = asyncio.create_task(generate_initial_visuals(...))# portraits/world render in parallel
state = await run_first_scene(state)                        # storyteller
await send_message(ws, "story_started", {"scene":..., "choices":...})
await visuals
```
Cast/world appear ~5s in instead of ~15s; the user is reading character cards while
the opening scene and its image generate. Portraits/world renders overlap the
storyteller (they only need cast+world), so the first image lands ~5-10s sooner.

**Frontend** (`demo.tsx`): `useWebSocket` handles `cast_ready`/`world_ready` →
enter `reveal` and stream characters in as they arrive (the image skeletons already
handle "not yet rendered"). `story_started` then unlocks "Begin the first scene".

**Check:** `useWebSocket.test.ts` — assert `cast_ready` moves stage to `reveal` and
populates characters before `story_started` arrives.

---

## Phase 3 — Real text streaming (M) — *biggest perceived-speed win* ⚠️ spike first

Today nothing streams: `complete()` uses `subscribe_async` (`fal_llm.py:98`) and the
scene ships whole; `StreamingText` fakes a typewriter over already-complete text.

**Spike (do first):** confirm `fal_client.stream_async` against `openrouter/router`
yields incremental tokens. If yes → real streaming. If no → server-side
sentence-chunking fallback (split completed text, emit chunks over WS) — still
removes the all-at-once dump.

- `fal_llm.py`: add `async def complete_stream(...) -> AsyncIterator[str]`.
- `storyteller.py`: opening + continuation use the streaming path; parse JSON
  incrementally enough to separate `scene_text` (stream) from `choices` (send at end).
- `main.py`: forward `scene_delta` frames as chunks arrive; `choices` follow in the
  final `story_started`/`choice_applied`.
- `StreamingText.tsx`: consume real deltas instead of self-animating; keep the
  reduced-motion instant-dump path.

**Check:** existing `StreamingText.test.tsx` updated to assert it renders appended
deltas (not a fixed-speed timer).

---

## Phase 4 — Cinema animation system + hugeicons (M) — *engagement / design*

### 4a. Cinema animation library
`styles.css` already has `sweep`/`spin-slow`/`breathe`/`float-y` (`:228-262`). Add a
cohesive film vocabulary and re-skin every loader/transition with it:

| New keyframe | Use |
|---|---|
| `film-grain` (stepped opacity flicker) | overlay on all loaders & image skeletons |
| `gate-flicker` (projector luminance jitter) | dreaming loader backdrop |
| `light-leak` (warm sweep bloom) | scene/stage transitions |
| `focus-pull` (blur→sharp on enter) | image fade-in, replaces plain `fade-in` |
| `leader-countdown` (rotating sweep wedge) | dreaming loader ring (3·2·1 academy leader) |
| `letterbox-in` (top/bottom bars ease in) | entering `play` |

Keep everything behind the existing `prefers-reduced-motion` block (`:264`) — extend
the selector list with the new classes. *(ponytail: pure CSS; no JS animation lib.)*

**Targets:** `DreamingLoader` (`demo.tsx:402`), the in-scene "Writing the next
scene…" card (`demo.tsx:692`), `StoryImage` skeleton (`StoryImage.tsx`), stage
transitions, review spinner.

### 4b. hugeicons adoption (scoped)
Install `@hugeicons/react` + `@hugeicons/core-free-icons` (the live packages;
`hugeicons-react` is deprecated). Usage: `<HugeiconsIcon icon={CameraIcon} />`.

**Swap only the ~12 user-facing icons in 3 files** — leave the 18 shadcn-internal
icons (Chevron/Check/X/etc. in `components/ui/*`) on lucide; swapping vendored
primitive chrome is churn with no design payoff:
- `StoryImage.tsx` — `Aperture` → camera/aperture from hugeicons.
- `demo.tsx` — `Aperture, ArrowRight, ArrowLeft, RotateCcw, Sparkles, BookOpen`
  → film/camera/clapboard equivalents.
- `index.tsx` — `Sparkles, Users, Globe2, GitBranch, ArrowRight` → cinematic set.

*(ponytail: scope the swap to what the user sees; a global icon migration is busywork.)*

**Check:** `npm run build` clean + `StoryImage.test.tsx` still passes (skeleton renders an icon).

---

## Phase 5 — UX robustness: stop it ever feeling broken (M) — *the P0 fixes*

1. **Surface connection state + generation timeout.** `isConnected`/`isLoading`
   from `useWebSocket` are never read (`useWebSocket.ts`). Gate submit on a live
   socket; show "connecting…/reconnecting"; add a client timeout on `dreaming` →
   error+retry if `story_started`/`cast_ready` never arrives. Fixes the infinite
   loader when the backend is down (`demo.tsx:180` currently transitions anyway).
2. **Surface mid-story errors.** `error` only forces the error screen during
   `dreaming` (`demo.tsx:169`). Handle it in `play`/`reveal` too, and add retry on a
   failed choice (the "Writing the next scene…" spinner currently hangs forever).
3. **Real character role/traits; delete mock-by-index.** `demo.tsx:543-567` labels
   every story's cast with `mockCharacters` by index ("The Lighthouse Keeper" on a
   Tokyo noir; nothing for char #3). Use the real `Character` fields the backend
   already returns, or drop the chips. Add `personality`/`backstory` to the
   `characters` payload in `story_started`/`cast_ready` so the cards have real content.
4. **Typewriter skip + caret cleanup.** Tap-to-complete on `StreamingText`; hide the
   pulsing caret on done (wire the already-present-but-unused `onDone`,
   `StreamingText.tsx:40`, `demo.tsx:687`).

**Check:** `useWebSocket.test.ts` — submit with socket closed → stays on idea with a
visible error, does NOT enter `dreaming`.

---

## Phase 6 — Engagement upside (L)

1. **Persist + resume + share.** `session_id` exists in the payload type
   (`useWebSocket.ts:30`) but is never stored. Save it to `localStorage` + URL; on
   load, offer "resume". Add a read-only share link (`/story/:id`) and a "play again
   with this idea" button on the summary.
2. **Branch / story map in the summary.** `StorySummary` (`demo.tsx:759`) already has
   every scene + chosen choice. Render the path as a vertical film-strip map
   (frames = scenes, connectors = choices), with the roads-not-taken greyed — turns
   the ending into something to explore and re-run.
3. **Ambient audio.** Native `<audio>`: one mood loop keyed off `world.atmosphere` +
   a subtle SFX on choice. Mute toggle in `Nav`. *(ponytail: no audio lib.)*

**Check:** reload mid-story → resume restores stage + history from the cached session.

---

## Phase 7 — Tuning & polish (S each)

Speed:
- **Per-agent model tiers.** Orchestrator (outline, temp 0.3), judge, continuity
  don't need Sonnet/Opus — route to Haiku via the `model=` arg `complete()` already
  accepts (`fal_llm.py:65`), even when prose uses a bigger model.
- **Trim `max_tokens`.** `DEFAULT_MAX_TOKENS=4096` (`fal_llm.py:50`) is applied to
  tiny JSON outputs (orchestrator, judge); pass ~512 for those to cut tail latency.
- **Background the start DB write.** `save_session` is awaited on the start path
  (`main.py:395`); `make_choice` already backgrounds it (`main.py:594`). Mirror it.
- **Prompt-cache continuation.** Outline+cast+world+history are re-sent every turn
  (`storyteller.py:107`); cache the static prefix once fal/openrouter caching is wired.
- **Fast-preview images.** Render a `flux/schnell` preview (seconds), swap in the
  quality render when ready — `StoryImage` already fades/swaps on a new url.

UX:
- **Choice grid + copy.** Backend returns **3** choices; grid is `sm:grid-cols-2`
  (`demo.tsx:733`) → 2+1 wrap. Make it 3-up. Fix stale landing copy ("mocked story
  data"/"Three scenes. Two paths." `index.tsx:101,204`).
- **Touch affordances.** Choice-card feedback is hover-only → dead on mobile
  (`demo.tsx:733`); add `active:`/tap states.
- **Restart tells the backend.** `restart` (`demo.tsx:195`) doesn't notify the
  server → orphaned generations keep running. Send a `cancel`/close.

---

## Suggested sequencing

```
0 → 1   (feed-forward: the directive + the biggest choice-turn speed win)
2       (progressive reveal: helpers already exist, low cost, high felt speed)
4       (cinema + hugeicons: the design directive; independent, parallelizable)
5       (robustness: cheap, stops "feels broken")
3       (text streaming: highest perceived win, but spike fal support first)
6       (persist/share/map/audio: the durable engagement layer)
7       (tuning sweep)
```

Phases 1, 2, 4, 5 are the high-leverage core and have no hard dependencies on each
other beyond Phase 0. Recommend 0→1→2 first (speed), then 4 (design) in parallel.

# Multi-Agent System Design

## 1. Overview

Recce uses two families of agents coordinated by a LangGraph state graph:

- **Story Agents** — work in language (Claude Sonnet 4.6)
- **Visual Agents** — turn descriptions into images (Claude Sonnet 4.6 + gpt-image-2 via fal.ai)

Every language task uses Claude Sonnet 4.6. Every image task uses gpt-image-2.

## 2. Story Agents

### Orchestrator

| Field | Value |
|-------|-------|
| **Model** | Claude Sonnet 4.6 |
| **Role** | Reads user input, routes to specialist agents, manages the narrative state graph |

**Input:** User idea (string) or user choice (choice ID + current narrative state)

**Output:** Routing decision — which agents to invoke next and in what order

**Responsibilities:**
- Parse the user's initial movie idea into structured intent
- Route to Character Designer + World Builder (parallel) for story setup
- Route to Storyteller for each new scene
- Route to Visual Director after story content is ready
- Trigger Judge validation before committing outputs to state
- Manage the narrative state graph (current scene, choice history, established facts)
- Decide when the story ends

---

### Character Designer

| Field | Value |
|-------|-------|
| **Model** | Claude Sonnet 4.6 |
| **Role** | Generates characters with names, backstories, personalities, and physical descriptions |

**Input:** User idea + world context (if World Builder ran first or concurrently)

**Output Schema:**
```json
{
  "characters": [
    {
      "name": "string",
      "role": "protagonist | antagonist | supporting",
      "backstory": "string",
      "personality_traits": ["string"],
      "appearance": {
        "physical_description": "string",
        "clothing": "string",
        "distinguishing_features": "string"
      },
      "motivation": "string"
    }
  ]
}
```

**Notes:** Typically generates 3-5 characters. The `appearance` field is designed to be directly consumable by the Visual Director for portrait prompt writing.

---

### World Builder

| Field | Value |
|-------|-------|
| **Model** | Claude Sonnet 4.6 |
| **Role** | Designs locations, time period, atmosphere, and the rules of the world |

**Input:** User idea + character roster (if available)

**Output Schema:**
```json
{
  "world": {
    "title": "string",
    "time_period": "string",
    "setting": "string",
    "atmosphere": "string",
    "rules": ["string"],
    "key_locations": [
      {
        "name": "string",
        "description": "string",
        "mood": "string"
      }
    ],
    "cultural_details": "string"
  }
}
```

**Notes:** Runs in parallel with Character Designer. Both receive the raw user idea and produce independent outputs that the Orchestrator merges into shared state.

---

### Storyteller

| Field | Value |
|-------|-------|
| **Model** | Claude Sonnet 4.6 |
| **Role** | Writes scenes, dialogue, and the branching choices presented to the player |

**Input:** Narrative state (characters, world, scene history, last user choice)

**Output Schema:**
```json
{
  "scene": {
    "scene_number": "int",
    "narrative_text": "string",
    "dialogue": [
      {
        "character": "string",
        "line": "string"
      }
    ],
    "choices": [
      {
        "id": "string",
        "text": "string",
        "consequence_hint": "string"
      }
    ],
    "scene_description_for_visual": "string",
    "is_ending": "boolean"
  }
}
```

**Notes:** The `scene_description_for_visual` field is a concise visual prompt seed that the Visual Director can expand into a full image prompt. The `consequence_hint` is internal (not shown to the player) — it guides the next Storyteller invocation.

---

### Judge

| Field | Value |
|-------|-------|
| **Model** | Claude Sonnet 4.6 |
| **Role** | Validates each agent's output for structure, coherence, continuity, and safety before it's committed to state |

**Input:** Agent output + full narrative state (read-only access)

**Output Schema:**
```json
{
  "verdict": "APPROVE | REVISE | REJECT",
  "reason": "string",
  "feedback": "string (only for REVISE)",
  "checks": {
    "structural_validity": "pass | fail",
    "semantic_coherence": "pass | fail",
    "continuity": "pass | fail",
    "player_meaning": "pass | fail (Storyteller only)",
    "safety": "pass | fail"
  }
}
```

**Validation checks:**
- **Structural validity** — does the output conform to the expected schema?
- **Semantic coherence** — does it fit the world's tone and rules?
- **Continuity** — does it contradict anything already established?
- **Player meaning** (Storyteller only) — do the choices lead to meaningfully different paths?
- **Safety** — no real public figures, no content policy violations

**Verdicts:**
- `APPROVE` — output is committed to state, narrative advances
- `REVISE` — output is sent back to the specialist with specific feedback for one retry
- `REJECT` — output is discarded, Orchestrator decides whether to retry or fallback

---

## 3. Visual Agents

### Visual Director

| Field | Value |
|-------|-------|
| **Model** | Claude Sonnet 4.6 |
| **Role** | Establishes the project's visual style guide and writes detailed image prompts for the rendering agents |

**Input:** World description + character appearances + scene description

**Output Schema:**
```json
{
  "style_guide": {
    "art_style": "string",
    "color_palette": "string",
    "lighting": "string",
    "mood": "string",
    "reference_notes": "string"
  },
  "image_prompts": {
    "character_portraits": [
      {
        "character_name": "string",
        "prompt": "string"
      }
    ],
    "environment": {
      "location_name": "string",
      "prompt": "string"
    },
    "scene": {
      "description": "string",
      "prompt": "string"
    }
  }
}
```

**Notes:** The style guide is created once at story setup and applied to every subsequent image prompt. This ensures visual consistency across the entire playthrough.

---

### Character Portrait Artist

| Field | Value |
|-------|-------|
| **Model** | gpt-image-2 (via fal.ai) |
| **Role** | Renders portraits and full-body shots of each character from the Visual Director's prompts |

**Input:** Image prompt (string) from Visual Director + style guide

**Output:** Image URL (uploaded to Supabase Storage)

---

### World & Environment Artist

| Field | Value |
|-------|-------|
| **Model** | gpt-image-2 (via fal.ai) |
| **Role** | Renders key locations — interiors, exteriors, landscapes, establishing shots |

**Input:** Image prompt (string) from Visual Director + style guide

**Output:** Image URL (uploaded to Supabase Storage)

---

### Scene Composer

| Field | Value |
|-------|-------|
| **Model** | gpt-image-2 (via fal.ai) |
| **Role** | Renders pivotal story moments by combining characters and environments into single dramatic frames |

**Input:** Scene image prompt from Visual Director (combines character + environment context)

**Output:** Image URL (uploaded to Supabase Storage)

---

### Visual Continuity Checker

| Field | Value |
|-------|-------|
| **Model** | Claude Sonnet 4.6 |
| **Role** | Reviews each generated image against the style guide and flags inconsistent outputs for regeneration |

**Input:** Generated image + style guide + previous images for comparison

**Output Schema:**
```json
{
  "verdict": "APPROVE | REGENERATE",
  "reason": "string",
  "consistency_score": "float (0-1)",
  "issues": ["string"]
}
```

**Notes:** If `REGENERATE`, the image is sent back to the originating rendering agent with updated prompt guidance.

---

## 4. LangGraph State Graph

### Graph Structure

```
                    ┌─────────────┐
                    │  User Input  │
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
                    │ Orchestrator │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
     ┌────────────────┐      ┌────────────────┐
     │ Char. Designer  │      │ World Builder   │
     └────────┬───────┘      └────────┬───────┘
              │                       │
              └───────────┬───────────┘
                          ▼
                   ┌─────────────┐
                   │    Judge     │ ◄── validates story agent outputs
                   └──────┬──────┘
                          ▼
                  ┌───────────────┐
                  │ Visual Director│
                  └───────┬───────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌────────────┐ ┌──────────┐ ┌───────────┐
     │ Portrait   │ │ Environ. │ │ Scene     │
     │ Artist     │ │ Artist   │ │ Composer  │
     └─────┬──────┘ └────┬─────┘ └─────┬─────┘
           │              │             │
           └──────────────┼─────────────┘
                          ▼
              ┌────────────────────┐
              │ Visual Continuity  │
              │ Checker            │
              └─────────┬──────────┘
                        ▼
                 ┌─────────────┐
                 │ Storyteller  │ ◄── (for subsequent scenes, runs before visual)
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │    Judge     │
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │ Send to User │
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │ User Choice  │ ──► back to Orchestrator
                 └─────────────┘
```

### Shared State Object

The LangGraph state object flows through all nodes:

```python
class NarrativeState(TypedDict):
    story_id: str
    user_idea: str
    characters: list[dict]          # Character Designer output
    world: dict                     # World Builder output
    style_guide: dict               # Visual Director output
    scenes: list[dict]              # Accumulated scene history
    current_scene: dict             # Latest Storyteller output
    choice_history: list[dict]      # All user choices
    image_urls: dict                # All generated image URLs
    agent_status: str               # Current agent being executed
    is_ended: bool                  # Whether the story has concluded
```

### Parallel Execution

- **Character Designer + World Builder** run concurrently at story setup
- **Portrait Artist + Environment Artist + Scene Composer** run concurrently for image generation
- All other nodes run sequentially

### Conditional Edges

- After **Judge**: if `REVISE` → route back to the originating agent; if `REJECT` → route to Orchestrator for fallback; if `APPROVE` → continue
- After **Visual Continuity Checker**: if `REGENERATE` → route back to the rendering agent; if `APPROVE` → continue
- After **Storyteller**: if `is_ending` → route to story end; else → route to Visual Director for scene illustration

## 5. Full Orchestration Flow

### Story Setup (first run)

1. User submits idea → Orchestrator parses intent
2. Character Designer + World Builder run in parallel
3. Judge validates both outputs
4. Visual Director creates style guide + initial image prompts
5. Portrait Artist + Environment Artist run in parallel
6. Visual Continuity Checker reviews images
7. Storyteller writes opening scene
8. Scene Composer renders scene illustration
9. Judge validates scene
10. Everything streams to user via WebSocket

### Scene Loop (subsequent scenes)

1. User makes a choice → Orchestrator updates state
2. Storyteller writes next scene based on choice
3. Judge validates scene
4. Visual Director writes scene image prompt
5. Scene Composer renders illustration
6. Visual Continuity Checker reviews
7. Scene + image stream to user
8. Repeat until `is_ending = true`

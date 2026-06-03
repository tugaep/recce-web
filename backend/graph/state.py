"""State schema for the interactive storytelling LangGraph."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from typing_extensions import NotRequired, TypedDict

__all__ = [
    "Character",
    "WorldInfo",
    "Scene",
    "Choice",
    "StoryOutline",
    "NarrativeState",
]


@dataclass
class Character:
    """A character in the narrative."""

    name: str  # Display name of the character
    description: str  # Physical appearance and role summary
    personality: str  # Traits, motivations, and speech style
    backstory: str  # History and context before the story begins


@dataclass
class WorldInfo:
    """Setting details for the story world."""

    location_name: str  # Primary place name
    atmosphere: str  # Mood and tone of the environment
    time_period: str  # Era or timeframe
    description: str  # Broader world-building details


@dataclass
class Scene:
    """A single narrative scene."""

    scene_text: str  # Prose content shown to the user
    location: str  # Where the scene takes place
    status: str  # Lifecycle state (e.g. active, completed)


@dataclass
class Choice:
    """A branching option offered to the user."""

    choice_text: str  # Label shown for the option
    consequence: str  # Narrative effect if selected


class StoryOutline(TypedDict):
    """High-level story plan produced by the orchestrator."""

    genre: str  # Story genre (e.g. fantasy, mystery)
    tone: str  # Narrative tone (e.g. dark, whimsical)
    setting: str  # Time and place summary
    conflict: str  # Central conflict driving the plot


class NarrativeState(TypedDict):
    """Shared graph state passed between storytelling nodes."""

    user_idea: str  # Initial story prompt from the user
    story_outline: NotRequired[StoryOutline]  # Genre, tone, setting, conflict from orchestrator
    characters: List[Character]  # Cast used by storyteller and downstream nodes
    characters_from_designer: NotRequired[
        Optional[List[Character]]
    ]  # Staging field filled by character_designer before merge_node
    world: Optional[WorldInfo]  # Built setting; None until world_builder runs
    current_scene: Optional[Scene]  # Active scene; None before the first scene
    choices: List[Choice]  # Options offered for the current scene
    scene_history: List[Scene]  # Prior scenes in chronological order
    user_choice: str  # Latest selection made by the user
    is_valid: bool  # Whether the last validation step passed
    error_message: str  # Details when is_valid is False
    session_id: str  # Unique identifier for persistence and tracing
    storyteller_retry_count: NotRequired[int]  # Judge retries; max 1 re-run of storyteller
    scene_count: NotRequired[int]  # Number of scenes played so far (default 0)
    is_final: NotRequired[bool]  # Whether the next scene should be a conclusive ending
    story_summary: NotRequired[str]  # 2-3 sentence summary of the whole story (set on final scene)

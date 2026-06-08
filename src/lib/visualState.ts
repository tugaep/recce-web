import type { ImageReadyPayload } from "@/hooks/useWebSocket";

/**
 * Image URLs streamed from the backend's visual agents for the current story.
 *
 * `null` means "still rendering" (show a skeleton); a string is a ready URL.
 * `failed` tracks targets whose render errored so the UI can stop the skeleton
 * without a URL.
 */
export interface VisualState {
  world: string | null;
  scene: string | null;
  /** Character portraits keyed by their index in the cast. */
  characters: Record<number, string>;
  /** Targets that failed to render, e.g. "world", "scene", "character:0". */
  failed: Record<string, true>;
}

export const emptyVisualState: VisualState = {
  world: null,
  scene: null,
  characters: {},
  failed: {},
};

function failKey(target: string, index: number | null): string {
  return index == null ? target : `${target}:${index}`;
}

/**
 * Apply one `image_ready` message to the visual state, returning the next state.
 *
 * Pure and side-effect free so it can be unit-tested in isolation from the
 * component and the WebSocket transport.
 */
export function applyImageReady(state: VisualState, payload: ImageReadyPayload): VisualState {
  const { target, index, url } = payload;

  // A failed render (no URL): record it so the UI can stop the skeleton.
  if (!url) {
    return { ...state, failed: { ...state.failed, [failKey(target, index)]: true } };
  }

  switch (target) {
    case "world":
      return { ...state, world: url };
    case "scene":
      return { ...state, scene: url };
    case "character":
      if (index == null) return state;
      return { ...state, characters: { ...state.characters, [index]: url } };
    default:
      return state;
  }
}

/** Clear only the scene image (new scene begins rendering on each choice). */
export function resetScene(state: VisualState): VisualState {
  const { ["scene"]: _removed, ...failed } = state.failed;
  return { ...state, scene: null, failed };
}

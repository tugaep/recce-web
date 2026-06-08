import { describe, expect, it } from "vitest";
import { applyImageReady, emptyVisualState, resetScene } from "./visualState";
import type { ImageReadyPayload } from "@/hooks/useWebSocket";

function msg(overrides: Partial<ImageReadyPayload>): ImageReadyPayload {
  return { session_id: "s1", target: "world", index: null, url: null, ...overrides };
}

describe("applyImageReady", () => {
  it("sets the world image", () => {
    const next = applyImageReady(emptyVisualState, msg({ target: "world", url: "w.png" }));
    expect(next.world).toBe("w.png");
  });

  it("sets the scene image", () => {
    const next = applyImageReady(emptyVisualState, msg({ target: "scene", url: "sc.png" }));
    expect(next.scene).toBe("sc.png");
  });

  it("routes character images by index", () => {
    let state = applyImageReady(emptyVisualState, msg({ target: "character", index: 0, url: "a.png" }));
    state = applyImageReady(state, msg({ target: "character", index: 2, url: "c.png" }));
    expect(state.characters).toEqual({ 0: "a.png", 2: "c.png" });
  });

  it("ignores character messages with a null index", () => {
    const next = applyImageReady(emptyVisualState, msg({ target: "character", index: null, url: "x.png" }));
    expect(next.characters).toEqual({});
  });

  it("records failures (null url) without setting an image", () => {
    const next = applyImageReady(
      emptyVisualState,
      msg({ target: "world", url: null, error: "boom" }),
    );
    expect(next.world).toBeNull();
    expect(next.failed["world"]).toBe(true);
  });

  it("keys character failures by index", () => {
    const next = applyImageReady(emptyVisualState, msg({ target: "character", index: 1, url: null }));
    expect(next.failed["character:1"]).toBe(true);
  });

  it("does not mutate the input state", () => {
    const before = emptyVisualState;
    applyImageReady(before, msg({ target: "world", url: "w.png" }));
    expect(before.world).toBeNull();
  });
});

describe("resetScene", () => {
  it("clears the scene image and its failure flag, keeping cast and world", () => {
    let state = applyImageReady(emptyVisualState, msg({ target: "world", url: "w.png" }));
    state = applyImageReady(state, msg({ target: "character", index: 0, url: "a.png" }));
    state = applyImageReady(state, msg({ target: "scene", url: "sc.png" }));
    state = applyImageReady(state, msg({ target: "scene", url: null }));

    const next = resetScene(state);
    expect(next.scene).toBeNull();
    expect(next.failed["scene"]).toBeUndefined();
    expect(next.world).toBe("w.png");
    expect(next.characters).toEqual({ 0: "a.png" });
  });
});

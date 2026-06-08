import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreamingText } from "./StreamingText";

// With reduced motion (mocked in vitest.setup.ts), StreamingText renders the full
// text synchronously rather than animating character-by-character.
describe("StreamingText", () => {
  it("renders the full text immediately under reduced motion", () => {
    render(<StreamingText text="The lighthouse stood alone." />);
    expect(screen.getByText("The lighthouse stood alone.")).toBeInTheDocument();
  });
});

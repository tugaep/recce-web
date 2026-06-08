import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoryImage } from "./StoryImage";

describe("StoryImage", () => {
  it("shows a generating skeleton while no url is ready", () => {
    render(<StoryImage url={null} alt="The world" aspectClass="aspect-[16/9]" />);
    // Skeleton exposes a busy role-img with a "generating" label, no <img> yet.
    expect(screen.getByLabelText("The world — generating")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "The world" })).not.toBeInTheDocument();
  });

  it("renders the generated image once a url arrives", () => {
    render(<StoryImage url="https://cdn/world.png" alt="The world" aspectClass="aspect-[16/9]" />);
    const img = screen.getByRole("img", { name: "The world" });
    expect(img).toHaveAttribute("src", "https://cdn/world.png");
  });

  it("falls back to the offline asset when the render failed", () => {
    render(
      <StoryImage
        url={null}
        failed
        fallback="/mock/world.jpg"
        alt="The world"
        aspectClass="aspect-[16/9]"
      />,
    );
    expect(screen.getByRole("img", { name: "The world" })).toHaveAttribute(
      "src",
      "/mock/world.jpg",
    );
  });

  it("keeps the skeleton on failure when no fallback is provided", () => {
    render(<StoryImage url={null} failed alt="Portrait" aspectClass="aspect-[4/5]" />);
    expect(screen.getByLabelText("Portrait — generating")).toBeInTheDocument();
  });
});

// ABOUTME: Unit tests for the Card component — face-up/face-down rendering and suit color classes.
// ABOUTME: Uses @testing-library/react with happy-dom environment.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders rank and suit glyph when face-up", () => {
    const { container } = render(<Card suit="spades" rank="A" faceDown={false} />);
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("♠");
  });

  it("applies suit-black class for spades", () => {
    const { container } = render(<Card suit="spades" rank="K" faceDown={false} />);
    const front = container.querySelector(".card-front");
    expect(front?.classList.contains("suit-black")).toBe(true);
  });

  it("applies suit-black class for clubs", () => {
    const { container } = render(<Card suit="clubs" rank="5" faceDown={false} />);
    const front = container.querySelector(".card-front");
    expect(front?.classList.contains("suit-black")).toBe(true);
  });

  it("applies suit-red class for hearts", () => {
    const { container } = render(<Card suit="hearts" rank="Q" faceDown={false} />);
    const front = container.querySelector(".card-front");
    expect(front?.classList.contains("suit-red")).toBe(true);
  });

  it("applies suit-red class for diamonds", () => {
    const { container } = render(<Card suit="diamonds" rank="10" faceDown={false} />);
    const front = container.querySelector(".card-front");
    expect(front?.classList.contains("suit-red")).toBe(true);
  });

  it("adds is-face-down class when faceDown is true", () => {
    const { container } = render(<Card suit="hearts" rank="A" faceDown={true} />);
    const card = container.querySelector(".card");
    expect(card?.classList.contains("is-face-down")).toBe(true);
  });

  it("does not add is-face-down class when faceDown is false", () => {
    const { container } = render(<Card suit="hearts" rank="A" faceDown={false} />);
    const card = container.querySelector(".card");
    expect(card?.classList.contains("is-face-down")).toBe(false);
  });

  it("sets --deal-delay style when dealIndex is provided", () => {
    const { container } = render(<Card suit="spades" rank="2" faceDown={false} dealIndex={3} />);
    const card = container.querySelector(".card") as HTMLElement;
    expect(card?.style.getPropertyValue("--deal-delay")).toBe("360ms");
  });
});

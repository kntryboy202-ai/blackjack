// ABOUTME: Renders a single playing card with CSS 3D flip animation and Unicode suit glyphs.
// ABOUTME: faceDown drives the is-face-down class; dealIndex sets staggered --deal-delay.
import type { Rank, Suit } from "@blackjack/shared";
import "./card.css";

const SUIT_GLYPHS: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

const RED_SUITS: Suit[] = ["hearts", "diamonds"];

interface CardProps {
  suit: Suit;
  rank: Rank;
  faceDown: boolean;
  dealIndex?: number;
}

export function Card({ suit, rank, faceDown, dealIndex }: CardProps) {
  const glyph = SUIT_GLYPHS[suit];
  const isRed = RED_SUITS.includes(suit);
  const delay = (dealIndex ?? 0) * 120;

  return (
    <div
      className={`card${faceDown ? " is-face-down" : ""}`}
      style={{ "--deal-delay": `${delay}ms` } as React.CSSProperties}
    >
      <div className="card-inner">
        <div className={`card-front ${isRed ? "suit-red" : "suit-black"}`}>
          <span className="card-corner card-corner--top">
            {rank}
            <br />
            {glyph}
          </span>
          <span className="card-center">{glyph}</span>
          <span className="card-corner card-corner--bottom">
            {rank}
            <br />
            {glyph}
          </span>
        </div>
        <div className="card-back" />
      </div>
    </div>
  );
}

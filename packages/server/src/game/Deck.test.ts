// ABOUTME: Tests for the Deck class covering construction, draw, shuffle, and remaining count.
// ABOUTME: Verifies multi-deck shoe sizes, valid card contents, and draw boundary behavior.

import type { Rank, Suit } from "@blackjack/shared";
import { describe, expect, it } from "vitest";
import { Deck } from "./Deck";

const VALID_SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const VALID_RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

describe("Deck", () => {
  it("new Deck(1) has 52 cards", () => {
    const deck = new Deck(1);
    expect(deck.remaining).toBe(52);
  });

  it("new Deck(6) has 312 cards", () => {
    const deck = new Deck(6);
    expect(deck.remaining).toBe(312);
  });

  it("new Deck(8) has 416 cards", () => {
    const deck = new Deck(8);
    expect(deck.remaining).toBe(416);
  });

  it("all cards have valid suit and rank", () => {
    const deck = new Deck(1);
    const count = deck.remaining;
    for (let i = 0; i < count; i++) {
      const card = deck.draw();
      expect(VALID_SUITS).toContain(card.suit);
      expect(VALID_RANKS).toContain(card.rank);
    }
  });

  it("no duplicate cards in a single-deck shoe", () => {
    const deck = new Deck(1);
    const seen = new Set<string>();
    for (let i = 0; i < 52; i++) {
      const card = deck.draw();
      const key = `${card.suit}-${card.rank}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(52);
  });

  it("draw() removes and returns a card, remaining decrements", () => {
    const deck = new Deck(1);
    expect(deck.remaining).toBe(52);
    const card = deck.draw();
    expect(card).toBeDefined();
    expect(card.suit).toBeDefined();
    expect(card.rank).toBeDefined();
    expect(deck.remaining).toBe(51);
  });

  it("draw() on an empty deck throws an error", () => {
    const deck = new Deck(1);
    for (let i = 0; i < 52; i++) {
      deck.draw();
    }
    expect(() => deck.draw()).toThrow();
  });

  it("after shuffle(), the order changes (two fresh decks have different order)", () => {
    // Draw 10 cards from each deck and compare — statistically they will differ
    const deck1 = new Deck(1);
    const deck2 = new Deck(1);
    deck2.shuffle();

    const draw10 = (d: Deck) => {
      const cards: string[] = [];
      for (let i = 0; i < 10; i++) {
        const c = d.draw();
        cards.push(`${c.suit}-${c.rank}`);
      }
      return cards;
    };

    const order1 = draw10(deck1);
    const order2 = draw10(deck2);
    // The probability both orders are identical is astronomically low
    expect(order1.join(",")).not.toBe(order2.join(","));
  });

  it("remaining starts at deckCount * 52", () => {
    expect(new Deck(1).remaining).toBe(1 * 52);
    expect(new Deck(4).remaining).toBe(4 * 52);
    expect(new Deck(6).remaining).toBe(6 * 52);
  });

  it("draw() with faceDown=true sets faceDown flag on the card", () => {
    const deck = new Deck(1);
    const card = deck.draw(true);
    expect(card.faceDown).toBe(true);
  });

  it("draw() without faceDown argument defaults to faceDown=false", () => {
    const deck = new Deck(1);
    const card = deck.draw();
    expect(card.faceDown).toBe(false);
  });
});

// ABOUTME: Shoe builder and card draw logic for configurable multi-deck blackjack.
// ABOUTME: Shuffle uses Fisher-Yates; deck count is set at construction time.

import type { Card, Rank, Suit } from "@blackjack/shared";

const SUITS: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export class Deck {
  private cards: Card[];

  constructor(deckCount: number = 6) {
    this.cards = [];
    for (let d = 0; d < deckCount; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          this.cards.push({ suit, rank, faceDown: false });
        }
      }
    }
    this.shuffle();
  }

  shuffle(): void {
    const arr = this.cards;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      // i and j are always valid indices within the loop bounds
      const tmp = arr[i] as Card;
      arr[i] = arr[j] as Card;
      arr[j] = tmp;
    }
  }

  draw(faceDown: boolean = false): Card {
    if (this.cards.length === 0) {
      throw new Error("Deck is empty — cannot draw a card.");
    }
    // Length check above guarantees pop() returns a Card
    const card = this.cards.pop() as Card;
    return { ...card, faceDown };
  }

  get remaining(): number {
    return this.cards.length;
  }
}

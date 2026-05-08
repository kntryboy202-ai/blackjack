// ABOUTME: Hand value calculation with soft/hard ace logic and bust detection.
// ABOUTME: Blackjack is only valid on the initial 2-card deal where value equals 21.

import type { Card } from "@blackjack/shared";

export interface HandResult {
  value: number;
  isSoft: boolean;
  isBusted: boolean;
  isBlackjack: boolean;
}

function rankValue(rank: Card["rank"]): number {
  if (rank === "A") return 11;
  if (rank === "J" || rank === "Q" || rank === "K") return 10;
  return parseInt(rank, 10);
}

export function calculateHand(cards: Card[]): HandResult {
  const visibleCards = cards.filter((c) => !c.faceDown);

  if (visibleCards.length === 0) {
    return { value: 0, isSoft: false, isBusted: false, isBlackjack: false };
  }

  let value = 0;
  let aceCount = 0;

  for (const card of visibleCards) {
    value += rankValue(card.rank);
    if (card.rank === "A") aceCount++;
  }

  // Reduce aces from 11 to 1 (i.e. subtract 10) as needed to avoid bust
  while (value > 21 && aceCount > 0) {
    value -= 10;
    aceCount--;
  }

  // isSoft: at least one ace still counted as 11
  const isSoft = aceCount > 0;
  const isBusted = value > 21;
  // Blackjack: exactly 2 visible cards, value 21, and at least one is an ace (isSoft guarantees that)
  const isBlackjack = visibleCards.length === 2 && value === 21 && isSoft;

  return { value, isSoft, isBusted, isBlackjack };
}

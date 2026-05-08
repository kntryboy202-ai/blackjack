// ABOUTME: House rules engine — dealer hit logic, hand outcome resolution, and chip payouts.
// ABOUTME: All chip math uses integer arithmetic; blackjack pays 3:2 via Math.floor.

import type { HandOutcome } from "@blackjack/shared";
import type { HandResult } from "./Hand";

export function dealerShouldHit(hand: { value: number; isSoft: boolean }): boolean {
  return hand.value < 17;
}

export function resolveHand(player: HandResult, dealer: HandResult): HandOutcome {
  // Both blackjack → push
  if (player.isBlackjack && dealer.isBlackjack) {
    return "push";
  }

  // Player blackjack, dealer not → blackjack payout
  if (player.isBlackjack) {
    return "blackjack";
  }

  // Player busted → loss regardless of dealer
  if (player.isBusted) {
    return "loss";
  }

  // Dealer busted, player not → win
  if (dealer.isBusted) {
    return "win";
  }

  // Neither busted, compare values
  if (player.value > dealer.value) {
    return "win";
  }

  if (player.value < dealer.value) {
    return "loss";
  }

  return "push";
}

export function chipDelta(outcome: HandOutcome, betAmount: number): number {
  switch (outcome) {
    case "blackjack":
      return Math.floor(betAmount * 1.5);
    case "win":
      return betAmount;
    case "loss":
      return -betAmount;
    case "push":
      return 0;
    case "surrender":
      return -Math.floor(betAmount / 2);
  }
}

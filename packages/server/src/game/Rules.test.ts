// ABOUTME: Tests for house rules — dealer hit logic, hand outcome resolution, and chip payout math.
// ABOUTME: Covers all HandOutcome variants and verifies integer-only chip deltas.

import type { HandOutcome } from "@blackjack/shared";
import { describe, expect, it } from "vitest";
import type { HandResult } from "./Hand";
import { chipDelta, dealerShouldHit, resolveHand } from "./Rules";

function result(value: number, isSoft: boolean, isBusted = false, isBlackjack = false): HandResult {
  return { value, isSoft, isBusted, isBlackjack };
}

describe("dealerShouldHit", () => {
  it("hits on hard 16", () => {
    expect(dealerShouldHit({ value: 16, isSoft: false })).toBe(true);
  });

  it("hits on soft 16", () => {
    expect(dealerShouldHit({ value: 16, isSoft: true })).toBe(true);
  });

  it("stands on hard 17", () => {
    expect(dealerShouldHit({ value: 17, isSoft: false })).toBe(false);
  });

  it("stands on soft 17", () => {
    expect(dealerShouldHit({ value: 17, isSoft: true })).toBe(false);
  });

  it("hits on soft 15", () => {
    expect(dealerShouldHit({ value: 15, isSoft: true })).toBe(true);
  });

  it("stands on soft 18", () => {
    expect(dealerShouldHit({ value: 18, isSoft: true })).toBe(false);
  });
});

describe("resolveHand", () => {
  it("player blackjack, dealer not → 'blackjack'", () => {
    const player = result(21, true, false, true);
    const dealer = result(20, false, false, false);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("blackjack");
  });

  it("both blackjack → 'push'", () => {
    const player = result(21, true, false, true);
    const dealer = result(21, true, false, true);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("push");
  });

  it("player busted → 'loss' regardless of dealer", () => {
    const player = result(25, false, true, false);
    const dealer = result(22, false, true, false);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("loss");
  });

  it("dealer busted, player not → 'win'", () => {
    const player = result(18, false, false, false);
    const dealer = result(23, false, true, false);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("win");
  });

  it("player value > dealer value → 'win'", () => {
    const player = result(19, false, false, false);
    const dealer = result(17, false, false, false);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("win");
  });

  it("player value < dealer value → 'loss'", () => {
    const player = result(15, false, false, false);
    const dealer = result(19, false, false, false);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("loss");
  });

  it("equal values, neither blackjack → 'push'", () => {
    const player = result(18, false, false, false);
    const dealer = result(18, false, false, false);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("push");
  });

  it("player blackjack, dealer blackjack → 'push' (not 'blackjack')", () => {
    const player = result(21, true, false, true);
    const dealer = result(21, true, false, true);
    expect(resolveHand(player, dealer)).toBe<HandOutcome>("push");
  });
});

describe("chipDelta", () => {
  it("'blackjack' with bet 100 → 150 (3:2 payout)", () => {
    expect(chipDelta("blackjack", 100)).toBe(150);
  });

  it("'blackjack' with bet 10 → 15", () => {
    expect(chipDelta("blackjack", 10)).toBe(15);
  });

  it("'win' with bet 100 → 100", () => {
    expect(chipDelta("win", 100)).toBe(100);
  });

  it("'loss' with bet 100 → -100", () => {
    expect(chipDelta("loss", 100)).toBe(-100);
  });

  it("'push' with bet 100 → 0", () => {
    expect(chipDelta("push", 100)).toBe(0);
  });

  it("'surrender' with bet 100 → -50", () => {
    expect(chipDelta("surrender", 100)).toBe(-50);
  });

  it("'surrender' with bet 11 → -5 (Math.floor(11/2) = 5, negated)", () => {
    expect(chipDelta("surrender", 11)).toBe(-5);
  });

  it("all chip math produces integers only", () => {
    const outcomes: HandOutcome[] = ["blackjack", "win", "loss", "push", "surrender"];
    const bets = [1, 3, 7, 10, 11, 15, 99, 100, 101];
    for (const outcome of outcomes) {
      for (const bet of bets) {
        const delta = chipDelta(outcome, bet);
        expect(Number.isInteger(delta)).toBe(true);
      }
    }
  });
});

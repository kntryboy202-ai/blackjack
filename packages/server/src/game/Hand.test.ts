// ABOUTME: Tests for calculateHand() covering soft/hard ace logic, bust detection, and blackjack identification.
// ABOUTME: Also verifies face-down cards are excluded from hand value calculations.

import type { Card } from "@blackjack/shared";
import { describe, expect, it } from "vitest";
import { calculateHand } from "./Hand";

function card(rank: Card["rank"], suit: Card["suit"], faceDown: boolean = false): Card {
  return { rank, suit, faceDown };
}

describe("calculateHand", () => {
  it("empty hand returns value 0, not busted, not blackjack, not soft", () => {
    expect(calculateHand([])).toEqual({
      value: 0,
      isSoft: false,
      isBusted: false,
      isBlackjack: false,
    });
  });

  it("[2♥, 3♣] → value 5, not busted, not blackjack", () => {
    const result = calculateHand([card("2", "hearts"), card("3", "clubs")]);
    expect(result.value).toBe(5);
    expect(result.isBusted).toBe(false);
    expect(result.isBlackjack).toBe(false);
  });

  it("[K♠, Q♦] → value 20, hard hand", () => {
    const result = calculateHand([card("K", "spades"), card("Q", "diamonds")]);
    expect(result.value).toBe(20);
    expect(result.isSoft).toBe(false);
  });

  it("[A♥, K♠] → value 21, isSoft true, isBlackjack true (2-card 21)", () => {
    const result = calculateHand([card("A", "hearts"), card("K", "spades")]);
    expect(result.value).toBe(21);
    expect(result.isSoft).toBe(true);
    expect(result.isBlackjack).toBe(true);
  });

  it("[A♥, 5♣] → value 16, isSoft true (ace counts as 11)", () => {
    const result = calculateHand([card("A", "hearts"), card("5", "clubs")]);
    expect(result.value).toBe(16);
    expect(result.isSoft).toBe(true);
  });

  it("[A♥, 5♣, 10♦] → value 16, isSoft false (ace drops to 1 to avoid bust)", () => {
    const result = calculateHand([card("A", "hearts"), card("5", "clubs"), card("10", "diamonds")]);
    expect(result.value).toBe(16);
    expect(result.isSoft).toBe(false);
  });

  it("[A♥, A♣] → value 12, isSoft true (one ace=11, one ace=1)", () => {
    const result = calculateHand([card("A", "hearts"), card("A", "clubs")]);
    expect(result.value).toBe(12);
    expect(result.isSoft).toBe(true);
  });

  it("[A♥, A♣, 9♦] → value 21, isSoft true (A=11, A=1, 9=9)", () => {
    const result = calculateHand([card("A", "hearts"), card("A", "clubs"), card("9", "diamonds")]);
    expect(result.value).toBe(21);
    expect(result.isSoft).toBe(true);
  });

  it("[10♠, 10♦, 5♥] → value 25, isBusted true", () => {
    const result = calculateHand([
      card("10", "spades"),
      card("10", "diamonds"),
      card("5", "hearts"),
    ]);
    expect(result.value).toBe(25);
    expect(result.isBusted).toBe(true);
  });

  it("[A♥, K♠, 3♦] → value 14, isSoft false, isBlackjack false (3 cards)", () => {
    const result = calculateHand([card("A", "hearts"), card("K", "spades"), card("3", "diamonds")]);
    expect(result.value).toBe(14);
    expect(result.isSoft).toBe(false);
    expect(result.isBlackjack).toBe(false);
  });

  it("[7♥, 7♣, 7♦] → value 21, isBlackjack false (3 cards, not 2-card 21)", () => {
    const result = calculateHand([card("7", "hearts"), card("7", "clubs"), card("7", "diamonds")]);
    expect(result.value).toBe(21);
    expect(result.isBlackjack).toBe(false);
  });

  it("face-down cards are excluded from value calculation", () => {
    // Visible: A♥ + K♠ = 21, but there's a face-down 10 that should be ignored
    const result = calculateHand([
      card("A", "hearts"),
      card("K", "spades"),
      card("10", "clubs", true), // face-down, should be excluded
    ]);
    // With face-down card excluded: A + K = 21, isSoft true, isBlackjack true (only 2 visible)
    expect(result.value).toBe(21);
    expect(result.isSoft).toBe(true);
    expect(result.isBlackjack).toBe(true);
  });
});

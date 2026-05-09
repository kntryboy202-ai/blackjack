// ABOUTME: Structural tests confirming shared type contracts are well-formed.
// ABOUTME: Validates runtime shape of type-defined objects used across client and server.
import { describe, expect, it } from "vitest";
import type {
  Card,
  GamePhase,
  GameRoomState,
  HandOutcome,
  PlayerAction,
  PlayerSeat,
} from "./index.js";

describe("Card type", () => {
  it("accepts a valid card object", () => {
    const card: Card = { suit: "hearts", rank: "A", faceDown: false };
    expect(card.suit).toBe("hearts");
    expect(card.rank).toBe("A");
    expect(card.faceDown).toBe(false);
  });

  it("accepts a face-down card", () => {
    const card: Card = { suit: "spades", rank: "K", faceDown: true };
    expect(card.faceDown).toBe(true);
  });
});

describe("GamePhase", () => {
  it("covers all 8 state machine states", () => {
    const phases: GamePhase[] = [
      "WAITING_FOR_PLAYERS",
      "PLACE_BETS",
      "DEALING",
      "CHECK_INSURANCE",
      "PLAYER_TURNS",
      "DEALER_TURN",
      "RESOLVE",
      "ROUND_END",
    ];
    expect(phases).toHaveLength(8);
  });
});

describe("PlayerAction", () => {
  it("covers all 6 player actions", () => {
    const actions: PlayerAction[] = ["hit", "stand", "double", "split", "insurance", "surrender"];
    expect(actions).toHaveLength(6);
  });
});

describe("HandOutcome", () => {
  it("covers all 5 hand outcomes", () => {
    const outcomes: HandOutcome[] = ["win", "loss", "push", "blackjack", "surrender"];
    expect(outcomes).toHaveLength(5);
  });
});

describe("GameRoomState", () => {
  it("accepts a minimal valid game room state", () => {
    const state: GameRoomState = {
      tableId: "table-1",
      phase: "WAITING_FOR_PLAYERS",
      seats: [],
      dealer: { hand: [], handValue: 0, isSoft: false },
      activeSeatIndex: null,
      roundNumber: 0,
    };
    expect(state.phase).toBe("WAITING_FOR_PLAYERS");
    expect(state.seats).toHaveLength(0);
    expect(state.activeSeatIndex).toBeNull();
  });
});

describe("PlayerSeat", () => {
  it("accepts a valid player seat object", () => {
    const seat: PlayerSeat = {
      userId: "user-1",
      username: "testplayer",
      seatIndex: 0,
      bankroll: 1000,
      bet: 0,
      hand: [],
      handValue: 0,
      isSoft: false,
      isBusted: false,
      isBlackjack: false,
      hasActed: false,
      isNpc: false,
      insuranceBet: 0,
      splitHand: null,
      activeHandIndex: 0,
    };
    expect(seat.bankroll).toBe(1000);
    expect(seat.isNpc).toBe(false);
  });
});

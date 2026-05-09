// ABOUTME: Tests for the GameRoom state machine covering all game phase transitions.
// ABOUTME: GameRoom is tested in isolation without Socket.io using a state-change callback.

import type { Card, GameRoomState } from "@blackjack/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Deck } from "./Deck.js";
import { GameRoom } from "./GameRoom.js";

// Helper to build a deterministic deck by directly pre-loading cards (bypasses random shuffle)
function buildDeckWithCards(cards: Card[]): Deck {
  const deck = new Deck(0); // empty deck
  // Deck pops from the end, so last card in array is drawn first
  // We use the internal cards property via prototype trick to inject cards
  (deck as unknown as { cards: Card[] }).cards = [...cards].reverse();
  return deck;
}

function makeRoom(config?: { deckCount?: number; minBet?: number; maxBet?: number }): GameRoom {
  return new GameRoom("table-1", {
    deckCount: config?.deckCount ?? 1,
    minBet: config?.minBet ?? 1,
    maxBet: config?.maxBet ?? 500,
  });
}

// Called after placeBet when using a random deck — dealer may show an Ace and trigger insurance.
// Phase 1 has no insurance betting, so we skip it immediately.
function skipInsuranceIfNeeded(room: GameRoom): void {
  if (room.getSnapshot().phase === "CHECK_INSURANCE") {
    room.skipInsurance();
  }
}

describe("GameRoom — setup / waiting phase", () => {
  it("starts in WAITING_FOR_PLAYERS phase", () => {
    const room = makeRoom();
    expect(room.getSnapshot().phase).toBe("WAITING_FOR_PLAYERS");
  });

  it("addPlayer adds a seat visible in getSnapshot", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    const snap = room.getSnapshot();
    expect(snap.seats).toHaveLength(1);
    expect(snap.seats[0]?.userId).toBe("u1");
    expect(snap.seats[0]?.username).toBe("Alice");
    expect(snap.seats[0]?.bankroll).toBe(1000);
  });

  it("removePlayer removes the seat", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.addPlayer("u2", "Bob", 1000, "sock-2");
    room.removePlayer("u1");
    const snap = room.getSnapshot();
    expect(snap.seats).toHaveLength(1);
    expect(snap.seats[0]?.userId).toBe("u2");
  });

  it("startGame with 0 players throws", () => {
    const room = makeRoom();
    expect(() => room.startGame()).toThrow();
  });

  it("startGame with 1+ players transitions to PLACE_BETS", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    expect(room.getSnapshot().phase).toBe("PLACE_BETS");
  });

  it("addPlayer throws when table is full (6 players)", () => {
    const room = makeRoom();
    for (let i = 0; i < 6; i++) {
      room.addPlayer(`u${i}`, `Player${i}`, 1000, `sock-${i}`);
    }
    expect(() => room.addPlayer("u99", "Extra", 1000, "sock-99")).toThrow();
  });
});

describe("GameRoom — betting phase", () => {
  let room: GameRoom;

  beforeEach(() => {
    room = makeRoom({ minBet: 1, maxBet: 500 });
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
  });

  it("placeBet updates the seat bet", () => {
    room.placeBet("u1", 50);
    const seat = room.getSnapshot().seats[0];
    expect(seat?.bet).toBe(50);
  });

  it("placeBet deducts amount from bankroll (escrow)", () => {
    // Add a second player so placing one bet doesn't auto-trigger the deal
    room.addPlayer("u2", "Bob", 1000, "sock-2");
    room.placeBet("u1", 50);
    const seat = room.getSnapshot().seats[0];
    expect(seat?.bankroll).toBe(950);
  });

  it("placeBet rejects amount below minBet (0)", () => {
    expect(() => room.placeBet("u1", 0)).toThrow();
  });

  it("placeBet rejects amount above maxBet (600 > 500)", () => {
    expect(() => room.placeBet("u1", 600)).toThrow();
  });

  it("placeBet rejects amount above bankroll (2000 > 1000)", () => {
    expect(() => room.placeBet("u1", 2000)).toThrow();
  });

  it("after all players place bets, phase transitions to DEALING then PLAYER_TURNS", () => {
    room.placeBet("u1", 50);
    // Phase should have advanced past DEALING into PLAYER_TURNS (dealing is instantaneous)
    const phase = room.getSnapshot().phase;
    expect(["DEALING", "PLAYER_TURNS", "CHECK_INSURANCE"]).toContain(phase);
  });

  it("placeBet in wrong phase throws", () => {
    // Re-use fresh room still in WAITING_FOR_PLAYERS
    const r2 = makeRoom();
    r2.addPlayer("u1", "Alice", 1000, "sock-1");
    // Don't call startGame — still WAITING_FOR_PLAYERS
    expect(() => r2.placeBet("u1", 50)).toThrow();
  });
});

describe("GameRoom — dealing phase", () => {
  it("after all bets placed, each human seat has exactly 2 cards", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    const snap = room.getSnapshot();
    expect(snap.seats[0]?.hand).toHaveLength(2);
  });

  it("dealer has exactly 2 cards after dealing", () => {
    // Fixed deck: player 8+6=14 (no BJ), dealer 7(up)+5(hole) — safe, no BJ, no auto-advance
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "diamonds", rank: "7", faceDown: false },
      { suit: "hearts", rank: "6", faceDown: false },
      { suit: "clubs", rank: "5", faceDown: false },
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    const snap = room.getSnapshot();
    expect(snap.dealer.hand).toHaveLength(2);
  });

  it("dealer's second card (index 1) is faceDown after dealing", () => {
    // Fixed deck: player 8+6=14 (no BJ), dealer 7(up)+5(hole) — safe, no auto-advance
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "diamonds", rank: "7", faceDown: false },
      { suit: "hearts", rank: "6", faceDown: false },
      { suit: "clubs", rank: "5", faceDown: false },
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    const snap = room.getSnapshot();
    expect(snap.dealer.hand[1]?.faceDown).toBe(true);
  });

  it("after dealing with non-Ace dealer upcard, phase is PLAYER_TURNS", () => {
    // buildDeckWithCards stores cards reversed so cards[0] is drawn FIRST (pop from end of reversed)
    // Deal order: player-1st, dealer-upcard, player-2nd, dealer-hole
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // cards[0] → drawn 1st → player 1st card
      { suit: "diamonds", rank: "7", faceDown: false }, // cards[1] → drawn 2nd → dealer upcard (not Ace)
      { suit: "hearts", rank: "9", faceDown: false }, // cards[2] → drawn 3rd → player 2nd card
      { suit: "clubs", rank: "5", faceDown: false }, // cards[3] → drawn 4th → dealer hole
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    expect(room.getSnapshot().phase).toBe("PLAYER_TURNS");
  });

  it("after dealing with Ace dealer upcard, phase is CHECK_INSURANCE", () => {
    // cards[0] → drawn 1st → player 1st card
    // cards[1] → drawn 2nd → dealer upcard (Ace!)
    // cards[2] → drawn 3rd → player 2nd card
    // cards[3] → drawn 4th → dealer hole
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // player 1st
      { suit: "diamonds", rank: "A", faceDown: false }, // dealer upcard — ACE
      { suit: "hearts", rank: "9", faceDown: false }, // player 2nd
      { suit: "clubs", rank: "5", faceDown: false }, // dealer hole
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    expect(room.getSnapshot().phase).toBe("CHECK_INSURANCE");
  });
});

describe("GameRoom — player turns", () => {
  let room: GameRoom;

  beforeEach(() => {
    // cards[0] drawn 1st, cards[1] drawn 2nd, etc.
    // Deal: p1-1st, dealer-up, p1-2nd, dealer-hole
    // Player: 8+6=14, Dealer: 7(up)+5(hole)=12 → dealer will hit
    // We need extra cards for player hits AND dealer hits (dealer draws until ≥17)
    // Dealer: 12 → draws 6 → 18, stops. So dealer needs 1 extra card.
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // [0] player 1st card
      { suit: "diamonds", rank: "7", faceDown: false }, // [1] dealer upcard (not Ace)
      { suit: "hearts", rank: "6", faceDown: false }, // [2] player 2nd card
      { suit: "clubs", rank: "5", faceDown: false }, // [3] dealer hole
      // Extra cards for player hits (drawn 5th onward)
      { suit: "clubs", rank: "2", faceDown: false }, // player hit card
      { suit: "diamonds", rank: "3", faceDown: false }, // player hit card
      // Extra cards for dealer draw (drawn after player done)
      { suit: "hearts", rank: "6", faceDown: false }, // dealer draws 12→18
    ];
    room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    // Should now be in PLAYER_TURNS (dealer upcard 7, not Ace)
  });

  it("hit adds a card to the active player's hand", () => {
    const before = room.getSnapshot().seats[0]?.hand.length ?? 0;
    room.playerAction("u1", "hit");
    const after = room.getSnapshot().seats[0]?.hand.length ?? 0;
    expect(after).toBe(before + 1);
  });

  it("stand advances past dealer turn to RESOLVE (dealer runs synchronously)", () => {
    room.playerAction("u1", "stand");
    const phase = room.getSnapshot().phase;
    // With only 1 player, standing triggers dealer turn which runs synchronously → RESOLVE
    expect(["DEALER_TURN", "RESOLVE"]).toContain(phase);
  });

  it("playerAction throws when it's not this player's turn", () => {
    room.addPlayer("u2", "Bob", 1000, "sock-2");
    // u1 is currently active (seat index 0)
    expect(() => room.playerAction("u2", "hit")).toThrow();
  });

  it("after all players stand/bust, dealer runs and phase advances past DEALER_TURN", () => {
    room.playerAction("u1", "stand");
    // Dealer runs synchronously, so final snapshot is RESOLVE or ROUND_END
    expect(["DEALER_TURN", "RESOLVE"]).toContain(room.getSnapshot().phase);
  });

  it("active seat index points to current player", () => {
    const snap = room.getSnapshot();
    expect(snap.activeSeatIndex).toBe(0);
  });
});

describe("GameRoom — dealer turn", () => {
  function setupRoomAtDealerTurn(): GameRoom {
    // cards[0] drawn 1st (player 1st), cards[1] drawn 2nd (dealer up), etc.
    // Player: 8+6=14, Dealer up: 7, Dealer hole: 5 → dealer=12 → draws K → 22 (bust)
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // [0] player 1st card
      { suit: "diamonds", rank: "7", faceDown: false }, // [1] dealer upcard (not Ace)
      { suit: "hearts", rank: "6", faceDown: false }, // [2] player 2nd card
      { suit: "clubs", rank: "5", faceDown: false }, // [3] dealer hole
      { suit: "clubs", rank: "K", faceDown: false }, // [4] dealer draws → 12+K=22 (bust)
    ];
    const r = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (r as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    r.addPlayer("u1", "Alice", 1000, "sock-1");
    r.startGame();
    r.placeBet("u1", 50);
    r.playerAction("u1", "stand");
    return r;
  }

  it("dealer's hole card is revealed (faceDown=false) during DEALER_TURN", () => {
    const room = setupRoomAtDealerTurn();
    // After dealer turn (which is run immediately), both dealer cards should be face up
    // but we need to check that dealer turn ran — phase should be RESOLVE
    const snap = room.getSnapshot();
    // Dealer cards should all be face up after resolution
    for (const card of snap.dealer.hand) {
      expect(card.faceDown).toBe(false);
    }
  });

  it("after dealer turn, phase transitions to RESOLVE", () => {
    const room = setupRoomAtDealerTurn();
    expect(room.getSnapshot().phase).toBe("RESOLVE");
  });
});

describe("GameRoom — resolution", () => {
  it("outcomes are set and bankrolls updated after resolve", () => {
    // Player: 8+6=14, Dealer: 7(up)+5(hole)=12 → draws K → busts, player wins
    // cards[0] drawn 1st (player 1st), cards[1] 2nd (dealer up), cards[2] 3rd (player 2nd), cards[3] 4th (dealer hole)
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // [0] player 1st
      { suit: "diamonds", rank: "7", faceDown: false }, // [1] dealer upcard
      { suit: "hearts", rank: "6", faceDown: false }, // [2] player 2nd
      { suit: "clubs", rank: "5", faceDown: false }, // [3] dealer hole
      { suit: "clubs", rank: "K", faceDown: false }, // [4] dealer draws → busts
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    room.playerAction("u1", "stand");

    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    // Player won (dealer busted): bet was escrowed (bankroll=950), now add back 50*2=100
    // Final bankroll = 950 + 100 = 1050
    expect(snap.seats[0]?.bankroll).toBe(1050);
  });

  it("loss correctly leaves bankroll deducted", () => {
    // Player: 5+6=11, Dealer: 10(up)+K(hole)=20 → dealer stands, player loses
    // cards[0] 1st drawn (player 1st), cards[1] 2nd (dealer up), cards[2] 3rd (player 2nd), cards[3] 4th (dealer hole)
    const cards: Card[] = [
      { suit: "spades", rank: "5", faceDown: false }, // [0] player 1st
      { suit: "diamonds", rank: "10", faceDown: false }, // [1] dealer upcard (10, not Ace)
      { suit: "hearts", rank: "6", faceDown: false }, // [2] player 2nd
      { suit: "clubs", rank: "K", faceDown: false }, // [3] dealer hole → dealer=20, stands
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    room.playerAction("u1", "stand");

    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    // Player lost (11 vs 20): bet already deducted, no return
    // Final bankroll = 950 (bet was 50, already deducted, no return)
    expect(snap.seats[0]?.bankroll).toBe(950);
  });

  it("push returns original bet to bankroll", () => {
    // Player: 9+9=18, Dealer: 10(up)+8(hole)=18 → push
    // cards[0] 1st drawn (player 1st), cards[1] 2nd (dealer up), cards[2] 3rd (player 2nd), cards[3] 4th (dealer hole)
    const cards: Card[] = [
      { suit: "spades", rank: "9", faceDown: false }, // [0] player 1st
      { suit: "diamonds", rank: "10", faceDown: false }, // [1] dealer upcard (10, not Ace)
      { suit: "hearts", rank: "9", faceDown: false }, // [2] player 2nd → player=18
      { suit: "clubs", rank: "8", faceDown: false }, // [3] dealer hole → dealer=18, push
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    room.playerAction("u1", "stand");

    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    // Push: bet returned, bankroll = 950 + 50 = 1000
    expect(snap.seats[0]?.bankroll).toBe(1000);
  });

  it("after resolve, nextRound transitions to PLACE_BETS", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    skipInsuranceIfNeeded(room);
    // Guard: if Alice got a blackjack the phase may already be RESOLVE
    if (room.getSnapshot().phase === "PLAYER_TURNS") {
      room.playerAction("u1", "stand");
    }
    expect(room.getSnapshot().phase).toBe("RESOLVE");
    room.nextRound();
    expect(room.getSnapshot().phase).toBe("PLACE_BETS");
  });

  it("nextRound with no remaining players transitions to WAITING_FOR_PLAYERS", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    skipInsuranceIfNeeded(room);
    // Guard: dealer BJ (via insurance fast-path) may already be in RESOLVE
    if (room.getSnapshot().phase === "PLAYER_TURNS") {
      room.playerAction("u1", "stand");
    }
    room.removePlayer("u1");
    room.nextRound();
    expect(room.getSnapshot().phase).toBe("WAITING_FOR_PLAYERS");
  });

  it("nextRound increments roundNumber", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    skipInsuranceIfNeeded(room);
    // Guard: dealer BJ (via insurance fast-path) may already be in RESOLVE
    if (room.getSnapshot().phase === "PLAYER_TURNS") {
      room.playerAction("u1", "stand");
    }
    const beforeRound = room.getSnapshot().roundNumber;
    room.nextRound();
    expect(room.getSnapshot().roundNumber).toBe(beforeRound + 1);
  });
});

describe("GameRoom — getSnapshot serialization", () => {
  it("getSnapshot returns a plain JSON-serializable object", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    const snap = room.getSnapshot();
    expect(() => JSON.stringify(snap)).not.toThrow();
    // Round-trip should equal itself
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("getSnapshot includes tableId, phase, seats, dealer, activeSeatIndex, roundNumber", () => {
    const room = makeRoom();
    const snap = room.getSnapshot();
    expect(snap).toHaveProperty("tableId", "table-1");
    expect(snap).toHaveProperty("phase");
    expect(snap).toHaveProperty("seats");
    expect(snap).toHaveProperty("dealer");
    expect(snap).toHaveProperty("activeSeatIndex");
    expect(snap).toHaveProperty("roundNumber");
  });

  it("getSnapshot returns deep copies — mutating the snapshot does not affect internal state", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    const snap = room.getSnapshot();
    snap.seats.push({} as never);
    expect(room.getSnapshot().seats).toHaveLength(1);
  });
});

describe("GameRoom — state change callback", () => {
  it("setStateChangeHandler callback is called after addPlayer", () => {
    const room = makeRoom();
    const cb = vi.fn();
    room.setStateChangeHandler(cb);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    expect(cb).toHaveBeenCalled();
    const arg = cb.mock.calls[0]?.[0] as GameRoomState;
    expect(arg.seats).toHaveLength(1);
  });

  it("callback is called after startGame", () => {
    const room = makeRoom();
    const cb = vi.fn();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.setStateChangeHandler(cb);
    room.startGame();
    expect(cb).toHaveBeenCalled();
  });
});

describe("GameRoom — player bust", () => {
  it("player busting ends their turn automatically", () => {
    // cards[0] drawn 1st (player 1st), cards[1] 2nd (dealer up), cards[2] 3rd (player 2nd), cards[3] 4th (dealer hole)
    // Player: 8+6=14, hit K → 8+6+K=24 bust
    // Dealer: 7(up)+5(hole)=12 → needs to draw to reach ≥17
    // Dealer draws 6 → 18, stops. Need enough cards.
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // [0] player 1st
      { suit: "diamonds", rank: "7", faceDown: false }, // [1] dealer upcard
      { suit: "hearts", rank: "6", faceDown: false }, // [2] player 2nd
      { suit: "clubs", rank: "5", faceDown: false }, // [3] dealer hole → dealer=12
      { suit: "clubs", rank: "K", faceDown: false }, // [4] player hit → 8+6+K=24 bust
      { suit: "hearts", rank: "7", faceDown: false }, // [5] dealer draws → 12+7=19
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);

    // Player 8+6=14, hit gets K → 8+6+K=24, bust
    room.playerAction("u1", "hit");

    const snap = room.getSnapshot();
    // After bust, dealer ran synchronously → RESOLVE
    expect(["DEALER_TURN", "RESOLVE"]).toContain(snap.phase);
    expect(snap.seats[0]?.isBusted).toBe(true);
  });
});

describe("GameRoom — NPC bots", () => {
  it("addBot adds a seat with isNpc: true", () => {
    const room = makeRoom();
    room.addBot("bot-1", "Robo Rick", 10000);
    const snap = room.getSnapshot();
    expect(snap.seats).toHaveLength(1);
    expect(snap.seats[0]?.isNpc).toBe(true);
    expect(snap.seats[0]?.username).toBe("Robo Rick");
  });

  it("fillBotsForStart with 1 human fills between 2 and 5 bots", () => {
    const counts = new Set<number>();
    for (let trial = 0; trial < 40; trial++) {
      const room = makeRoom();
      room.addPlayer("u1", "Alice", 1000, "sock-1");
      room.fillBotsForStart();
      const botCount = room.getSnapshot().seats.filter((s) => s.isNpc).length;
      counts.add(botCount);
      expect(botCount).toBeGreaterThanOrEqual(2);
      expect(botCount).toBeLessThanOrEqual(5);
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it("fillBotsForStart with 5 humans adds 0 or 1 bots (already above min-3 threshold)", () => {
    const room = makeRoom();
    for (let i = 0; i < 5; i++) room.addPlayer(`u${i}`, `P${i}`, 1000, `s${i}`);
    room.fillBotsForStart();
    const bots = room.getSnapshot().seats.filter((s) => s.isNpc);
    expect(bots.length).toBeLessThanOrEqual(1);
  });

  it("fillBotsForStart with 6 humans adds no bots", () => {
    const room = makeRoom();
    for (let i = 0; i < 6; i++) room.addPlayer(`u${i}`, `P${i}`, 1000, `s${i}`);
    room.fillBotsForStart();
    const bots = room.getSnapshot().seats.filter((s) => s.isNpc);
    expect(bots).toHaveLength(0);
  });

  it("nextRound retains bot seats and resets their hand/bet", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.addBot("bot-1", "Robo Rick", 10000);
    room.startGame();
    room.placeBet("u1", 10);
    room.placeBet("bot-1", 10);
    skipInsuranceIfNeeded(room);
    room.playerAction("u1", "stand");
    room.playerAction("bot-1", "stand");
    room.nextRound();
    const snap = room.getSnapshot();
    const botSeat = snap.seats.find((s) => s.isNpc);
    expect(botSeat).toBeDefined();
    expect(botSeat?.bet).toBe(0);
    expect(botSeat?.hand).toHaveLength(0);
  });

  it("getConfig returns minBet and maxBet", () => {
    const room = makeRoom({ minBet: 5, maxBet: 200 });
    expect(room.getConfig()).toEqual({ minBet: 5, maxBet: 200 });
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Surrender
// ---------------------------------------------------------------------------

describe("GameRoom — surrender", () => {
  function setupRoomForSurrender(): GameRoom {
    // Player: 8+6=14, Dealer upcard: 7 (not Ace), Dealer hole: 5 → dealer=12
    // Dealer draws K → 12+10=22 (bust) → player wins if they don't surrender
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // player 1st
      { suit: "diamonds", rank: "7", faceDown: false }, // dealer upcard (not Ace)
      { suit: "hearts", rank: "6", faceDown: false }, // player 2nd
      { suit: "clubs", rank: "5", faceDown: false }, // dealer hole
      { suit: "hearts", rank: "K", faceDown: false }, // dealer draws → 22 bust
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    return room;
  }

  it("surrender on first action sets outcome to 'surrender' and returns half bet", () => {
    const room = setupRoomForSurrender();
    room.playerAction("u1", "surrender");
    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    expect(snap.seats[0]?.outcome).toBe("surrender");
    // Bet 50 escrowed (bankroll was 1000 → 950). Half of 50 = 25 returned → 975.
    expect(snap.seats[0]?.bankroll).toBe(975);
  });

  it("surrender after hitting throws", () => {
    // Non-busting hit (8+6+2=16) so the dealer does not run and the player still has a turn
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "diamonds", rank: "7", faceDown: false },
      { suit: "hearts", rank: "6", faceDown: false },
      { suit: "clubs", rank: "5", faceDown: false },
      { suit: "hearts", rank: "2", faceDown: false }, // player hit → 16 (no bust)
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    room.playerAction("u1", "hit"); // now has 3 cards
    expect(() => room.playerAction("u1", "surrender")).toThrow();
  });

  it("surrender when not the active seat throws", () => {
    // Two players: u1 is seat 0 (active), u2 is seat 1
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "clubs", rank: "9", faceDown: false },
      { suit: "diamonds", rank: "7", faceDown: false },
      { suit: "hearts", rank: "6", faceDown: false },
      { suit: "spades", rank: "7", faceDown: false },
      { suit: "clubs", rank: "5", faceDown: false },
      { suit: "hearts", rank: "K", faceDown: false },
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.addPlayer("u2", "Bob", 1000, "sock-2");
    room.startGame();
    room.placeBet("u1", 50);
    room.placeBet("u2", 50);
    expect(() => room.playerAction("u2", "surrender")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Double Down
// ---------------------------------------------------------------------------

describe("GameRoom — double down", () => {
  function setupRoomForDouble(): GameRoom {
    // Player: 8+3=11, Dealer upcard: 7 (not Ace), Dealer hole: 5 → dealer=12
    // Player doubles → gets K → 8+3+K=21
    // Dealer draws 7 → 12+7=19
    // Player 21 > Dealer 19 → win
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // player 1st
      { suit: "diamonds", rank: "7", faceDown: false }, // dealer upcard (not Ace)
      { suit: "hearts", rank: "3", faceDown: false }, // player 2nd → 11
      { suit: "clubs", rank: "5", faceDown: false }, // dealer hole → dealer=12
      { suit: "diamonds", rank: "K", faceDown: false }, // player double card → 21
      { suit: "hearts", rank: "7", faceDown: false }, // dealer draws → 19
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    return room;
  }

  it("double down doubles the bet; both bets are lost on player bust", () => {
    // Player busts on the double card → net loss = main bet + double bet.
    // Player: 8+8=16, dealer: 7(up)+K(hole)=17 (stands). Player doubles → K → 26 bust.
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // player 1st
      { suit: "diamonds", rank: "7", faceDown: false }, // dealer upcard (not Ace)
      { suit: "hearts", rank: "8", faceDown: false }, // player 2nd → 16
      { suit: "clubs", rank: "K", faceDown: false }, // dealer hole → 17 (stands, no draw)
      { suit: "diamonds", rank: "K", faceDown: false }, // player double card → 26 bust
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    room.playerAction("u1", "double");
    const snap = room.getSnapshot();
    // bet doubled (50 → 100), player busted → loss → bankroll: 1000 - 50 - 50 = 900
    expect(snap.seats[0]?.bet).toBe(100);
    expect(snap.seats[0]?.bankroll).toBe(900);
    expect(snap.seats[0]?.outcome).toBe("loss");
  });

  it("double down deals exactly one card to player then auto-stands", () => {
    const room = setupRoomForDouble();
    room.playerAction("u1", "double");
    const snap = room.getSnapshot();
    // Player had 2 cards, got 1 more → 3. Phase advanced to DEALER_TURN/RESOLVE.
    expect(snap.seats[0]?.hand).toHaveLength(3);
    expect(["DEALER_TURN", "RESOLVE"]).toContain(snap.phase);
  });

  it("double down wins pay on the doubled bet", () => {
    const room = setupRoomForDouble();
    room.playerAction("u1", "double");
    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    // Player 21 vs Dealer 19 → win. Bet 100. Bankroll was 900 → +200 → 1100.
    expect(snap.seats[0]?.bankroll).toBe(1100);
    expect(snap.seats[0]?.outcome).toBe("win");
  });

  it("double down after hitting throws", () => {
    const room = setupRoomForDouble();
    room.playerAction("u1", "hit");
    expect(() => room.playerAction("u1", "double")).toThrow();
  });

  it("double down with insufficient bankroll throws", () => {
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "diamonds", rank: "7", faceDown: false },
      { suit: "hearts", rank: "3", faceDown: false },
      { suit: "clubs", rank: "5", faceDown: false },
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    // Only 60 chips: bet 50, leaving 10. Need 50 more to double.
    room.addPlayer("u1", "Alice", 60, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    expect(() => room.playerAction("u1", "double")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Insurance
// ---------------------------------------------------------------------------

describe("GameRoom — insurance", () => {
  // Dealer upcard A, hole = dealerHoleRank
  // "K" → dealer BJ (A+K=21); "7" → no BJ (A+7=18, dealer stands immediately)
  function setupRoomWithAceUpcard(dealerHoleRank: "K" | "7" = "7"): GameRoom {
    // Player: 8+6=14, Dealer upcard: A
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "diamonds", rank: "A", faceDown: false }, // dealer upcard (ACE)
      { suit: "hearts", rank: "6", faceDown: false },
      { suit: "clubs", rank: dealerHoleRank, faceDown: false }, // dealer hole
      // Extra cards for dealer draw when no BJ (A+7=18 stands immediately, no extras needed)
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    expect(room.getSnapshot().phase).toBe("CHECK_INSURANCE");
    return room;
  }

  it("placeInsurance sets insuranceBet on seat and deducts from bankroll", () => {
    const room = setupRoomWithAceUpcard("7");
    room.placeInsurance("u1", 25);
    const snap = room.getSnapshot();
    // bankroll: 1000 - 50 (main bet) - 25 (insurance) = 925
    expect(snap.seats[0]?.insuranceBet).toBe(25);
    expect(snap.seats[0]?.bankroll).toBe(925);
  });

  it("placeInsurance amount above half of main bet throws", () => {
    const room = setupRoomWithAceUpcard("7");
    // max insurance = Math.floor(50/2) = 25; 26 is too much
    expect(() => room.placeInsurance("u1", 26)).toThrow();
  });

  it("placeInsurance with insufficient bankroll throws", () => {
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "diamonds", rank: "A", faceDown: false },
      { suit: "hearts", rank: "6", faceDown: false },
      { suit: "clubs", rank: "7", faceDown: false },
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    // 51 chips: bet 50 → 1 chip left; can't cover 25 insurance
    room.addPlayer("u1", "Alice", 51, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    expect(() => room.placeInsurance("u1", 25)).toThrow();
  });

  it("declineInsurance transitions to PLAYER_TURNS", () => {
    const room = setupRoomWithAceUpcard("7");
    room.declineInsurance("u1");
    expect(room.getSnapshot().phase).toBe("PLAYER_TURNS");
  });

  it("skipInsurance (all-decline convenience) transitions to PLAYER_TURNS", () => {
    const room = setupRoomWithAceUpcard("7");
    room.skipInsurance();
    expect(room.getSnapshot().phase).toBe("PLAYER_TURNS");
  });

  it("insurance bet is lost when dealer does not have blackjack", () => {
    const room = setupRoomWithAceUpcard("7"); // A+7=18, dealer stands; no BJ
    room.placeInsurance("u1", 25);
    // After decline/place, phase advances to PLAYER_TURNS (u1 is the only human)
    room.playerAction("u1", "stand");
    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    // Player 14 vs Dealer 18 → loss.
    // bankroll: 925 (after main bet + insurance deducted). Main bet lost → stays 925.
    expect(snap.seats[0]?.bankroll).toBe(925);
    expect(snap.seats[0]?.outcome).toBe("loss");
  });

  it("insurance wins 2:1 when dealer has blackjack and player loses main hand", () => {
    const room = setupRoomWithAceUpcard("K"); // A+K=21, dealer BJ
    room.placeInsurance("u1", 25);
    // placeInsurance causes immediate resolution (dealer BJ skips player turns)
    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    expect(snap.seats[0]?.outcome).toBe("loss"); // 8+6=14 loses to dealer BJ
    // bankroll: 1000 - 50 (main bet) - 25 (insurance) + 75 (insurance 2:1 win) = 1000
    expect(snap.seats[0]?.bankroll).toBe(1000);
  });

  it("player BJ + dealer BJ → push on main hand, insurance still pays 2:1", () => {
    // player: 10+A = BJ, dealer: A(up)+K(hole) = BJ
    // Deal order: player-1st, dealer-upcard, player-2nd, dealer-hole
    const cards: Card[] = [
      { suit: "spades", rank: "10", faceDown: false }, // player 1st
      { suit: "diamonds", rank: "A", faceDown: false }, // dealer upcard (Ace)
      { suit: "hearts", rank: "A", faceDown: false }, // player 2nd → 10+A = BJ
      { suit: "clubs", rank: "K", faceDown: false }, // dealer hole → A+K = BJ
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    expect(room.getSnapshot().phase).toBe("CHECK_INSURANCE");
    room.placeInsurance("u1", 25);
    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    expect(snap.seats[0]?.outcome).toBe("push"); // both BJ → push
    // bankroll: 1000 - 50 (main) - 25 (insurance) + 75 (insurance 2:1) + 50 (push return) = 1050
    expect(snap.seats[0]?.bankroll).toBe(1050);
  });

  it("multiple human players all respond before phase advances", () => {
    // 2 players, dealer shows Ace, hole is 7 (no BJ)
    // Multi-player deal: u1-1st, u2-1st, dealer-upcard, u1-2nd, u2-2nd, dealer-hole
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // u1 1st
      { suit: "clubs", rank: "9", faceDown: false }, // u2 1st
      { suit: "diamonds", rank: "A", faceDown: false }, // dealer upcard (Ace)
      { suit: "hearts", rank: "6", faceDown: false }, // u1 2nd
      { suit: "spades", rank: "7", faceDown: false }, // u2 2nd
      { suit: "clubs", rank: "7", faceDown: false }, // dealer hole (A+7=18, no BJ)
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.addPlayer("u2", "Bob", 1000, "sock-2");
    room.startGame();
    room.placeBet("u1", 50);
    room.placeBet("u2", 50);
    expect(room.getSnapshot().phase).toBe("CHECK_INSURANCE");

    // Only u1 declines — should still wait for u2
    room.declineInsurance("u1");
    expect(room.getSnapshot().phase).toBe("CHECK_INSURANCE");

    // u2 declines — now both responded, phase advances
    room.declineInsurance("u2");
    expect(room.getSnapshot().phase).toBe("PLAYER_TURNS");
  });

  it("NPC bots do not block the insurance transition", () => {
    // 1 human + 1 bot. Bot should not block the insurance wait.
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false }, // u1 1st
      { suit: "clubs", rank: "9", faceDown: false }, // bot 1st
      { suit: "diamonds", rank: "A", faceDown: false }, // dealer upcard (Ace)
      { suit: "hearts", rank: "6", faceDown: false }, // u1 2nd
      { suit: "spades", rank: "7", faceDown: false }, // bot 2nd
      { suit: "clubs", rank: "7", faceDown: false }, // dealer hole (A+7=18, no BJ)
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.addBot("bot-1", "Robo Rick", 10000);
    room.startGame();
    room.placeBet("u1", 50);
    room.placeBet("bot-1", 50);
    expect(room.getSnapshot().phase).toBe("CHECK_INSURANCE");

    // Only u1 (human) needs to respond; declining moves the phase
    room.declineInsurance("u1");
    expect(room.getSnapshot().phase).toBe("PLAYER_TURNS");
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — Split
// ---------------------------------------------------------------------------

describe("GameRoom — split", () => {
  // Deal order: player card[0], dealer card[1], player card[2], dealer hole card[3]
  // After split: primary draws card[4], split hand draws card[5]
  function makeSplitDeck(extra: Card[] = []): Deck {
    const cards: Card[] = [
      { suit: "spades", rank: "K", faceDown: false }, // player 1st
      { suit: "hearts", rank: "6", faceDown: false }, // dealer upcard (not Ace)
      { suit: "clubs", rank: "K", faceDown: false }, // player 2nd — matching rank
      { suit: "diamonds", rank: "8", faceDown: false }, // dealer hole → 6+8=14
      { suit: "hearts", rank: "7", faceDown: false }, // primary after split → K+7=17
      { suit: "clubs", rank: "9", faceDown: false }, // split hand → K+9=19
      { suit: "spades", rank: "K", faceDown: false }, // dealer hit → 14+K=24 (bust)
      ...extra,
    ];
    return buildDeckWithCards(cards);
  }

  function makeRoomWithSplitDeck(bankroll = 1000, bet = 100): GameRoom {
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 10, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = makeSplitDeck();
    room.addPlayer("u1", "Alice", bankroll, "sock-1");
    room.startGame();
    room.placeBet("u1", bet);
    return room;
  }

  it("split creates two hands from a matching-rank pair", () => {
    const room = makeRoomWithSplitDeck();
    room.playerAction("u1", "split");
    const snap = room.getSnapshot();
    const seat = snap.seats[0]!;

    // Primary: K + 7 = 17
    expect(seat.hand).toHaveLength(2);
    expect(seat.hand[0]!.rank).toBe("K");
    expect(seat.hand[1]!.rank).toBe("7");
    expect(seat.handValue).toBe(17);

    // Split hand: K + 9 = 19
    expect(seat.splitHand).not.toBeNull();
    expect(seat.splitHand!.cards).toHaveLength(2);
    expect(seat.splitHand!.cards[0]!.rank).toBe("K");
    expect(seat.splitHand!.cards[1]!.rank).toBe("9");
    expect(seat.splitHand!.value).toBe(19);

    // Second bet escrowed
    expect(seat.bankroll).toBe(800); // 1000 - 100 (main) - 100 (split)

    // Still on primary hand
    expect(seat.activeHandIndex).toBe(0);
    expect(snap.activeSeatIndex).toBe(0);
  });

  it("split rejects non-matching ranks", () => {
    const cards: Card[] = [
      { suit: "spades", rank: "8", faceDown: false },
      { suit: "hearts", rank: "6", faceDown: false },
      { suit: "clubs", rank: "7", faceDown: false }, // different rank
      { suit: "diamonds", rank: "8", faceDown: false },
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 100);
    expect(() => room.playerAction("u1", "split")).toThrow(/ranks must match/i);
  });

  it("split rejects when bankroll is insufficient for second bet", () => {
    // bankroll=100, bet=100 → bankroll hits 0 after escrow → can't cover split
    const room = makeRoomWithSplitDeck(100, 100);
    expect(() => room.playerAction("u1", "split")).toThrow(/insufficient bankroll/i);
  });

  it("cannot split after already splitting (no re-split)", () => {
    const room = makeRoomWithSplitDeck();
    room.playerAction("u1", "split");
    expect(() => room.playerAction("u1", "split")).toThrow(/already split/i);
  });

  it("cannot surrender on a split hand", () => {
    const room = makeRoomWithSplitDeck();
    room.playerAction("u1", "split");
    room.playerAction("u1", "stand"); // finish primary hand
    // Now on split hand (activeHandIndex=1)
    expect(() => room.playerAction("u1", "surrender")).toThrow(/surrender.*split/i);
  });

  it("stand on primary split hand transitions to split hand (activeHandIndex=1)", () => {
    const room = makeRoomWithSplitDeck();
    room.playerAction("u1", "split");
    room.playerAction("u1", "stand"); // stand on primary

    const snap = room.getSnapshot();
    const seat = snap.seats[0]!;
    expect(snap.activeSeatIndex).toBe(0); // still same seat
    expect(seat.activeHandIndex).toBe(1); // now on split hand
    expect(seat.hasActed).toBe(true);
    expect(seat.splitHand!.hasActed).toBe(false);
  });

  it("stand on split hand advances to dealer turn (solo player)", () => {
    const room = makeRoomWithSplitDeck();
    room.playerAction("u1", "split");
    room.playerAction("u1", "stand"); // stand primary
    room.playerAction("u1", "stand"); // stand split hand

    const snap = room.getSnapshot();
    expect(["DEALER_TURN", "RESOLVE"]).toContain(snap.phase);
  });

  it("bust on primary split hand transitions to split hand", () => {
    // Primary will bust: K + 7 = 17, hit K → 27
    const cards: Card[] = [
      { suit: "spades", rank: "K", faceDown: false }, // player 1st
      { suit: "hearts", rank: "6", faceDown: false }, // dealer upcard
      { suit: "clubs", rank: "K", faceDown: false }, // player 2nd
      { suit: "diamonds", rank: "8", faceDown: false }, // dealer hole
      { suit: "hearts", rank: "7", faceDown: false }, // primary → K+7=17
      { suit: "clubs", rank: "3", faceDown: false }, // split → K+3=13
      { suit: "spades", rank: "K", faceDown: false }, // primary hit → 17+K=27 bust
      { suit: "hearts", rank: "K", faceDown: false }, // dealer hit → 14+K=24 bust
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 10, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 100);

    room.playerAction("u1", "split");
    room.playerAction("u1", "hit"); // primary: 17+K=27, bust

    const snap = room.getSnapshot();
    const seat = snap.seats[0]!;
    expect(seat.isBusted).toBe(true);
    expect(snap.activeSeatIndex).toBe(0); // still seat 0
    expect(seat.activeHandIndex).toBe(1); // switched to split hand
  });

  it("resolve pays both split hands independently when dealer busts", () => {
    const room = makeRoomWithSplitDeck();
    // Primary: K+7=17 (stand), Split: K+9=19 (stand), Dealer: 6+8=14 → hits K=24 bust
    room.playerAction("u1", "split");
    room.playerAction("u1", "stand"); // stand primary (17)
    room.playerAction("u1", "stand"); // stand split (19)

    const snap = room.getSnapshot();
    expect(snap.phase).toBe("RESOLVE");
    const seat = snap.seats[0]!;

    expect(seat.outcome).toBe("win"); // primary wins (dealer bust)
    expect(seat.splitHand!.outcome).toBe("win"); // split hand wins (dealer bust)

    // 1000 - 100 (main escrow) - 100 (split escrow) = 800
    // +200 primary win + 200 split win = 1200
    expect(seat.bankroll).toBe(1200);
  });

  it("split hand isBlackjack is always false (split 21 pays 1:1 not 3:2)", () => {
    // Give player A+A → split → A + K on primary (21 but not blackjack)
    const cards: Card[] = [
      { suit: "spades", rank: "A", faceDown: false }, // player 1st
      { suit: "hearts", rank: "6", faceDown: false }, // dealer upcard
      { suit: "clubs", rank: "A", faceDown: false }, // player 2nd
      { suit: "diamonds", rank: "8", faceDown: false }, // dealer hole
      { suit: "hearts", rank: "K", faceDown: false }, // primary → A+K=21 (not BJ)
      { suit: "clubs", rank: "9", faceDown: false }, // split → A+9=20
      { suit: "spades", rank: "K", faceDown: false }, // dealer hit
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 10, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 100);

    room.playerAction("u1", "split");
    const snap = room.getSnapshot();
    expect(snap.seats[0]!.isBlackjack).toBe(false); // A+K on split = 21 but not BJ
    expect(snap.seats[0]!.splitHand!.isBlackjack).toBe(false);
  });

  it("nextRound clears splitHand and resets activeHandIndex", () => {
    const room = makeRoomWithSplitDeck();
    room.playerAction("u1", "split");
    room.playerAction("u1", "stand");
    room.playerAction("u1", "stand");
    room.nextRound();

    const snap = room.getSnapshot();
    const seat = snap.seats[0]!;
    expect(seat.splitHand).toBeNull();
    expect(seat.activeHandIndex).toBe(0);
  });
});

describe("GameRoom — blackjack seat auto-advance", () => {
  it("when seat 0 has blackjack, activeSeatIndex advances to seat 1 after startPlayerTurns", () => {
    // Deal player a blackjack (10+A), bot a normal hand (8+6=14), dealer 7 up + 5 hole (no BJ)
    // Deal order: player-1st, bot-1st, dealer-upcard, player-2nd, bot-2nd, dealer-hole
    const cards: Card[] = [
      { suit: "spades", rank: "10", faceDown: false }, // u1 1st
      { suit: "clubs", rank: "8", faceDown: false }, // bot 1st
      { suit: "diamonds", rank: "7", faceDown: false }, // dealer upcard (not Ace)
      { suit: "hearts", rank: "A", faceDown: false }, // u1 2nd → 10+A = BJ
      { suit: "spades", rank: "6", faceDown: false }, // bot 2nd → 14
      { suit: "clubs", rank: "5", faceDown: false }, // dealer hole → 12
      { suit: "hearts", rank: "9", faceDown: false }, // dealer draws → 21
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.addBot("bot-1", "Robo Rick", 10000);
    room.startGame();
    room.placeBet("u1", 50);
    room.placeBet("bot-1", 50);

    const snap = room.getSnapshot();
    expect(snap.seats[0]?.isBlackjack).toBe(true);
    // activeSeatIndex must point to the bot (seat 1), not the BJ human (seat 0)
    expect(snap.activeSeatIndex).toBe(1);
    expect(snap.phase).toBe("PLAYER_TURNS");
  });

  it("double down throws when player has blackjack", () => {
    // u1: 10+A = BJ (seat 0, auto-skipped), bot: 8+6=14 (seat 1, active)
    // Deal order: u1-1st, bot-1st, dealer-upcard, u1-2nd, bot-2nd, dealer-hole
    const cards: Card[] = [
      { suit: "spades", rank: "10", faceDown: false }, // u1 1st
      { suit: "clubs", rank: "8", faceDown: false }, // bot 1st
      { suit: "diamonds", rank: "7", faceDown: false }, // dealer upcard (not Ace)
      { suit: "hearts", rank: "A", faceDown: false }, // u1 2nd → 10+A = BJ
      { suit: "spades", rank: "6", faceDown: false }, // bot 2nd → 14
      { suit: "clubs", rank: "5", faceDown: false }, // dealer hole → 12
      { suit: "hearts", rank: "9", faceDown: false }, // dealer draws → 21
    ];
    const room = new GameRoom("table-1", { deckCount: 0, minBet: 1, maxBet: 500 });
    (room as unknown as { deck: Deck }).deck = buildDeckWithCards(cards);
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.addBot("bot-1", "Robo Rick", 10000);
    room.startGame();
    room.placeBet("u1", 50);
    room.placeBet("bot-1", 50);

    expect(room.getSnapshot().seats[0]?.isBlackjack).toBe(true);
    // u1 was auto-skipped (BJ); activeSeat is now bot-1 → "not your turn"
    expect(() => room.playerAction("u1", "double")).toThrow();
  });
});

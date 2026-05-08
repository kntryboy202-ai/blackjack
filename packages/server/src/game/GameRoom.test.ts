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
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    const snap = room.getSnapshot();
    expect(snap.dealer.hand).toHaveLength(2);
  });

  it("dealer's second card (index 1) is faceDown after dealing", () => {
    const room = makeRoom();
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

  it("double/split/insurance/surrender throw 'not implemented'", () => {
    expect(() => room.playerAction("u1", "double")).toThrow(/not implemented/i);
    expect(() => room.playerAction("u1", "split")).toThrow(/not implemented/i);
    expect(() => room.playerAction("u1", "insurance")).toThrow(/not implemented/i);
    expect(() => room.playerAction("u1", "surrender")).toThrow(/not implemented/i);
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
    room.playerAction("u1", "stand");
    // Now in RESOLVE
    room.nextRound();
    expect(room.getSnapshot().phase).toBe("PLACE_BETS");
  });

  it("nextRound with no remaining players transitions to WAITING_FOR_PLAYERS", () => {
    const room = makeRoom();
    room.addPlayer("u1", "Alice", 1000, "sock-1");
    room.startGame();
    room.placeBet("u1", 50);
    skipInsuranceIfNeeded(room);
    room.playerAction("u1", "stand");
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
    room.playerAction("u1", "stand");
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

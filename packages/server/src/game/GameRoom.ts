// ABOUTME: GameRoom state machine managing the full blackjack game lifecycle.
// ABOUTME: Owns all game state; emits events via callback rather than calling Socket.io directly.

import type {
  Card,
  DealerState,
  GamePhase,
  GameRoomState,
  HandOutcome,
  PlayerAction,
  PlayerSeat,
} from "@blackjack/shared";
import { Deck } from "./Deck.js";
import { calculateHand } from "./Hand.js";
import { dealerShouldHit, resolveHand } from "./Rules.js";

const BOT_NAMES = [
  "Robo Rick",
  "Lucky Lou",
  "Dealer Dan",
  "Card Shark Sam",
  "Blind Bet Bob",
  "All-In Alice",
  "Count Von Count",
  "Bust Betty",
  "One-Eye Willie",
  "Shufflebot",
  "21 Jumpstreet",
  "Blackjack Barry",
];

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
  return arr;
}

interface GameRoomConfig {
  deckCount: number;
  minBet: number;
  maxBet: number;
}

// Internal seat tracks outcome separately from the shared PlayerSeat type
interface InternalSeat extends PlayerSeat {
  outcome: HandOutcome | null;
}

export class GameRoom {
  private readonly tableId: string;
  private readonly config: GameRoomConfig;
  protected deck: Deck;
  private seats: InternalSeat[];
  private dealer: DealerState;
  private phase: GamePhase;
  private activeSeatIndex: number | null;
  private roundNumber: number;
  private stateChangeHandler: ((snapshot: GameRoomState) => void) | null;

  constructor(tableId: string, config: GameRoomConfig) {
    this.tableId = tableId;
    this.config = config;
    this.deck = new Deck(config.deckCount);
    this.seats = [];
    this.dealer = { hand: [], handValue: 0, isSoft: false };
    this.phase = "WAITING_FOR_PLAYERS";
    this.activeSeatIndex = null;
    this.roundNumber = 1;
    this.stateChangeHandler = null;
  }

  setStateChangeHandler(fn: (snapshot: GameRoomState) => void): void {
    this.stateChangeHandler = fn;
  }

  private emit(): void {
    if (this.stateChangeHandler) {
      this.stateChangeHandler(this.getSnapshot());
    }
  }

  addPlayer(userId: string, username: string, bankroll: number, _socketId: string): void {
    if (this.seats.length >= 6) {
      throw new Error("Table is full — maximum 6 players.");
    }
    const seatIndex = this.seats.length;
    this.seats.push({
      userId,
      username,
      seatIndex,
      bankroll,
      bet: 0,
      hand: [],
      handValue: 0,
      isSoft: false,
      isBusted: false,
      isBlackjack: false,
      hasActed: false,
      isNpc: false,
      outcome: null,
    });
    this.emit();
  }

  addBot(botId: string, name: string, bankroll: number): void {
    if (this.seats.length >= 6) return;
    this.seats.push({
      userId: botId,
      username: name,
      seatIndex: this.seats.length,
      bankroll,
      bet: 0,
      hand: [],
      handValue: 0,
      isSoft: false,
      isBusted: false,
      isBlackjack: false,
      hasActed: false,
      isNpc: true,
      outcome: null,
    });
    // no emit — called before startGame
  }

  fillBotsForStart(): void {
    const humanCount = this.seats.length;
    const minTotal = Math.max(humanCount, 3);
    const maxTotal = 6;
    const botCount =
      Math.floor(Math.random() * (maxTotal - minTotal + 1)) + (minTotal - humanCount);
    const available = shuffleArray([...BOT_NAMES]);
    for (let i = 0; i < botCount; i++) {
      const name = available[i % available.length] ?? `Bot ${i + 1}`;
      this.addBot(`bot-${Date.now()}-${i}`, name, this.config.maxBet * 200);
    }
  }

  getConfig(): { minBet: number; maxBet: number } {
    return { minBet: this.config.minBet, maxBet: this.config.maxBet };
  }

  removePlayer(userId: string): void {
    const idx = this.seats.findIndex((s) => s.userId === userId);
    if (idx === -1) return;
    this.seats.splice(idx, 1);
    // Re-number seat indices after removal
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (seat) seat.seatIndex = i;
    }
    this.emit();
  }

  getSeatIndex(userId: string): number {
    const idx = this.seats.findIndex((s) => s.userId === userId);
    if (idx === -1) throw new Error(`User ${userId} not found at this table.`);
    return idx;
  }

  startGame(): void {
    if (this.seats.length === 0) {
      throw new Error("Cannot start game with no players.");
    }
    this.phase = "PLACE_BETS";
    // Reset hands and bets for a fresh round
    for (const seat of this.seats) {
      seat.hand = [];
      seat.bet = 0;
      seat.handValue = 0;
      seat.isSoft = false;
      seat.isBusted = false;
      seat.isBlackjack = false;
      seat.hasActed = false;
      seat.outcome = null;
    }
    this.dealer = { hand: [], handValue: 0, isSoft: false };
    this.activeSeatIndex = null;
    this.emit();
  }

  placeBet(userId: string, amount: number): void {
    if (this.phase !== "PLACE_BETS") {
      throw new Error(`Cannot place bet in phase ${this.phase}.`);
    }
    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat) throw new Error(`User ${userId} not at this table.`);

    if (amount < this.config.minBet) {
      throw new Error(`Bet ${amount} is below minimum ${this.config.minBet}.`);
    }
    if (amount > this.config.maxBet) {
      throw new Error(`Bet ${amount} exceeds maximum ${this.config.maxBet}.`);
    }
    if (amount > seat.bankroll) {
      throw new Error(`Bet ${amount} exceeds bankroll ${seat.bankroll}.`);
    }

    // Escrow: deduct bet from bankroll immediately
    seat.bet = amount;
    seat.bankroll -= amount;

    // Check if all players have placed bets
    const allBetsPlaced = this.seats.every((s) => s.bet > 0);
    if (allBetsPlaced) {
      this.deal();
    } else {
      this.emit();
    }
  }

  private deal(): void {
    this.phase = "DEALING";
    this.dealer = { hand: [], handValue: 0, isSoft: false };

    // Classic blackjack deal order: each player gets one card, dealer gets one (face up),
    // then each player gets one more, dealer gets one (face down/hole card)
    for (const seat of this.seats) {
      seat.hand = [];
      seat.isBusted = false;
      seat.isBlackjack = false;
      seat.hasActed = false;
      seat.handValue = 0;
      seat.isSoft = false;
    }

    // First card to each player
    for (const seat of this.seats) {
      seat.hand.push(this.deck.draw(false));
    }
    // First dealer card (upcard, face up)
    this.dealer.hand.push(this.deck.draw(false));

    // Second card to each player
    for (const seat of this.seats) {
      seat.hand.push(this.deck.draw(false));
    }
    // Second dealer card (hole card, face down)
    this.dealer.hand.push(this.deck.draw(true));

    // Update hand values for all players
    for (const seat of this.seats) {
      const result = calculateHand(seat.hand);
      seat.handValue = result.value;
      seat.isSoft = result.isSoft;
      seat.isBusted = result.isBusted;
      seat.isBlackjack = result.isBlackjack;
    }

    // Update dealer visible value (only upcard visible)
    const dealerVisible = calculateHand(this.dealer.hand);
    this.dealer.handValue = dealerVisible.value;
    this.dealer.isSoft = dealerVisible.isSoft;

    // Check if dealer upcard (index 0) is an Ace — if so, offer insurance
    const dealerUpcard = this.dealer.hand[0];
    if (dealerUpcard?.rank === "A") {
      this.phase = "CHECK_INSURANCE";
      this.emit();
      return;
    }

    this.startPlayerTurns();
  }

  // Phase 1: all players decline insurance — full insurance betting is Phase 2.
  skipInsurance(): void {
    if (this.phase !== "CHECK_INSURANCE") {
      throw new Error(`Cannot skip insurance in phase ${this.phase}.`);
    }
    this.startPlayerTurns();
  }

  private startPlayerTurns(): void {
    this.phase = "PLAYER_TURNS";
    this.activeSeatIndex = 0;
    this.emit();

    // Advance past any already-resolved seats (e.g. blackjack)
    this.advanceTurnIfNeeded();
  }

  private advanceTurnIfNeeded(): void {
    // If current active seat already has acted or has blackjack, advance
    while (this.activeSeatIndex !== null && this.activeSeatIndex < this.seats.length) {
      const seat = this.seats[this.activeSeatIndex];
      if (!seat) break;
      if (seat.isBlackjack || seat.isBusted || seat.hasActed) {
        this.activeSeatIndex++;
      } else {
        break;
      }
    }

    if (this.activeSeatIndex === null || this.activeSeatIndex >= this.seats.length) {
      this.runDealerTurn();
    }
  }

  playerAction(userId: string, action: PlayerAction): void {
    if (this.phase !== "PLAYER_TURNS") {
      throw new Error(`Cannot act in phase ${this.phase}.`);
    }

    const notImplemented = ["double", "split", "insurance", "surrender"] as PlayerAction[];
    if (notImplemented.includes(action)) {
      throw new Error(`Action "${action}" is not implemented in Phase 1.`);
    }

    const seatIdx = this.getSeatIndex(userId);
    if (seatIdx !== this.activeSeatIndex) {
      throw new Error(`It is not ${userId}'s turn.`);
    }

    const seat = this.seats[seatIdx];
    if (!seat) throw new Error(`Seat ${seatIdx} not found.`);

    if (seat.isBusted) {
      throw new Error(`${userId} is already busted.`);
    }

    if (action === "hit") {
      seat.hand.push(this.deck.draw(false));
      const result = calculateHand(seat.hand);
      seat.handValue = result.value;
      seat.isSoft = result.isSoft;
      seat.isBusted = result.isBusted;
      seat.isBlackjack = result.isBlackjack;

      if (seat.isBusted) {
        // Auto-advance to next player
        this.activeSeatIndex = seatIdx + 1;
        this.emit();
        this.advanceTurnIfNeeded();
        return;
      }
      this.emit();
    } else if (action === "stand") {
      seat.hasActed = true;
      this.activeSeatIndex = seatIdx + 1;
      this.emit();
      this.advanceTurnIfNeeded();
    }
  }

  private runDealerTurn(): void {
    this.phase = "DEALER_TURN";
    this.activeSeatIndex = null;

    // Reveal dealer's hole card
    for (const card of this.dealer.hand) {
      (card as Card).faceDown = false;
    }

    // Recalculate dealer hand with all cards visible
    let dealerResult = calculateHand(this.dealer.hand);
    this.dealer.handValue = dealerResult.value;
    this.dealer.isSoft = dealerResult.isSoft;

    // Dealer draws until value >= 17
    while (dealerShouldHit(dealerResult)) {
      this.dealer.hand.push(this.deck.draw(false));
      dealerResult = calculateHand(this.dealer.hand);
      this.dealer.handValue = dealerResult.value;
      this.dealer.isSoft = dealerResult.isSoft;
    }

    this.emit();
    this.resolve();
  }

  private resolve(): void {
    this.phase = "RESOLVE";

    const dealerResult = calculateHand(this.dealer.hand);

    for (const seat of this.seats) {
      const playerResult = calculateHand(seat.hand);
      const outcome = resolveHand(playerResult, dealerResult);
      seat.outcome = outcome;

      // Apply bankroll changes based on outcome
      // Bet was already escrowed (deducted from bankroll at placeBet time)
      switch (outcome) {
        case "win":
          seat.bankroll += seat.bet * 2;
          break;
        case "blackjack":
          seat.bankroll += seat.bet + Math.floor(seat.bet * 1.5);
          break;
        case "push":
          seat.bankroll += seat.bet;
          break;
        case "loss":
          // Bet already gone — no return
          break;
        case "surrender":
          seat.bankroll += Math.floor(seat.bet / 2);
          break;
      }
    }

    this.emit();
  }

  nextRound(): void {
    this.roundNumber++;

    // Reset all seats for the next round
    for (const seat of this.seats) {
      seat.hand = [];
      seat.bet = 0;
      seat.handValue = 0;
      seat.isSoft = false;
      seat.isBusted = false;
      seat.isBlackjack = false;
      seat.hasActed = false;
      seat.outcome = null;
    }
    this.dealer = { hand: [], handValue: 0, isSoft: false };
    this.activeSeatIndex = null;

    if (this.seats.length === 0) {
      this.phase = "WAITING_FOR_PLAYERS";
    } else {
      this.phase = "PLACE_BETS";
    }

    this.emit();
  }

  getSnapshot(): GameRoomState {
    // Return a deep copy of plain JSON-serializable state — no class instances
    return JSON.parse(
      JSON.stringify({
        tableId: this.tableId,
        phase: this.phase,
        seats: this.seats.map((seat) => ({
          userId: seat.userId,
          username: seat.username,
          seatIndex: seat.seatIndex,
          bankroll: seat.bankroll,
          bet: seat.bet,
          hand: seat.hand.map((c) => ({ suit: c.suit, rank: c.rank, faceDown: c.faceDown })),
          handValue: seat.handValue,
          isSoft: seat.isSoft,
          isBusted: seat.isBusted,
          isBlackjack: seat.isBlackjack,
          hasActed: seat.hasActed,
          isNpc: seat.isNpc,
          outcome: seat.outcome,
        })),
        dealer: {
          hand: this.dealer.hand.map((c) => ({
            suit: c.suit,
            rank: c.rank,
            faceDown: c.faceDown,
          })),
          handValue: this.dealer.handValue,
          isSoft: this.dealer.isSoft,
        },
        activeSeatIndex: this.activeSeatIndex,
        roundNumber: this.roundNumber,
      })
    ) as GameRoomState;
  }
}

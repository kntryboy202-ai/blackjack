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

// Internal seat tracks outcome and insurance state (insuranceDeclined is server-only)
interface InternalSeat extends PlayerSeat {
  outcome: HandOutcome | null;
  insuranceDeclined: boolean;
}

export class GameRoom {
  private readonly tableId: string;
  private readonly config: GameRoomConfig;
  protected deck: Deck;
  private seats: InternalSeat[];
  private insurancePending: Set<string>;
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
    this.insurancePending = new Set();
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
      insuranceBet: 0,
      insuranceDeclined: false,
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
      insuranceBet: 0,
      insuranceDeclined: false,
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
    // Reset hands, bets, and insurance state for a fresh round
    for (const seat of this.seats) {
      seat.hand = [];
      seat.bet = 0;
      seat.handValue = 0;
      seat.isSoft = false;
      seat.isBusted = false;
      seat.isBlackjack = false;
      seat.hasActed = false;
      seat.outcome = null;
      seat.insuranceBet = 0;
      seat.insuranceDeclined = false;
    }
    this.insurancePending = new Set();
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
      // Only human (non-NPC) players respond to insurance; bots never block the transition
      this.insurancePending = new Set(this.seats.filter((s) => !s.isNpc).map((s) => s.userId));
      if (this.insurancePending.size === 0) {
        // All bots — skip straight through
        this.processInsuranceBets();
        return;
      }
      this.emit();
      return;
    }

    this.startPlayerTurns();
  }

  // Decline insurance for a specific human player and advance when all have responded.
  declineInsurance(userId: string): void {
    if (this.phase !== "CHECK_INSURANCE") {
      throw new Error(`Cannot decline insurance in phase ${this.phase}.`);
    }
    const seat = this.seats.find((s) => s.userId === userId);
    if (seat) {
      seat.insuranceDeclined = true;
    }
    this.insurancePending.delete(userId);
    if (this.insurancePending.size === 0) {
      this.processInsuranceBets();
    } else {
      this.emit();
    }
  }

  // Place an insurance side-bet (up to half the main bet) for a human player.
  placeInsurance(userId: string, amount: number): void {
    if (this.phase !== "CHECK_INSURANCE") {
      throw new Error(`Cannot place insurance in phase ${this.phase}.`);
    }
    const seat = this.seats.find((s) => s.userId === userId);
    if (!seat) throw new Error(`User ${userId} not at this table.`);

    const maxInsurance = Math.floor(seat.bet / 2);
    if (amount > maxInsurance) {
      throw new Error(
        `Insurance bet ${amount} exceeds max allowed ${maxInsurance} (half of main bet).`
      );
    }
    if (amount > seat.bankroll) {
      throw new Error(`Insurance bet ${amount} exceeds bankroll ${seat.bankroll}.`);
    }

    seat.insuranceBet = amount;
    seat.bankroll -= amount;

    this.insurancePending.delete(userId);
    if (this.insurancePending.size === 0) {
      this.processInsuranceBets();
    } else {
      this.emit();
    }
  }

  // Convenience: all pending human players decline — used by existing tests and edge-case skipping.
  skipInsurance(): void {
    if (this.phase !== "CHECK_INSURANCE") {
      throw new Error(`Cannot skip insurance in phase ${this.phase}.`);
    }
    this.insurancePending.clear();
    this.processInsuranceBets();
  }

  // Called when all human players have responded; peeks at hole card and pays out insurance.
  private processInsuranceBets(): void {
    const dealerHasBJ = this.peekDealerBlackjack();

    if (dealerHasBJ) {
      // Pay insurance winners 2:1 before resolving the main hand
      for (const seat of this.seats) {
        if (seat.insuranceBet > 0) {
          // Return the insurance bet plus 2x profit
          seat.bankroll += seat.insuranceBet * 3;
        }
      }
      // Skip player turns — dealer BJ ends the round immediately
      this.runDealerTurn();
    } else {
      // Insurance bets are already deducted and are now lost
      this.startPlayerTurns();
    }
  }

  // Returns true when the dealer holds a blackjack (Ace upcard + 10-value hole card).
  // Peeks at the hole card rank directly since it is face-down and excluded from calculateHand.
  private peekDealerBlackjack(): boolean {
    const holeCard = this.dealer.hand[1];
    if (!holeCard) return false;
    const r = holeCard.rank;
    return r === "10" || r === "J" || r === "Q" || r === "K";
  }

  private startPlayerTurns(): void {
    this.phase = "PLAYER_TURNS";
    this.activeSeatIndex = 0;
    // Don't emit before advancing — advanceTurnIfNeeded emits the settled state
    this.advanceTurnIfNeeded();
  }

  private advanceTurnIfNeeded(): void {
    // Advance past seats that are already resolved (blackjack, busted, or acted)
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
    } else {
      // Emit the settled active seat so clients and bot handlers see the correct state
      this.emit();
    }
  }

  playerAction(userId: string, action: PlayerAction): void {
    if (this.phase !== "PLAYER_TURNS") {
      throw new Error(`Cannot act in phase ${this.phase}.`);
    }

    if (action === "split") {
      throw new Error(`Action "split" is not implemented.`);
    }
    if (action === "insurance") {
      throw new Error(`Use placeInsurance() or declineInsurance() for insurance.`);
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

    if (action === "surrender") {
      // Surrender is only valid as the first action (2-card hand, no hits taken)
      if (seat.hand.length !== 2) {
        throw new Error("Surrender is only allowed on the initial two-card hand.");
      }
      seat.outcome = "surrender";
      // Half the escrowed bet is returned; the other half is lost
      seat.bankroll += Math.floor(seat.bet / 2);
      seat.hasActed = true;
      this.activeSeatIndex = seatIdx + 1;
      this.emit();
      this.advanceTurnIfNeeded();
    } else if (action === "double") {
      if (seat.hand.length !== 2 || seat.isBlackjack) {
        throw new Error(
          "Double down is only allowed on the initial two-card hand (not blackjack)."
        );
      }
      if (seat.bankroll < seat.bet) {
        throw new Error(
          `Insufficient bankroll to double down (need ${seat.bet}, have ${seat.bankroll}).`
        );
      }
      // Escrow an additional bet equal to the original bet
      seat.bankroll -= seat.bet;
      seat.bet *= 2;
      // Draw exactly one card
      seat.hand.push(this.deck.draw(false));
      const result = calculateHand(seat.hand);
      seat.handValue = result.value;
      seat.isSoft = result.isSoft;
      seat.isBusted = result.isBusted;
      seat.isBlackjack = result.isBlackjack;
      seat.hasActed = true;
      this.activeSeatIndex = seatIdx + 1;
      this.emit();
      this.advanceTurnIfNeeded();
    } else if (action === "hit") {
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
      // Surrendered seats already had their outcome set and half-bet returned in playerAction()
      if (seat.outcome === "surrender") continue;

      const playerResult = calculateHand(seat.hand);
      const outcome = resolveHand(playerResult, dealerResult);
      seat.outcome = outcome;

      // Apply bankroll changes based on outcome.
      // Main bet was already escrowed (deducted from bankroll at placeBet time).
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
          // Should not reach here (handled above), but included for exhaustiveness
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
      seat.insuranceBet = 0;
      seat.insuranceDeclined = false;
    }
    this.insurancePending = new Set();
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
          insuranceBet: seat.insuranceBet,
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

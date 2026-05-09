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
  SplitHandState,
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
      splitHand: null,
      activeHandIndex: 0,
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
      splitHand: null,
      activeHandIndex: 0,
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
      seat.splitHand = null;
      seat.activeHandIndex = 0;
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
      seat.splitHand = null;
      seat.activeHandIndex = 0;
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
    // Advance past seats/hands that are already resolved (blackjack, busted, or acted).
    // For split seats: first finish primary hand (activeHandIndex=0), then split hand (=1).
    while (this.activeSeatIndex !== null && this.activeSeatIndex < this.seats.length) {
      const seat = this.seats[this.activeSeatIndex];
      if (!seat) break;

      if (seat.splitHand !== null) {
        if (seat.activeHandIndex === 0) {
          if (seat.isBlackjack || seat.isBusted || seat.hasActed) {
            // Primary hand done — switch to split hand
            seat.activeHandIndex = 1;
          }
          // Whether we just switched or are still playing, stop and emit
          break;
        } else {
          // Playing split hand (activeHandIndex === 1)
          const sh = seat.splitHand;
          if (sh.isBlackjack || sh.isBusted || sh.hasActed) {
            this.activeSeatIndex++;
          } else {
            break;
          }
        }
      } else {
        if (seat.isBlackjack || seat.isBusted || seat.hasActed) {
          this.activeSeatIndex++;
        } else {
          break;
        }
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
    if (action === "insurance") {
      throw new Error(`Use placeInsurance() or declineInsurance() for insurance.`);
    }

    const seatIdx = this.getSeatIndex(userId);
    if (seatIdx !== this.activeSeatIndex) {
      throw new Error(`It is not ${userId}'s turn.`);
    }

    const seat = this.seats[seatIdx];
    if (!seat) throw new Error(`Seat ${seatIdx} not found.`);

    // Determine which hand is currently active for this seat
    const onSplitHand = seat.splitHand !== null && seat.activeHandIndex === 1;

    if (action === "split") {
      if (seat.splitHand !== null) {
        throw new Error("Cannot split: seat has already split.");
      }
      const [card0, card1] = seat.hand;
      if (!card0 || !card1 || seat.hand.length !== 2) {
        throw new Error("Cannot split: need exactly two cards.");
      }
      if (card0.rank !== card1.rank) {
        throw new Error("Cannot split: ranks must match.");
      }
      if (seat.isBlackjack) {
        throw new Error("Cannot split a blackjack.");
      }
      if (seat.bankroll < seat.bet) {
        throw new Error(
          `Insufficient bankroll to split (need ${seat.bet}, have ${seat.bankroll}).`
        );
      }

      // Escrow second bet
      seat.bankroll -= seat.bet;

      // Primary hand: keep card0, draw one more
      const primaryExtra = this.deck.draw(false);
      seat.hand = [card0, primaryExtra];
      const primaryResult = calculateHand(seat.hand);
      seat.handValue = primaryResult.value;
      seat.isSoft = primaryResult.isSoft;
      seat.isBusted = primaryResult.isBusted;
      // Split hands can never be a natural blackjack
      seat.isBlackjack = false;
      seat.hasActed = false;

      // Split hand: card1 + one more card
      const splitExtra = this.deck.draw(false);
      const splitCards = [card1, splitExtra];
      const splitResult = calculateHand(splitCards);
      const splitHand: SplitHandState = {
        cards: splitCards,
        value: splitResult.value,
        isSoft: splitResult.isSoft,
        isBusted: splitResult.isBusted,
        isBlackjack: false, // split hands can never be natural blackjack
        hasActed: false,
        bet: seat.bet, // matches primary bet (already doubled by escrow above)
        outcome: null,
      };
      seat.splitHand = splitHand;
      seat.activeHandIndex = 0; // play primary hand first

      this.emit();
      return;
    }

    if (action === "surrender") {
      if (onSplitHand) {
        throw new Error("Surrender is not allowed on a split hand.");
      }
      if (seat.hand.length !== 2) {
        throw new Error("Surrender is only allowed on the initial two-card hand.");
      }
      seat.outcome = "surrender";
      seat.bankroll += Math.floor(seat.bet / 2);
      seat.hasActed = true;
      this.advanceAfterHandAction(seatIdx, onSplitHand);
      return;
    }

    if (action === "double") {
      if (onSplitHand) {
        const sh = seat.splitHand!;
        if (sh.cards.length !== 2) {
          throw new Error("Double down is only allowed on a two-card split hand.");
        }
        if (seat.bankroll < sh.bet) {
          throw new Error(
            `Insufficient bankroll to double split hand (need ${sh.bet}, have ${seat.bankroll}).`
          );
        }
        seat.bankroll -= sh.bet;
        sh.bet *= 2;
        sh.cards.push(this.deck.draw(false));
        const r = calculateHand(sh.cards);
        sh.value = r.value;
        sh.isSoft = r.isSoft;
        sh.isBusted = r.isBusted;
        sh.isBlackjack = false;
        sh.hasActed = true;
      } else {
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
        seat.bankroll -= seat.bet;
        seat.bet *= 2;
        seat.hand.push(this.deck.draw(false));
        const r = calculateHand(seat.hand);
        seat.handValue = r.value;
        seat.isSoft = r.isSoft;
        seat.isBusted = r.isBusted;
        seat.isBlackjack = r.isBlackjack;
        seat.hasActed = true;
      }
      this.advanceAfterHandAction(seatIdx, onSplitHand);
      return;
    }

    if (action === "hit") {
      if (onSplitHand) {
        const sh = seat.splitHand!;
        if (sh.isBusted) throw new Error("Split hand is already busted.");
        sh.cards.push(this.deck.draw(false));
        const r = calculateHand(sh.cards);
        sh.value = r.value;
        sh.isSoft = r.isSoft;
        sh.isBusted = r.isBusted;
        sh.isBlackjack = false;
        if (sh.isBusted) {
          this.emit();
          this.advanceTurnIfNeeded();
          return;
        }
      } else {
        if (seat.isBusted) throw new Error(`${userId} is already busted.`);
        seat.hand.push(this.deck.draw(false));
        const r = calculateHand(seat.hand);
        seat.handValue = r.value;
        seat.isSoft = r.isSoft;
        seat.isBusted = r.isBusted;
        seat.isBlackjack = r.isBlackjack;
        if (seat.isBusted) {
          this.emit();
          this.advanceTurnIfNeeded();
          return;
        }
      }
      this.emit();
      return;
    }

    if (action === "stand") {
      if (onSplitHand) {
        seat.splitHand!.hasActed = true;
      } else {
        seat.hasActed = true;
      }
      this.advanceAfterHandAction(seatIdx, onSplitHand);
    }
  }

  // After completing a hand action (stand/double/surrender/bust-already-handled),
  // decide whether to advance to the split hand or to the next seat.
  private advanceAfterHandAction(seatIdx: number, onSplitHand: boolean): void {
    const seat = this.seats[seatIdx];
    // If we just finished the primary hand and a split hand exists, don't pre-increment —
    // advanceTurnIfNeeded will switch activeHandIndex to 1 and stay on this seat.
    if (!onSplitHand && seat?.splitHand !== null) {
      // Stay on this seat; advanceTurnIfNeeded handles the transition
    } else {
      this.activeSeatIndex = seatIdx + 1;
    }
    this.emit();
    this.advanceTurnIfNeeded();
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
      this.applyPayout(seat, outcome, seat.bet);

      // Resolve split hand independently if it exists
      if (seat.splitHand !== null) {
        const splitResult = calculateHand(seat.splitHand.cards);
        // Split-hand 21 is not a natural blackjack — override isBlackjack to false
        const splitHandResult = { ...splitResult, isBlackjack: false };
        const splitOutcome = resolveHand(splitHandResult, dealerResult);
        seat.splitHand.outcome = splitOutcome;
        this.applyPayout(seat, splitOutcome, seat.splitHand.bet);
      }
    }

    this.emit();
  }

  private applyPayout(seat: InternalSeat, outcome: HandOutcome, bet: number): void {
    switch (outcome) {
      case "win":
        seat.bankroll += bet * 2;
        break;
      case "blackjack":
        seat.bankroll += bet + Math.floor(bet * 1.5);
        break;
      case "push":
        seat.bankroll += bet;
        break;
      case "loss":
        // Bet already escrowed — nothing to return
        break;
      case "surrender":
        seat.bankroll += Math.floor(bet / 2);
        break;
    }
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
      seat.splitHand = null;
      seat.activeHandIndex = 0;
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
          activeHandIndex: seat.activeHandIndex,
          splitHand: seat.splitHand
            ? {
                cards: seat.splitHand.cards.map((c) => ({
                  suit: c.suit,
                  rank: c.rank,
                  faceDown: c.faceDown,
                })),
                value: seat.splitHand.value,
                isSoft: seat.splitHand.isSoft,
                isBusted: seat.splitHand.isBusted,
                isBlackjack: seat.splitHand.isBlackjack,
                hasActed: seat.splitHand.hasActed,
                bet: seat.splitHand.bet,
                outcome: seat.splitHand.outcome,
              }
            : null,
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

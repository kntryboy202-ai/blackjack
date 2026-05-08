// ABOUTME: Shared TypeScript type definitions used by both client and server packages.
// ABOUTME: Zero runtime dependencies — pure type definitions and interfaces only.

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
  faceDown: boolean;
}

export type GamePhase =
  | "WAITING_FOR_PLAYERS"
  | "PLACE_BETS"
  | "DEALING"
  | "CHECK_INSURANCE"
  | "PLAYER_TURNS"
  | "DEALER_TURN"
  | "RESOLVE"
  | "ROUND_END";

export type HandOutcome = "win" | "loss" | "push" | "blackjack" | "surrender";

export type PlayerAction = "hit" | "stand" | "double" | "split" | "insurance" | "surrender";

export interface PlayerSeat {
  userId: string;
  username: string;
  seatIndex: number;
  bankroll: number;
  bet: number;
  hand: Card[];
  handValue: number;
  isSoft: boolean;
  isBusted: boolean;
  isBlackjack: boolean;
  hasActed: boolean;
  isNpc: boolean;
}

export interface DealerState {
  hand: Card[];
  handValue: number;
  isSoft: boolean;
}

export interface GameRoomState {
  tableId: string;
  phase: GamePhase;
  seats: PlayerSeat[];
  dealer: DealerState;
  activeSeatIndex: number | null;
  roundNumber: number;
}

// --- Socket payload types: Client → Server ---

export interface JoinTablePayload {
  tableId: string;
}

export interface PlaceBetPayload {
  amount: number;
}

export interface ActionPayload {
  type: PlayerAction;
}

// --- Socket payload types: Server → Client ---

export interface CardDealtPayload {
  seatIndex: number;
  card: Card;
}

export interface TurnStartPayload {
  seatIndex: number;
  timeoutSecs: number;
}

export interface TurnTimeoutPayload {
  seatIndex: number;
}

export interface RoundResultEntry {
  seatIndex: number;
  outcome: HandOutcome;
  chipDelta: number;
}

export interface RoundResultPayload {
  results: RoundResultEntry[];
}

export interface BankrollUpdatePayload {
  userId: string;
  newBankroll: number;
}

export interface PlayerJoinedPayload {
  seatIndex: number;
  username: string;
}

export interface PlayerLeftPayload {
  seatIndex: number;
}

export interface ErrorPayload {
  message: string;
}

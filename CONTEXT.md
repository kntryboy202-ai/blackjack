# Blackjack Domain Context

## Core Concepts

**Table** — A game room with a configured `minBet` and `maxBet`. Holds up to 6 seats. Created by a human player, persisted in the DB.

**Seat** — One player position at a table. Holds a hand, bet, bankroll, and outcome for the current round. Either occupied by a Human Player or an NPC Bot.

**Human Player** — An authenticated user with a persistent `User` row and bankroll in the DB. Their hands are recorded in `HandRecord`.

**NPC Bot** — An ephemeral, server-controlled player that fills empty seats when a game starts. Has no DB row, no `HandRecord` writes, and is discarded after each round. Plays using the dealer mimic strategy.

**Dealer Mimic Strategy** — The NPC Bot play rule: reuse `dealerShouldHit()` from `Rules.ts`. Hit below 17, stand at hard/soft 17 or above.

**Round** — One complete deal-to-resolve cycle. Begins at `PLACE_BETS`, ends at `RESOLVE`. All seats (human and bot) participate in the same round.

**Turn Timer** — A 30-second server-side countdown per player turn during `PLAYER_TURNS` phase. On expiry the server auto-stands the active seat. The client shows a visible countdown to the active player.

**Hand Outcome** — The result of a seat's round: `win`, `loss`, `push`, `blackjack`, or `surrender`. Recorded in `HandRecord` for Human Players only.

**Bankroll** — Integer chip count. Persisted to DB for Human Players after each `RESOLVE`. Ephemeral for NPC Bots (reset to a fresh random bet amount each round).

**Stats** — Aggregate hand history for a Human Player: wins, losses, pushes, blackjacks, net profit. Computed from `HandRecord`. Does not include bot hands.

# Blackjack Domain Context

## Core Concepts

**Table** — A game room with a configured `minBet` and `maxBet`. Holds up to 6 seats. Created by a human player, persisted in the DB.

**Seat** — One player position at a table. Holds a hand, bet, bankroll, and outcome for the current round. Either occupied by a Human Player or an NPC Bot.

**Human Player** — An authenticated user with a persistent `User` row and bankroll in the DB. Their hands are recorded in `HandRecord`.

**NPC Bot** — A server-controlled player that auto-fills empty seats when a game starts. Has no DB row and no `HandRecord` writes. Persists across rounds in memory until the room is destroyed (all human players leave). Plays using the dealer mimic strategy.

**Dealer Mimic Strategy** — The NPC Bot play rule: reuse `dealerShouldHit()` from `Rules.ts`. Hit below 17, stand at hard/soft 17 or above.

**Round** — One complete deal-to-resolve cycle. Begins at `PLACE_BETS`, ends at `RESOLVE`. All seats (human and bot) participate in the same round.

**Turn Timer** — A 30-second server-side countdown per player turn during `PLAYER_TURNS` phase. On expiry the server auto-stands the active seat. The client shows a visible countdown to the active player.

**Surrender** — A player action available only as the first action on a 2-card hand (no hits taken). The player forfeits the round and receives half their escrowed bet back immediately. The seat's outcome is set to `surrender` before `DEALER_TURN`, so `resolve()` skips it.

**Double Down** — A player action available only on a 2-card hand when the player has enough bankroll to cover a second bet equal to the original. The bet is doubled (escrow deducted again), exactly one card is dealt, then the seat auto-stands. Settled like a normal win/loss/push at `RESOLVE`.

**Insurance** — A side bet offered to all human players when the dealer's upcard is an Ace. Each player independently accepts (up to half their main bet) or declines during `CHECK_INSURANCE`. The server tracks pending responses per player (`insurancePending`); NPC bots are excluded and never block the transition. Once all humans respond, the server peeks at the dealer's hole card rank directly (since `calculateHand` ignores face-down cards). If the dealer has blackjack, insurance winners are paid 2:1 and the round fast-paths to `DEALER_TURN`/`RESOLVE` without player turns. If not, insurance bets are lost and play continues normally.

**Hand Outcome** — The result of a seat's round: `win`, `loss`, `push`, `blackjack`, or `surrender`. Recorded in `HandRecord` for Human Players only.

**Bankroll** — Integer chip count. Persisted to DB for Human Players after each `RESOLVE`. In-memory only for NPC Bots — their bankroll updates during play but is never written to the DB and is lost when the room is destroyed.

**Stats** — Aggregate hand history for a Human Player: wins, losses, pushes, blackjacks, net profit. Computed from `HandRecord`. Does not include bot hands.

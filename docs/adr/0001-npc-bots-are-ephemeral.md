# ADR 0001: NPC Bots Are Ephemeral (No DB Rows)

## Status

Accepted

## Context

NPC Bots fill empty seats so a solo Human Player can start a game without waiting for others. The question is whether bots should have persistent `User` rows and `HandRecord` entries like human players, or exist only in memory.

## Decision

NPC Bots are fully ephemeral. They have no `User` row, no `GameSession`, and no `HandRecord` writes. They are created in `GameRoom` memory when `start_game` fires and discarded after `RESOLVE`.

## Consequences

- Stats (W/L/push/net profit) reflect only human play — no dilution from bot hands.
- No DB migrations needed to introduce or remove bots.
- Bots cannot accumulate a persistent bankroll; they bet a fresh random amount each round within the table's min/max range.
- If bot performance analytics are ever needed, this decision must be revisited.

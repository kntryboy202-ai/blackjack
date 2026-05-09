# ADR 0002: Insurance Peeks Hole Card Rank Directly

## Status

Accepted

## Context

During `CHECK_INSURANCE`, the server must determine whether the dealer holds a blackjack (Ace upcard + 10-value hole card) to resolve insurance bets and decide whether to skip player turns.

The existing `calculateHand()` function filters out face-down cards (`cards.filter(c => !c.faceDown)`), so calling it on the dealer's hand during `CHECK_INSURANCE` only sees the upcard. The hole card is drawn with `faceDown: true` and remains hidden until `runDealerTurn()` flips all cards.

Two alternatives were considered:

1. **Reveal the hole card early** — flip `faceDown = false` before checking, then re-hide it. Fragile and error-prone; risks leaking the value to clients if an emit fires mid-flip.
2. **Peek at the hole card rank directly** — read `dealer.hand[1].rank` without changing `faceDown`. Since the insurance check only occurs when the upcard is Ace, a BJ requires the hole card rank to be `10`, `J`, `Q`, or `K`.

## Decision

Peek at the hole card rank directly in `GameRoom.peekDealerBlackjack()`:

```ts
private peekDealerBlackjack(): boolean {
  const holeCard = this.dealer.hand[1];
  if (!holeCard) return false;
  const r = holeCard.rank;
  return r === "10" || r === "J" || r === "Q" || r === "K";
}
```

This method is called only from `processInsuranceBets()`, which runs server-side only and does not emit state between the peek and the reveal.

## Consequences

- The hole card is never mutated before `runDealerTurn()` reveals it, so no race condition with emitted snapshots.
- The logic is constrained to a single private method; callers don't need to know the implementation.
- The method only makes sense when the upcard is Ace (the only time `CHECK_INSURANCE` is entered). If the phase logic ever changes, `peekDealerBlackjack()` must be updated accordingly.

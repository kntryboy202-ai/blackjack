# Context from claude mobile sessions

You are a software engineer.  Scaffold out a spec.md file for a blackjack app using nodejs 24 react 19 and the most reasonable database system or graphic.  Grill me on relevant questions as necessary.

Let me ask you the key questions before writing a spec that's actually useful.

**Core gameplay questions:**

1. **Single player or multiplayer?** (Just you vs. dealer, or multiple human players at the same table?)

2. **Persistence** — do you want to track things like player bankroll/chips across sessions, win/loss history, or is each session disposable?

3. **Auth** — do you need user accounts/login, or is this a guest/anonymous experience?

4. **Betting system** — real chip wagering mechanics (with a starting bankroll), or just pure card game with no stakes?

**Scope questions:**

5. **Deployment target** — local dev toy, or something you'd actually host (and where — Vercel, VPS, etc.)?

6. **Casino rule variants** — do you care about: split, double-down, insurance, surrender? Or just basic hit/stand/bust?

7. **Visual style** — functional/clean UI, or do you want a felt-table casino aesthetic with card animations?

8. **AI dealer behavior** — standard "dealer hits on soft 16, stands on 17" house rules, or configurable?

One answer that's easy to give upfront: for a Node 24 + React 19 app, **SQLite via Prisma** is the most reasonable DB choice if you want persistence — zero-infra, file-based, works great locally and on a VPS. If this is purely stateless (no accounts, no history), you can skip a DB entirely and keep game state in memory/React state.

What are your answers?

1. Multi-player
2. Track the items you mentioned
3. User accounts with logins
4. Real chip mechanics with a bankroll
5. Start as local dev toy with intentions to host via vps
6. I do care about all of those things
7. Felt table with card animations
8. lets start with standard house rules.

Great answers. A few follow-up questions specifically unlocked by your choices:

**Multiplayer specifics:**

1. **How many players at a table?** (Typical casino is 2–7 human players + dealer. Do you want a lobby/table system where players join, or just a fixed seat count?)
2. **Real-time sync** — players need to see each other's actions live. I'm going to use **WebSockets (Socket.io)**. Any objection, or does that sound right to you?
3. **Turn order** — standard blackjack has players act sequentially left-to-right before the dealer. Should there be a **turn timer** (e.g. 30s to act or auto-stand)?

**Accounts & Bankroll:**
4. **Starting bankroll** — how many chips does a new account get? (e.g. $1,000 play money)
5. **Replenishment** — if a player goes broke, do they get a free refill, or is that a permanent loss state?
6. **Auth method** — username/password only, or do you also want OAuth (Google, GitHub, etc.)?

**Table rules:**
7. **How many decks** in the shoe? (1, 2, 4, 6, or 8 — affects card counting viability and house edge)
8. **Minimum/maximum bet** — e.g. $10 min, $500 max per hand?

**Visuals:**
9. **Card animation fidelity** — CSS transitions (lightweight, snappy) or something richer like **Framer Motion**? This affects complexity meaningfully.

1. Lobby system with configurable npc player count.
2. Sounds good.
3. Yes.  But make it configurable.
4. $1000
5. Free refill
6. both
7. start with 6 but make it configurable
8. min=$1 and max =$500
9. let's start with css transitions if it's less complex.

Perfect. I have everything I need. Let me write this up.Here's your spec. A few highlights worth calling out:

**Key architectural decisions baked in:**

- **Monorepo with pnpm workspaces** — `packages/client` and `packages/server` share types cleanly
- **SQLite → PostgreSQL swap** is a single `DATABASE_URL` change via Prisma, no code changes needed
- **Socket.io shares the Express session** via `passport.socketio` — auth is consistent across HTTP and WebSocket
- **Chips are integers** (no floats) — avoids floating point money bugs entirely

**The game state machine** is the core of the server. Every socket event is just a transition trigger — `GameRoom.ts` owns all state, clients only receive snapshots.

**NPC basic strategy** will be a lookup table (hard totals 8–17, soft totals, pairs) — well-documented in public domain, easy to implement as a JSON map.

**Suggested first coding session:** Start with `Deck.ts` → `Hand.ts` → `Rules.ts` in isolation with unit tests before touching any socket or UI code. The game engine being rock-solid is load-bearing for everything else.

Want me to scaffold the actual code for any specific phase or file next?
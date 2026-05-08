# Blackjack App — Project Specification

## Overview

A real-time multiplayer blackjack web application with full casino rules, user accounts, chip bankrolls, a felt-table UI, and NPC support. Built for local dev with a clear path to VPS deployment.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 24 | LTS, native `fetch`, improved ESM |
| Frontend | React 19 | Concurrent features, `use()` hook, Server Actions |
| Styling | CSS Modules + custom properties | Zero runtime cost, animation-friendly |
| Animations | CSS transitions (keyframes) | Low complexity, snappy card dealing |
| Real-time | Socket.io 4.x | Rooms, namespaces, reconnection built-in |
| HTTP/API | Express 5.x | Minimal, pairs cleanly with Socket.io |
| ORM | Prisma 5.x | Type-safe, great DX, migration system |
| Database | SQLite (dev) → PostgreSQL (prod) | File-based locally; swap via `DATABASE_URL` for VPS |
| Auth | Passport.js (local + OAuth) | Username/password + Google/GitHub strategies |
| Session | express-session + connect-pg-simple | Persistent sessions, works with both DBs |
| Build | Vite 6 | Fast HMR, React 19 support |
| Package Mgr | pnpm | Workspace support for monorepo |

---

## Repository Structure

```
blackjack/
├── packages/
│   ├── client/                  # React 19 frontend (Vite)
│   │   ├── src/
│   │   │   ├── assets/          # Card SVGs, felt textures, sounds
│   │   │   ├── components/
│   │   │   │   ├── Table/       # Felt table layout
│   │   │   │   ├── Card/        # Card face/back + flip animation
│   │   │   │   ├── Hand/        # Player/dealer hand container
│   │   │   │   ├── Chip/        # Chip stack + bet UI
│   │   │   │   ├── Lobby/       # Room browser + create table
│   │   │   │   ├── Auth/        # Login, register, OAuth buttons
│   │   │   │   └── HUD/         # Bankroll, timer, action buttons
│   │   │   ├── hooks/
│   │   │   │   ├── useSocket.ts
│   │   │   │   ├── useGameState.ts
│   │   │   │   └── useAuth.ts
│   │   │   ├── store/           # Zustand global state
│   │   │   ├── pages/
│   │   │   │   ├── HomePage.tsx
│   │   │   │   ├── LobbyPage.tsx
│   │   │   │   ├── TablePage.tsx
│   │   │   │   └── ProfilePage.tsx
│   │   │   └── styles/
│   │   │       ├── globals.css
│   │   │       └── tokens.css   # Design tokens (felt green, card cream, etc.)
│   │   └── vite.config.ts
│   │
│   └── server/                  # Express + Socket.io backend
│       ├── src/
│       │   ├── config/
│       │   │   ├── db.ts        # Prisma client
│       │   │   └── passport.ts  # Auth strategies
│       │   ├── game/
│       │   │   ├── Deck.ts      # Shoe builder, shuffle, configurable deck count
│       │   │   ├── Hand.ts      # Hand value calculation (soft/hard aces)
│       │   │   ├── Rules.ts     # House rules engine
│       │   │   ├── NPC.ts       # NPC decision logic (basic strategy table)
│       │   │   └── GameRoom.ts  # Full game state machine
│       │   ├── socket/
│       │   │   ├── handlers.ts  # Socket event handlers
│       │   │   └── middleware.ts
│       │   ├── routes/
│       │   │   ├── auth.ts      # /api/auth/*
│       │   │   ├── lobby.ts     # /api/lobby/*
│       │   │   └── profile.ts   # /api/profile/*
│       │   └── index.ts         # App entry point
│       └── prisma/
│           ├── schema.prisma
│           └── migrations/
│
├── pnpm-workspace.yaml
├── .env.example
└── README.md
```

---

## Database Schema (Prisma)

```prisma
model User {
  id            String    @id @default(cuid())
  username      String    @unique
  email         String    @unique
  passwordHash  String?   // null for OAuth-only accounts
  provider      String?   // "google" | "github" | null
  providerId    String?
  bankroll      Int       @default(1000)  // in chips (cents-style integer)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions      GameSession[]
  hands         HandRecord[]
}

model GameSession {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  tableId     String
  startedAt   DateTime  @default(now())
  endedAt     DateTime?
  netChips    Int       @default(0)   // positive = won, negative = lost

  hands       HandRecord[]
}

model HandRecord {
  id            String      @id @default(cuid())
  sessionId     String
  session       GameSession @relation(fields: [sessionId], references: [id])
  userId        String
  user          User        @relation(fields: [userId], references: [id])
  betAmount     Int
  outcome       String      // "win" | "loss" | "push" | "blackjack" | "surrender"
  playerCards   String      // JSON array of card codes
  dealerCards   String      // JSON array of card codes
  actions       String      // JSON array: ["hit","hit","stand"]
  playedAt      DateTime    @default(now())
}

model Table {
  id            String    @id @default(cuid())
  name          String
  deckCount     Int       @default(6)
  minBet        Int       @default(1)
  maxBet        Int       @default(500)
  maxPlayers    Int       @default(6)
  npcCount      Int       @default(0)
  turnTimerSecs Int       @default(30)
  isPrivate     Boolean   @default(false)
  createdAt     DateTime  @default(now())
}
```

---

## Game Rules Engine

### Standard House Rules (configurable per table)

| Rule | Default | Configurable |
|---|---|---|
| Decks in shoe | 6 | Yes (1, 2, 4, 6, 8) |
| Dealer hits on | Soft 16 | Yes (v1) |
| Dealer stands on | Hard/Soft 17 | Yes (v1) |
| Blackjack pays | 3:2 | No (v1) |
| Split allowed | Yes | No (v1) |
| Double down | Yes (any 2 cards) | No (v1) |
| Insurance | Yes | No (v1) |
| Surrender | Yes (late) | No (v1) |
| Min bet | $1 | Yes |
| Max bet | $500 | Yes |
| Turn timer | 30s | Yes |
| NPC players | 0 | Yes (0–6) |

### Player Actions

- **Hit** — draw a card
- **Stand** — end turn
- **Double Down** — double bet, draw exactly one card, stand
- **Split** — available on matching rank pairs; creates two independent hands
- **Insurance** — side bet (half of original) when dealer shows Ace; pays 2:1 if dealer has blackjack
- **Surrender** — forfeit hand, recover half the bet (late surrender only)

### Hand Value Rules

- Numbered cards = face value
- Face cards (J, Q, K) = 10
- Ace = 11 unless hand would bust, then 1 (soft vs. hard hand tracking required)
- Blackjack = Ace + 10-value on initial deal only

### NPC Behavior

- Uses **dealer mimic strategy** — reuses `dealerShouldHit()` from `Rules.ts`: hit below 17, stand at hard/soft 17 or above
- NPC acts after a randomized delay (800–1200ms) to simulate human timing
- NPC bankroll is in-memory only — not persisted to DB, lost when the room is destroyed
- NPCs auto-fill empty seats when the host fires `start_game` (random count: 3–6 total seats)

---

## Game State Machine

```
WAITING_FOR_PLAYERS
      ↓  (all seated, host starts)
PLACE_BETS          ← each player places bet (timer enforced)
      ↓
DEALING             ← 2 cards each, dealer 1 face-up 1 face-down
      ↓
CHECK_INSURANCE     ← only if dealer shows Ace
      ↓
PLAYER_TURNS        ← sequential left-to-right, timer per turn
      ↓
DEALER_TURN         ← dealer flips hole card, hits until 17+
      ↓
RESOLVE             ← compare hands, pay/collect chips
      ↓
ROUND_END           ← show results, update bankrolls
      ↓ (auto-advance after 5s)
PLACE_BETS          ← next round (or back to WAITING if players leave)
```

---

## Real-Time Socket Events

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join_table` | `{ tableId, userId }` | Join a game room |
| `leave_table` | `{ tableId }` | Leave room |
| `place_bet` | `{ amount }` | Submit bet during betting phase |
| `action` | `{ type: 'hit'\|'stand'\|'double'\|'split'\|'insurance'\|'surrender' }` | Player action during their turn |
| `start_game` | — | Host triggers game start |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `game_state` | Full `GameRoom` snapshot | Sent on join and after every state change |
| `card_dealt` | `{ seat, card, faceDown }` | Triggers card deal animation |
| `turn_start` | `{ seat, timeoutSecs }` | Whose turn + timer |
| `turn_timeout` | `{ seat }` | Player auto-stood |
| `round_result` | `{ results[] }` | Per-seat outcome + chip delta |
| `bankroll_update` | `{ userId, newBankroll }` | After chips are settled |
| `player_joined` | `{ seat, username }` | Lobby/table update |
| `player_left` | `{ seat }` | Lobby/table update |
| `error` | `{ message }` | Auth/rule violations |

---

## Auth Flow

### Local (username + password)

1. `POST /api/auth/register` — hash password with bcrypt (cost 12), create User
2. `POST /api/auth/login` — Passport local strategy, issue session cookie
3. `POST /api/auth/logout` — destroy session

### OAuth (Google / GitHub)

1. `GET /api/auth/google` → redirect to Google consent
2. `GET /api/auth/google/callback` → upsert User, issue session
3. Same flow for GitHub

### Session

- `express-session` with SQLite store (dev) / `connect-pg-simple` (prod)
- Cookie: `httpOnly`, `sameSite: lax`, 7-day expiry
- Socket.io middleware shares the same session (passport socket.io)

---

## Bankroll Rules

| Condition | Behavior |
|---|---|
| New account | Start with 1,000 chips |
| Win | Chips added immediately after `RESOLVE` phase |
| Loss | Chips deducted at `PLACE_BETS` (bet is escrowed) |
| Bankroll hits 0 | Prompt shown: "You're broke! Claim your free refill." |
| Free refill | Resets bankroll to 1,000; recorded in DB; no limit on refills (v1) |
| Blackjack payout | 1.5× bet (3:2) |
| Insurance win | 2:1 on insurance side bet |
| Push | Bet returned, no chips gained or lost |
| Surrender | Half bet returned |

---

## UI / Visual Design

### Aesthetic

- **Deep casino felt green** (`#1a5c35`) table surface with subtle noise texture
- **Card cream** (`#f5f0e8`) card faces with classic serif suit symbols
- **Gold accents** (`#c9a84c`) for chip stacks, bet rings, win highlights
- Dark walnut rail framing the table edge
- Ambient low-light atmosphere (dark vignette on table edges)

### Design Tokens (`tokens.css`)

```css
:root {
  --felt-green: #1a5c35;
  --felt-dark: #0f3d22;
  --card-face: #f5f0e8;
  --card-back: #1a2744;
  --chip-gold: #c9a84c;
  --chip-red: #c0392b;
  --chip-blue: #2980b9;
  --rail-brown: #3d1f0a;
  --text-primary: #f0e6d3;
  --text-dim: #8a7a6a;
  --win-glow: #f1c40f;
  --bust-red: #e74c3c;
}
```

### Card Animations (CSS transitions)

| Action | Animation |
|---|---|
| Deal | Card slides from center-top to seat position (300ms ease-out) |
| Flip (hole card) | `rotateY(180deg)` with backface visibility (400ms) |
| Hit | Card slides in from deck position |
| Bust | Card hand shakes + red flash (200ms) |
| Win | Hand glows gold + chips slide to player (500ms) |
| Blackjack | Cards fan out + sparkle pulse |

### Pages

**`/`** — Landing page: logo, login/register CTA, brief explainer

**`/lobby`** — Table browser

- List of open tables (name, seats taken, min/max bet)
- "Create Table" modal with configurable options (deck count, NPC count, timer, bet limits, privacy)
- Join button → redirects to `/table/:id`

**`/table/:id`** — The game

- Felt table with 7 seat positions arranged in a semicircle
- Dealer area at top center
- Action button strip (Hit / Stand / Double / Split / Insurance / Surrender) — context-aware, only active actions shown
- Bet UI: draggable chip denominations ($1 $5 $25 $100 $500) onto bet circle
- Timer ring around active player's nameplate
- Bankroll display (top-right HUD)
- Chat sidebar (v2 — placeholder in v1)

**`/profile`** — Stats page

- Total hands played, win rate, biggest win, net chips all-time
- Recent hand history table
- Bankroll history chart (recharts line chart)

---

## Configuration (`.env`)

```env
# App
NODE_ENV=development
PORT=3001
CLIENT_URL=http://localhost:5173
SESSION_SECRET=change_me_in_production

# Database
DATABASE_URL=file:./dev.db          # SQLite for dev
# DATABASE_URL=postgresql://...     # Uncomment for prod

# OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Game Defaults (overridable per table)
DEFAULT_DECK_COUNT=6
DEFAULT_MIN_BET=1
DEFAULT_MAX_BET=500
DEFAULT_TURN_TIMER=30
DEFAULT_NPC_COUNT=0
STARTING_BANKROLL=1000
```

---

## API Routes

### Auth

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/auth/google
GET    /api/auth/google/callback
GET    /api/auth/github
GET    /api/auth/github/callback
```

### Lobby

```
GET    /api/lobby/tables          # List open tables
POST   /api/lobby/tables          # Create table
GET    /api/lobby/tables/:id      # Table metadata
DELETE /api/lobby/tables/:id      # Close table (host only)
```

### Profile

```
GET    /api/profile/:userId       # Public stats
GET    /api/profile/:userId/hands # Hand history (paginated)
POST   /api/profile/refill        # Claim free bankroll refill
```

---

## Development Phases

### Phase 1 — Foundation ✅ Shipped

- [x] Monorepo setup (pnpm workspaces)
- [x] Prisma schema + SQLite migrations
- [x] Express server + Socket.io wiring
- [x] Auth (local + GitHub OAuth)
- [x] Game engine: `Deck`, `Hand`, `Rules`, `GameRoom` state machine (hit/stand/bust/blackjack/push)
- [x] Bankroll escrow + settlement at `RESOLVE`
- [x] Minimal React table UI

### Phase 2 — Show-Ready Polish ✅ Shipped

- [x] Felt table visual design + CSS design tokens
- [x] Card deal animation (slide-in with staggered `dealIndex`)
- [x] Lobby page + table creation
- [x] `HandRecord` persistence after each resolved round
- [x] `GameSession` open/close tracking

### Phase 3 — NPC Bots + Turn Timer ✅ Shipped

- [x] `fillBotsForStart()` — auto-fills 3–6 total seats with named NPC bots on `start_game`
- [x] Bots play dealer mimic strategy with 800–1200ms artificial delay
- [x] Bots bet randomly within table min/max; persist across rounds until room is destroyed
- [x] 30-second turn timer with auto-stand on expiry
- [x] Client-side countdown per active human seat (turns red at ≤5s)

### Phase 4 — Full Player Actions

- [ ] Split (matching rank pairs → two independent hands)
- [ ] Double down (double bet, one card, auto-stand)
- [ ] Surrender (forfeit hand, recover half bet)
- [ ] Insurance (side bet when dealer shows Ace)

### Phase 5 — Profile & History

- [ ] Profile stats page (win rate, net chips, biggest win)
- [ ] Hand history table (paginated)
- [ ] Bankroll history chart (recharts)

### Phase 6 — VPS Deployment

- [ ] Swap SQLite → PostgreSQL
- [ ] Docker Compose (app + db)
- [ ] Nginx reverse proxy config
- [ ] Environment hardening (HTTPS, secure cookies, rate limiting)
- [ ] PM2 or systemd process management

---

## Out of Scope (v1)

- Real money / payment processing
- Card counting detection
- Chat system
- Tournament / leaderboard mode
- Mobile-native app
- Multiple simultaneous tables per user
- Admin dashboard
- Email verification / password reset (v2)
- Card count display (configurable to be hidden)
- Basic strategy best move display (configurable to be hidden)

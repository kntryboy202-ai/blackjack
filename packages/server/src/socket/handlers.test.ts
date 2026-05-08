// ABOUTME: Integration tests for Socket.io handlers covering auth rejection and game flow.
// ABOUTME: Uses real HTTP login to obtain session cookies for authenticated socket connections.

import { execSync } from "node:child_process";
import path from "node:path";
import { type Socket as ClientSocket, io as ioClient } from "socket.io-client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Push schema to test.db before importing the app
beforeAll(() => {
  execSync(
    "./node_modules/.bin/prisma db push --schema=./prisma/schema.prisma --force-reset --skip-generate",
    {
      cwd: path.resolve(__dirname, "../../"),
      env: { ...process.env, DATABASE_URL: "file:./test.db" },
      stdio: "inherit",
    }
  );
});

// Import after env setup
import { db } from "../config/db.js";
import { app, httpServer, io } from "../index.js";
import { rooms } from "./handlers.js";

const TEST_USER = {
  username: "sockettest",
  email: "socket@test.com",
  password: "SecurePass123!",
};

let serverPort: number;
let sessionCookie: string;
let tableId: string;

afterAll(async () => {
  // Close server and disconnect Socket.io
  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  await db.$disconnect();
});

beforeAll(async () => {
  // Start the HTTP server on a random port
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      serverPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });

  // Register and log in the test user to get a session cookie
  await request(app).post("/api/auth/register").send(TEST_USER);
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ email: TEST_USER.email, password: TEST_USER.password });

  const rawCookies = loginRes.headers["set-cookie"] as string[] | string;
  const cookieArray = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
  // Extract only the key=value part from each Set-Cookie header (strip path/httponly/etc.)
  sessionCookie = cookieArray
    .map((c) => c.split(";")[0])
    .filter(Boolean)
    .join("; ");

  // Create a test table via the lobby API
  const tableRes = await request(app).post("/api/lobby/tables").set("Cookie", cookieArray).send({
    name: "Test Table",
    deckCount: 1,
    minBet: 1,
    maxBet: 500,
  });
  tableId = tableRes.body.id as string;
});

beforeEach(async () => {
  // Clear rooms between tests to avoid state bleed
  rooms.clear();
});

function connectSocket(cookie?: string): ClientSocket {
  return ioClient(`http://localhost:${serverPort}`, {
    extraHeaders: cookie ? { cookie } : {},
    // Force new connection each time
    forceNew: true,
    // Disable auto-reconnect for cleaner test teardown
    reconnection: false,
  });
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function waitForConnect(socket: ClientSocket, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Socket connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    if (socket.connected) {
      clearTimeout(timer);
      resolve();
      return;
    }
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("Socket.io authentication", () => {
  it("unauthenticated connection is rejected with 'Authentication required'", async () => {
    const socket = connectSocket(); // no cookie
    await expect(waitForConnect(socket)).rejects.toThrow();
    socket.disconnect();
  });

  it("authenticated connection succeeds", async () => {
    const socket = connectSocket(sessionCookie);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    socket.disconnect();
  });
});

describe("Socket.io join_table", () => {
  let socket: ClientSocket;

  afterEach(() => {
    if (socket.connected) socket.disconnect();
  });

  it("join_table emits game_state back to the joining socket", async () => {
    socket = connectSocket(sessionCookie);
    await waitForConnect(socket);

    const gameStatePromise = waitForEvent<{ phase: string; tableId: string }>(socket, "game_state");
    socket.emit("join_table", { tableId });

    const state = await gameStatePromise;
    expect(state.tableId).toBe(tableId);
    expect(state.phase).toBe("WAITING_FOR_PLAYERS");
  });

  it("join_table includes the joining player in the seats list", async () => {
    socket = connectSocket(sessionCookie);
    await waitForConnect(socket);

    const gameStatePromise = waitForEvent<{ seats: { username: string }[] }>(socket, "game_state");
    socket.emit("join_table", { tableId });

    const state = await gameStatePromise;
    expect(state.seats).toHaveLength(1);
    expect(state.seats[0]?.username).toBe(TEST_USER.username);
  });
});

describe("Socket.io start_game", () => {
  let socket: ClientSocket;

  afterEach(() => {
    if (socket.connected) socket.disconnect();
  });

  it("start_game transitions state to PLACE_BETS", async () => {
    socket = connectSocket(sessionCookie);
    await waitForConnect(socket);

    // Join the table first
    const joinedState = waitForEvent(socket, "game_state");
    socket.emit("join_table", { tableId });
    await joinedState;

    // Collect game_state events and wait for PLACE_BETS
    const placeBetsPromise = new Promise<{ phase: string }>((resolve) => {
      socket.on("game_state", (state: { phase: string }) => {
        if (state.phase === "PLACE_BETS") resolve(state);
      });
    });

    socket.emit("start_game");
    const state = await placeBetsPromise;
    expect(state.phase).toBe("PLACE_BETS");
  });
});

describe("Socket.io place_bet", () => {
  let socket: ClientSocket;

  afterEach(() => {
    if (socket.connected) socket.disconnect();
  });

  it("place_bet with valid amount updates game state", async () => {
    socket = connectSocket(sessionCookie);
    await waitForConnect(socket);

    // Join and start game
    const initialState = waitForEvent(socket, "game_state");
    socket.emit("join_table", { tableId });
    await initialState;

    // Start game and wait for PLACE_BETS
    const placeBetsState = new Promise<void>((resolve) => {
      socket.on("game_state", (state: { phase: string }) => {
        if (state.phase === "PLACE_BETS") resolve();
      });
    });
    socket.emit("start_game");
    await placeBetsState;

    // Place a bet and capture state transitions
    const betPlacedPromise = new Promise<{ seats: { bet: number }[] }>((resolve) => {
      socket.on("game_state", (state: { phase: string; seats: { bet: number }[] }) => {
        // State after bet is placed — dealing or player turns
        if (state.phase !== "PLACE_BETS" && state.seats[0]?.bet > 0) {
          resolve(state);
        }
      });
    });

    socket.emit("place_bet", { amount: 50 });
    const afterBet = await betPlacedPromise;
    expect(afterBet.seats[0]?.bet).toBe(50);
  });
});

describe("Socket.io leave_table", () => {
  let socket: ClientSocket;

  afterEach(() => {
    if (socket.connected) socket.disconnect();
  });

  it("leave_table removes the player from the room", async () => {
    socket = connectSocket(sessionCookie);
    await waitForConnect(socket);

    const joinedState = waitForEvent(socket, "game_state");
    socket.emit("join_table", { tableId });
    await joinedState;

    // Collect game_state after leaving
    const afterLeavePromise = new Promise<{ seats: unknown[] }>((resolve) => {
      socket.on("game_state", (state: { seats: unknown[] }) => {
        resolve(state);
      });
    });

    socket.emit("leave_table");
    const afterLeave = await afterLeavePromise;
    expect(afterLeave.seats).toHaveLength(0);
  });

  it("start_game auto-fills bots so table has at least 3 seats", async () => {
    socket = connectSocket(sessionCookie);
    await waitForConnect(socket);

    const joinedState = waitForEvent(socket, "game_state");
    socket.emit("join_table", { tableId });
    await joinedState;

    socket.emit("start_game");

    // Wait for a game_state snapshot where bots have appeared (PLACE_BETS)
    const stateWithBots = await new Promise<{ seats: Array<{ isNpc: boolean }> }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout waiting for bots")), 5000);
        socket.on("game_state", (state: { seats: Array<{ isNpc: boolean }>; phase: string }) => {
          if (state.phase === "PLACE_BETS" && state.seats.length >= 3) {
            clearTimeout(timer);
            resolve(state);
          }
        });
      }
    );

    expect(stateWithBots.seats.length).toBeGreaterThanOrEqual(3);
    const botSeats = stateWithBots.seats.filter((s) => s.isNpc);
    expect(botSeats.length).toBeGreaterThanOrEqual(2);
  });
});

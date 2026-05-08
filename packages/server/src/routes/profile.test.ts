// ABOUTME: Integration tests for profile routes — stats aggregation and hand history.
// ABOUTME: Uses a real SQLite test.db (no mocks) via supertest.

import { execSync } from "node:child_process";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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

import { db } from "../config/db.js";
import { app } from "../index.js";

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.handRecord.deleteMany();
  await db.gameSession.deleteMany();
  await db.user.deleteMany();
});

async function createUserAndSession() {
  const user = await db.user.create({
    data: { username: "statuser", email: "stats@example.com", bankroll: 1000 },
  });
  const session = await db.gameSession.create({
    data: { userId: user.id, tableId: "table-fake" },
  });
  return { user, session };
}

describe("GET /api/profile/:userId/stats", () => {
  it("returns zeros for a user with no hand records", async () => {
    const { user } = await createUserAndSession();

    const res = await request(app).get(`/api/profile/${user.id}/stats`).expect(200);

    expect(res.body).toMatchObject({
      wins: 0,
      losses: 0,
      pushes: 0,
      blackjacks: 0,
      netProfit: 0,
    });
  });

  it("counts wins, losses, pushes, and blackjacks correctly", async () => {
    const { user, session } = await createUserAndSession();

    await db.handRecord.createMany({
      data: [
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "win",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "win",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "loss",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "push",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "blackjack",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
      ],
    });

    const res = await request(app).get(`/api/profile/${user.id}/stats`).expect(200);

    expect(res.body.wins).toBe(2);
    expect(res.body.losses).toBe(1);
    expect(res.body.pushes).toBe(1);
    expect(res.body.blackjacks).toBe(1);
  });

  it("computes netProfit correctly across outcomes", async () => {
    const { user, session } = await createUserAndSession();

    await db.handRecord.createMany({
      data: [
        // win: +50
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "win",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
        // blackjack: +75 (floor(50 * 1.5))
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "blackjack",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
        // loss: -50
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "loss",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
        // push: 0
        {
          sessionId: session.id,
          userId: user.id,
          betAmount: 50,
          outcome: "push",
          playerCards: "[]",
          dealerCards: "[]",
          actions: "[]",
        },
      ],
    });

    const res = await request(app).get(`/api/profile/${user.id}/stats`).expect(200);

    // +50 + 75 - 50 + 0 = 75
    expect(res.body.netProfit).toBe(75);
  });

  it("returns 404 for an unknown userId", async () => {
    await request(app).get("/api/profile/nonexistent-id/stats").expect(404);
  });
});

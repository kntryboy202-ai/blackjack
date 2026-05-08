// ABOUTME: Integration tests for auth routes: register, login, logout, and session check.
// ABOUTME: Uses a real SQLite test.db database (no mocks) via supertest against the full Express app.
import { execSync } from "node:child_process";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Push schema to test.db before importing the app (which loads the db singleton)
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
// Import app AFTER env is set by vitest.config.ts and after db push
// eslint-disable-next-line import/first
import { app } from "../index.js";

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await db.user.deleteMany();
});

const validUser = {
  username: "testuser",
  email: "test@example.com",
  password: "SecurePass123!",
};

describe("POST /api/auth/register", () => {
  it("creates a user with valid fields and returns 201 with id, username, email (no passwordHash)", async () => {
    const res = await request(app).post("/api/auth/register").send(validUser).expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      username: validUser.username,
      email: validUser.email,
    });
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.password).toBeUndefined();
  });

  it("returns 409 when username is already taken", async () => {
    await request(app).post("/api/auth/register").send(validUser).expect(201);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...validUser, email: "other@example.com" })
      .expect(409);

    expect(res.body.error).toBeDefined();
  });

  it("returns 409 when email is already taken", async () => {
    await request(app).post("/api/auth/register").send(validUser).expect(201);

    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...validUser, username: "otherusername" })
      .expect(409);

    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when required fields are missing", async () => {
    await request(app).post("/api/auth/register").send({ username: "incomplete" }).expect(400);

    await request(app).post("/api/auth/register").send({ email: "a@b.com" }).expect(400);

    await request(app)
      .post("/api/auth/register")
      .send({ username: "u", email: "u@u.com" })
      .expect(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    // Register a user to log in with
    await request(app).post("/api/auth/register").send(validUser).expect(201);
  });

  it("returns 200 with user object and sets session cookie on valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: validUser.email, password: validUser.password })
      .expect(200);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      username: validUser.username,
      email: validUser.email,
      bankroll: expect.any(Number),
    });
    expect(res.body.passwordHash).toBeUndefined();

    // Should set a session cookie
    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(Array.isArray(cookies) ? cookies.join("") : cookies).toContain("connect.sid");
  });

  it("returns 401 with wrong password", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ email: validUser.email, password: "wrongpassword" })
      .expect(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 when not authenticated", async () => {
    await request(app).get("/api/auth/me").expect(401);
  });

  it("returns 200 with user data when authenticated", async () => {
    await request(app).post("/api/auth/register").send(validUser).expect(201);

    // Log in and capture the session cookie
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: validUser.email, password: validUser.password })
      .expect(200);

    const cookies = loginRes.headers["set-cookie"] as unknown as string[];
    expect(cookies).toBeDefined();

    const meRes = await request(app).get("/api/auth/me").set("Cookie", cookies).expect(200);

    expect(meRes.body).toMatchObject({
      id: expect.any(String),
      username: validUser.username,
      email: validUser.email,
      bankroll: expect.any(Number),
    });
    expect(meRes.body.passwordHash).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  it("logs out and subsequent GET /me returns 401", async () => {
    await request(app).post("/api/auth/register").send(validUser).expect(201);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: validUser.email, password: validUser.password })
      .expect(200);

    const cookies = loginRes.headers["set-cookie"] as unknown as string[];

    // Confirm we are logged in
    await request(app).get("/api/auth/me").set("Cookie", cookies).expect(200);

    // Logout
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookies)
      .expect(200);

    expect(logoutRes.body).toMatchObject({ ok: true });

    // Should no longer be authenticated
    await request(app).get("/api/auth/me").set("Cookie", cookies).expect(401);
  });
});

// ABOUTME: Lobby routes for listing, creating, and managing game tables.
// ABOUTME: Requires authentication for table creation and deletion.
import { type Request, type Response, Router } from "express";
import { db } from "../config/db.js";

export const lobbyRouter = Router();

function requireAuth(req: Request, res: Response): boolean {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "not authenticated" });
    return false;
  }
  return true;
}

lobbyRouter.get("/tables", async (_req: Request, res: Response) => {
  try {
    const tables = await db.table.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(tables);
  } catch (err) {
    console.error("get tables error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

lobbyRouter.post("/tables", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const { name, deckCount, minBet, maxBet, maxPlayers, npcCount, turnTimerSecs, isPrivate } =
    req.body as {
      name?: string;
      deckCount?: number;
      minBet?: number;
      maxBet?: number;
      maxPlayers?: number;
      npcCount?: number;
      turnTimerSecs?: number;
      isPrivate?: boolean;
    };

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const table = await db.table.create({
      data: {
        name,
        deckCount: deckCount ?? 6,
        minBet: minBet ?? 1,
        maxBet: maxBet ?? 500,
        maxPlayers: maxPlayers ?? 6,
        npcCount: npcCount ?? 0,
        turnTimerSecs: turnTimerSecs ?? 30,
        isPrivate: isPrivate ?? false,
      },
    });
    res.status(201).json(table);
  } catch (err) {
    console.error("create table error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

lobbyRouter.get("/tables/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try {
    const table = await db.table.findUnique({ where: { id } });
    if (!table) {
      res.status(404).json({ error: "table not found" });
      return;
    }
    res.json(table);
  } catch (err) {
    console.error("get table error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

lobbyRouter.delete("/tables/:id", async (req: Request, res: Response) => {
  if (!requireAuth(req, res)) return;

  const id = String(req.params.id);
  try {
    const table = await db.table.findUnique({ where: { id } });
    if (!table) {
      res.status(404).json({ error: "table not found" });
      return;
    }
    await db.table.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("delete table error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

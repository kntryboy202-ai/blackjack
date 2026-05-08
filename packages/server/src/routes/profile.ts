// ABOUTME: Profile routes for user stats, hand history, and bankroll refill.
// ABOUTME: Refill resets bankroll to 1000 chips; no limit on refills in v1.
import { type Request, type Response, Router } from "express";
import { db } from "../config/db.js";
import { chipDelta } from "../game/Rules.js";

export const profileRouter = Router();

type AuthUser = {
  id: string;
  username: string;
  email: string;
  bankroll: number;
};

const PAGE_SIZE = 50;

profileRouter.get("/:userId", async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, bankroll: true, createdAt: true },
    });
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    console.error("get profile error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

profileRouter.get("/:userId/hands", async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const page = Math.max(1, Number(req.query.page ?? 1));
  const skip = (page - 1) * PAGE_SIZE;

  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    const hands = await db.handRecord.findMany({
      where: { userId },
      orderBy: { playedAt: "desc" },
      skip,
      take: PAGE_SIZE,
    });
    res.json({ hands, page, pageSize: PAGE_SIZE });
  } catch (err) {
    console.error("get hands error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

profileRouter.get("/:userId/stats", async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    const records = await db.handRecord.findMany({
      where: { userId },
      select: { outcome: true, betAmount: true },
    });

    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let blackjacks = 0;
    let netProfit = 0;

    for (const r of records) {
      const outcome = r.outcome as "win" | "loss" | "push" | "blackjack" | "surrender";
      switch (outcome) {
        case "win":
          wins++;
          break;
        case "loss":
          losses++;
          break;
        case "push":
          pushes++;
          break;
        case "blackjack":
          blackjacks++;
          break;
      }
      netProfit += chipDelta(outcome, r.betAmount);
    }

    res.json({ wins, losses, pushes, blackjacks, netProfit });
  } catch (err) {
    console.error("get stats error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

profileRouter.post("/refill", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }

  const { id } = req.user as AuthUser;

  try {
    const user = await db.user.update({
      where: { id },
      data: { bankroll: 1000 },
      select: { id: true, username: true, email: true, bankroll: true },
    });
    res.json(user);
  } catch (err) {
    console.error("refill error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

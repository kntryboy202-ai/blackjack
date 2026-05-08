// ABOUTME: Profile routes for user stats, hand history, and bankroll refill.
// ABOUTME: Full implementation in Phase 4; stub returns 501 until then.
import { Router } from "express";

export const profileRouter = Router();

profileRouter.get("/:userId", (_req, res) => {
  res.status(501).json({ error: "Not implemented yet" });
});

// ABOUTME: Authentication routes — register, login, logout, and session check.
// ABOUTME: Phase 1 supports local strategy only; OAuth is added in Phase 4.
import { Router } from "express";

export const authRouter = Router();

// Routes are implemented in Phase 1-D
authRouter.get("/me", (_req, res) => {
  res.status(501).json({ error: "Not implemented yet" });
});

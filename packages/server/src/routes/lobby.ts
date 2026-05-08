// ABOUTME: Lobby routes for listing, creating, and managing game tables.
// ABOUTME: Full implementation in Phase 1-D alongside auth routes.
import { Router } from "express";

export const lobbyRouter = Router();

lobbyRouter.get("/tables", (_req, res) => {
  res.status(501).json({ error: "Not implemented yet" });
});

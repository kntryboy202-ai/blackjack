// ABOUTME: Socket.io middleware for authenticating socket connections via shared session.
// ABOUTME: Rejects unauthenticated connections with an error to prevent unauthorized game access.

import type { Socket } from "socket.io";

export function requireAuth(socket: Socket, next: (err?: Error) => void): void {
  const req = socket.request as unknown as Express.Request;
  if (!req.isAuthenticated?.() || !req.user) {
    next(new Error("Authentication required"));
    return;
  }
  next();
}

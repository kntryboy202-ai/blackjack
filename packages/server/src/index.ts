// ABOUTME: Express 5 + Socket.io server entry point with session and auth middleware.
// ABOUTME: Creates the HTTP server, mounts API routes, and attaches the Socket.io instance.
import "dotenv/config";
import http from "node:http";
import path from "node:path";
import ConnectSqlite3 from "connect-sqlite3";
import cors from "cors";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import passport from "passport";
import { Server } from "socket.io";

import "./config/passport.js";
import { authRouter } from "./routes/auth.js";
import { lobbyRouter } from "./routes/lobby.js";
import { profileRouter } from "./routes/profile.js";

const SQLiteStore = ConnectSqlite3(session);

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL ?? "http://localhost:5173",
    credentials: true,
  },
});

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL ?? "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

const sessionMiddleware = session({
  store: new SQLiteStore({
    db: "sessions.db",
    dir: path.join(__dirname, "../prisma"),
  }) as session.Store,
  secret: process.env.SESSION_SECRET ?? "dev_secret_change_me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

// Share session with Socket.io
io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

// Routes
app.use("/api/auth", authRouter);
app.use("/api/lobby", lobbyRouter);
app.use("/api/profile", profileRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = Number(process.env.PORT ?? 3001);

if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export { app, httpServer, io };

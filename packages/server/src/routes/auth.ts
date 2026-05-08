// ABOUTME: Authentication routes — register, login, logout, session check, and GitHub OAuth.
// ABOUTME: Local strategy uses email/password; GitHub OAuth via passport-github2.
import bcrypt from "bcrypt";
import { type Request, type Response, Router } from "express";
import passport from "passport";
import { db } from "../config/db.js";

export const authRouter = Router();

type AuthUser = {
  id: string;
  username: string;
  email: string;
  bankroll: number;
  avatarUrl?: string | null;
};

authRouter.post("/register", async (req: Request, res: Response) => {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  if (!username || !email || !password) {
    res.status(400).json({ error: "username, email, and password are required" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: { username, email, passwordHash },
      select: { id: true, username: true, email: true },
    });
    res.status(201).json(user);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "P2002") {
      // Prisma unique constraint violation
      res.status(409).json({ error: "username or email already in use" });
      return;
    }
    console.error("register error", err);
    res.status(500).json({ error: "internal server error" });
  }
});

authRouter.post("/login", (req: Request, res: Response) => {
  passport.authenticate("local", (err: unknown, user: AuthUser | false) => {
    if (err) {
      console.error("login error", err);
      res.status(500).json({ error: "internal server error" });
      return;
    }
    if (!user) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error("logIn error", loginErr);
        res.status(500).json({ error: "internal server error" });
        return;
      }
      const { id, username, email, bankroll } = user;
      res.json({ id, username, email, bankroll });
    });
  })(req, res);
});

authRouter.post("/logout", (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      console.error("logout error", err);
      res.status(500).json({ error: "internal server error" });
      return;
    }
    res.json({ ok: true });
  });
});

authRouter.get("/me", (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const user = req.user as AuthUser;
  const { id, username, email, bankroll, avatarUrl } = user;
  res.json({ id, username, email, bankroll, avatarUrl: avatarUrl ?? null });
});

// GitHub OAuth — initiates the flow
authRouter.get("/github", passport.authenticate("github", { scope: ["user:email"] }));

// GitHub OAuth callback — on success redirect to client lobby, on failure back to login
authRouter.get(
  "/github/callback",
  passport.authenticate("github", { failureRedirect: "/" }),
  (_req: Request, res: Response) => {
    res.redirect(`${process.env.CLIENT_URL ?? "http://localhost:5173"}/lobby`);
  }
);

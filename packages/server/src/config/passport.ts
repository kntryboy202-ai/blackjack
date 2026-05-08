// ABOUTME: Passport.js local strategy configuration using bcrypt for password verification.
// ABOUTME: Serializes/deserializes user by ID for session-based auth.

import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { db } from "./db.js";

passport.use(
  new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await db.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return done(null, false);
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return done(null, false);
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, (user as { id: string }).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await db.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

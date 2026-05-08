// ABOUTME: Passport.js strategy configuration — local (email/password) and GitHub OAuth.
// ABOUTME: findOrCreateGitHubUser is exported for unit testing without HTTP round-trips.

import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { Strategy as LocalStrategy } from "passport-local";
import { db } from "./db.js";

export async function findOrCreateGitHubUser(
  githubId: string,
  email: string | undefined,
  displayName: string,
  avatarUrl: string | undefined
) {
  const resolvedEmail = email ?? `${githubId}@github.invalid`;

  // Return existing GitHub-linked user
  const byProvider = await db.user.findFirst({
    where: { provider: "github", providerId: githubId },
  });
  if (byProvider) return byProvider;

  // Link GitHub to existing local account that shares this email
  const byEmail = email ? await db.user.findUnique({ where: { email } }) : null;
  if (byEmail) {
    return db.user.update({
      where: { id: byEmail.id },
      data: { provider: "github", providerId: githubId, avatarUrl: avatarUrl ?? null },
    });
  }

  // Create a brand-new account
  const username = displayName || githubId;
  const baseUsername = username.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
  const existingName = await db.user.findUnique({ where: { username: baseUsername } });
  const finalUsername = existingName ? `${baseUsername}_${githubId.slice(-4)}` : baseUsername;

  return db.user.create({
    data: {
      username: finalUsername,
      email: resolvedEmail,
      provider: "github",
      providerId: githubId,
      avatarUrl: avatarUrl ?? null,
      bankroll: 1000,
    },
  });
}

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

// Only register GitHub strategy when credentials are configured
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        // NOTE: must match the callback URL registered in your GitHub OAuth app settings
        callbackURL: `${process.env.SERVER_URL ?? "http://localhost:3001"}/api/auth/github/callback`,
        scope: ["user:email"],
      },
      async (
        _accessToken: string,
        _refreshToken: string,
        profile: {
          id: string;
          displayName: string;
          emails?: { value: string }[];
          photos?: { value: string }[];
        },
        done: (err: Error | null, user?: Express.User | false) => void
      ) => {
        try {
          const email = profile.emails?.[0]?.value;
          const avatarUrl = profile.photos?.[0]?.value;
          const user = await findOrCreateGitHubUser(
            profile.id,
            email,
            profile.displayName,
            avatarUrl
          );
          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );
}

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

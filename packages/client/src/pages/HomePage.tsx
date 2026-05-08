// ABOUTME: Landing page with login and registration forms.
// ABOUTME: On success, stores the authenticated user and navigates to /lobby.
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../store/gameStore";
import { useGameStore } from "../store/gameStore";

export function HomePage() {
  const navigate = useNavigate();
  const setUser = useGameStore((s) => s.setUser);
  const user = useGameStore((s) => s.user);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate("/lobby");
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "register") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ username, email, password }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Registration failed");
          return;
        }
        setMode("login");
        setError(null);
        return;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as AuthUser & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      setUser(data);
      navigate("/lobby");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", padding: "0 16px" }}>
      <h1 style={{ textAlign: "center", color: "var(--chip-gold)", marginBottom: 32 }}>
        Blackjack
      </h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <button
          type="button"
          onClick={() => setMode("login")}
          style={{
            flex: 1,
            padding: "8px 0",
            background: mode === "login" ? "var(--chip-gold)" : "transparent",
            color: mode === "login" ? "var(--felt-dark)" : "var(--text-primary)",
            border: "1px solid var(--chip-gold)",
            borderRadius: 4,
          }}
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          style={{
            flex: 1,
            padding: "8px 0",
            background: mode === "register" ? "var(--chip-gold)" : "transparent",
            color: mode === "register" ? "var(--felt-dark)" : "var(--text-primary)",
            border: "1px solid var(--chip-gold)",
            borderRadius: 4,
          }}
        >
          Register
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {mode === "register" && (
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            style={inputStyle}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={inputStyle}
        />
        {error && <p style={{ color: "var(--bust-red)", fontSize: 14 }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 0",
            background: "var(--chip-gold)",
            color: "var(--felt-dark)",
            border: "none",
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          {loading ? "..." : mode === "login" ? "Login" : "Register"}
        </button>
      </form>

      {mode === "register" && (
        <p style={{ marginTop: 16, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
          After registering,{" "}
          <button
            type="button"
            onClick={() => setMode("login")}
            style={{
              background: "none",
              border: "none",
              color: "var(--chip-gold)",
              cursor: "pointer",
            }}
          >
            log in
          </button>{" "}
          to play.
        </p>
      )}

      <div style={{ marginTop: 24, textAlign: "center" }}>
        <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 12 }}>or</div>
        <a
          href="/api/auth/github"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            background: "#24292e",
            color: "#fff",
            borderRadius: 4,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <svg height="18" viewBox="0 0 16 16" width="18" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Login with GitHub
        </a>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid var(--text-dim)",
  borderRadius: 4,
  color: "var(--text-primary)",
};

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

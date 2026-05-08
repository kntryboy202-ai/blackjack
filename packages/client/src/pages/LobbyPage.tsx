// ABOUTME: Lobby page showing available tables and a form to create new ones.
// ABOUTME: Authenticated users can browse, create, and join tables from here.
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGameStore } from "../store/gameStore";

interface Table {
  id: string;
  name: string;
  minBet: number;
  maxBet: number;
  maxPlayers: number;
}

export function LobbyPage() {
  const navigate = useNavigate();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);

  const [tables, setTables] = useState<Table[]>([]);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/lobby/tables", { credentials: "include" })
      .then((r) => r.json())
      .then((data: Table[]) => setTables(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      const res = await fetch("/api/lobby/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: createName }),
      });
      const data = (await res.json()) as Table & { error?: string };
      if (!res.ok) {
        setCreateError(data.error ?? "Failed to create table");
        return;
      }
      setTables((prev) => [data, ...prev]);
      setCreateName("");
    } catch {
      setCreateError("Network error");
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    navigate("/");
  }

  return (
    <div style={{ maxWidth: 680, margin: "40px auto", padding: "0 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 32,
        }}
      >
        <h1 style={{ color: "var(--chip-gold)" }}>Lobby</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "var(--text-dim)", fontSize: 14 }}>
            {user?.username} · ${user?.bankroll.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: "6px 14px",
              background: "transparent",
              border: "1px solid var(--text-dim)",
              borderRadius: 4,
              color: "var(--text-dim)",
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <form onSubmit={handleCreate} style={{ display: "flex", gap: 8, marginBottom: 32 }}>
        <input
          type="text"
          placeholder="Table name"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          required
          style={{
            flex: 1,
            padding: "8px 12px",
            background: "rgba(255,255,255,0.08)",
            border: "1px solid var(--text-dim)",
            borderRadius: 4,
            color: "var(--text-primary)",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "8px 20px",
            background: "var(--chip-gold)",
            color: "var(--felt-dark)",
            border: "none",
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          Create
        </button>
      </form>
      {createError && <p style={{ color: "var(--bust-red)", marginBottom: 16 }}>{createError}</p>}

      {loading && <p style={{ color: "var(--text-dim)" }}>Loading tables...</p>}

      {!loading && tables.length === 0 && (
        <p style={{ color: "var(--text-dim)", textAlign: "center", marginTop: 48 }}>
          No tables yet. Create one above!
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tables.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "rgba(255,255,255,0.05)",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div>
              <span style={{ fontWeight: 600 }}>{t.name}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 13, marginLeft: 12 }}>
                ${t.minBet}–${t.maxBet} · up to {t.maxPlayers} players
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/table/${t.id}`)}
              style={{
                padding: "6px 16px",
                background: "var(--felt-green)",
                color: "var(--text-primary)",
                border: "1px solid var(--felt-green)",
                borderRadius: 4,
              }}
            >
              Join
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

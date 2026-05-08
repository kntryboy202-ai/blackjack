// ABOUTME: Root application component — declares routes and bootstraps the auth session.
// ABOUTME: Fetches /api/auth/me on mount to restore an existing session into Zustand.
import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { LobbyPage } from "./pages/LobbyPage";
import { TablePage } from "./pages/TablePage";
import type { AuthUser } from "./store/gameStore";
import { useGameStore } from "./store/gameStore";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useGameStore((s) => s.user);
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const setUser = useGameStore((s) => s.setUser);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthUser | null) => {
        if (data) setUser(data);
      })
      .catch(() => {});
  }, [setUser]);

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route
        path="/lobby"
        element={
          <ProtectedRoute>
            <LobbyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/table/:id"
        element={
          <ProtectedRoute>
            <TablePage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

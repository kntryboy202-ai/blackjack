// ABOUTME: Custom hook managing the Socket.io connection lifecycle for a table.
// ABOUTME: Syncs game_state, bankroll_update, and turn_start events into the Zustand store.
import type { BankrollUpdatePayload, GameRoomState, TurnStartPayload } from "@blackjack/shared";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useGameStore } from "../store/gameStore";

export function useSocket(tableId: string | null): Socket | null {
  const socketRef = useRef<Socket | null>(null);
  const setGameState = useGameStore((s) => s.setGameState);
  const setConnected = useGameStore((s) => s.setConnected);
  const setUser = useGameStore((s) => s.setUser);
  const setTurnTimer = useGameStore((s) => s.setTurnTimer);
  const userId = useGameStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!tableId || !userId) return;

    const socket = io({ path: "/socket.io", withCredentials: true });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_table", { tableId });
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("game_state", (state: GameRoomState) => {
      setGameState(state);
      if (state.phase !== "PLAYER_TURNS") {
        setTurnTimer(null);
      }
    });

    socket.on("turn_start", ({ seatIndex, timeoutSecs }: TurnStartPayload) => {
      setTurnTimer({ seatIndex, expiresAt: Date.now() + timeoutSecs * 1000 });
    });

    socket.on("bankroll_update", ({ newBankroll }: BankrollUpdatePayload) => {
      const currentUser = useGameStore.getState().user;
      if (currentUser) {
        setUser({ ...currentUser, bankroll: newBankroll });
      }
    });

    return () => {
      socket.emit("leave_table");
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setTurnTimer(null);
    };
  }, [tableId, userId, setGameState, setConnected, setUser, setTurnTimer]);

  return socketRef.current;
}

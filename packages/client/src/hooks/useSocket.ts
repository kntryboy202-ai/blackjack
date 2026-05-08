// ABOUTME: Custom hook managing the Socket.io connection lifecycle for a table.
// ABOUTME: Syncs game_state and bankroll_update events into the Zustand store.
import type { BankrollUpdatePayload, GameRoomState } from "@blackjack/shared";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { useGameStore } from "../store/gameStore";

export function useSocket(tableId: string | null): Socket | null {
  const socketRef = useRef<Socket | null>(null);
  const setGameState = useGameStore((s) => s.setGameState);
  const setConnected = useGameStore((s) => s.setConnected);
  const setUser = useGameStore((s) => s.setUser);
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
    };
  }, [tableId, userId, setGameState, setConnected, setUser]);

  return socketRef.current;
}

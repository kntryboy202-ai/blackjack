// ABOUTME: Zustand store for global game and auth state synced from Socket.io events.
// ABOUTME: Single source of truth — all components read from here, never duplicate state.
import type { GameRoomState } from "@blackjack/shared";
import { create } from "zustand";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  bankroll: number;
}

interface GameStore {
  user: AuthUser | null;
  gameState: GameRoomState | null;
  isConnected: boolean;
  setUser: (user: AuthUser | null) => void;
  setGameState: (state: GameRoomState) => void;
  setConnected: (connected: boolean) => void;
}

export const useGameStore = create<GameStore>((set) => ({
  user: null,
  gameState: null,
  isConnected: false,
  setUser: (user) => set({ user }),
  setGameState: (gameState) => set({ gameState }),
  setConnected: (isConnected) => set({ isConnected }),
}));

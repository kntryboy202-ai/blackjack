// ABOUTME: Unit tests for the Zustand game store — verifies setters and initial state.
// ABOUTME: Ensures the store is the single source of truth for user, gameState, and connection.
import { afterEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";

afterEach(() => {
  useGameStore.setState({ user: null, gameState: null, isConnected: false });
});

describe("gameStore", () => {
  it("starts with null user, null gameState, and isConnected false", () => {
    const state = useGameStore.getState();
    expect(state.user).toBeNull();
    expect(state.gameState).toBeNull();
    expect(state.isConnected).toBe(false);
  });

  it("setUser stores the user and setUser(null) clears it", () => {
    const { setUser } = useGameStore.getState();
    setUser({ id: "1", username: "alice", email: "a@example.com", bankroll: 500 });
    expect(useGameStore.getState().user?.username).toBe("alice");

    setUser(null);
    expect(useGameStore.getState().user).toBeNull();
  });

  it("setConnected toggles the connection flag", () => {
    const { setConnected } = useGameStore.getState();
    setConnected(true);
    expect(useGameStore.getState().isConnected).toBe(true);
    setConnected(false);
    expect(useGameStore.getState().isConnected).toBe(false);
  });

  it("setGameState stores a snapshot", () => {
    const { setGameState } = useGameStore.getState();
    const snapshot = {
      tableId: "t1",
      phase: "PLACE_BETS" as const,
      seats: [],
      dealer: { hand: [], handValue: 0, isSoft: false },
      activeSeatIndex: null,
      roundNumber: 1,
    };
    setGameState(snapshot);
    expect(useGameStore.getState().gameState?.phase).toBe("PLACE_BETS");
  });
});

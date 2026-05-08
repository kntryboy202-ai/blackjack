// ABOUTME: Socket.io event handlers mapping client events to GameRoom state transitions.
// ABOUTME: Maintains an in-memory registry of active GameRoom instances keyed by tableId.

import type {
  ActionPayload,
  GameRoomState,
  JoinTablePayload,
  PlaceBetPayload,
} from "@blackjack/shared";
import type { Server, Socket } from "socket.io";
import { db } from "../config/db.js";
import { GameRoom } from "../game/GameRoom.js";

// In-memory registry of active game rooms, keyed by tableId
const rooms = new Map<string, GameRoom>();

// Maps socketId → tableId for disconnect handling
const socketToTable = new Map<string, string>();

// Maps userId → sessionId for HandRecord writes
const userToSession = new Map<string, string>();

// Tracks which rounds have already been persisted: "${tableId}:${roundNumber}"
const resolvedRounds = new Set<string>();

async function persistResolvedRound(snapshot: GameRoomState, _tableId: string): Promise<void> {
  for (const seat of snapshot.seats) {
    if (!seat.outcome) continue;
    const sessionId = userToSession.get(seat.userId);
    if (!sessionId) continue;

    await db.handRecord.create({
      data: {
        sessionId,
        userId: seat.userId,
        betAmount: seat.bet,
        outcome: seat.outcome,
        playerCards: JSON.stringify(seat.hand),
        dealerCards: JSON.stringify(snapshot.dealer.hand),
        actions: "[]",
      },
    });

    // seat.bankroll in the RESOLVE snapshot already reflects payout — persist as-is
    await db.user.update({
      where: { id: seat.userId },
      data: { bankroll: seat.bankroll },
    });
  }
}

export function registerHandlers(io: Server, socket: Socket): void {
  const user = socket.request as unknown as Express.Request;
  const currentUser = user.user as { id: string; username: string; bankroll: number } | undefined;

  socket.on("join_table", async (payload: JoinTablePayload) => {
    const { tableId } = payload;

    try {
      // Join the socket room
      await socket.join(tableId);

      // Create or retrieve the GameRoom instance
      if (!rooms.has(tableId)) {
        const table = await db.table.findUnique({ where: { id: tableId } });
        if (!table) {
          socket.emit("error", { message: `Table ${tableId} not found.` });
          return;
        }
        const room = new GameRoom(tableId, {
          deckCount: table.deckCount,
          minBet: table.minBet,
          maxBet: table.maxBet,
        });
        room.setStateChangeHandler((snapshot) => {
          io.to(tableId).emit("game_state", snapshot);

          if (snapshot.phase === "RESOLVE") {
            const roundKey = `${tableId}:${snapshot.roundNumber}`;
            if (!resolvedRounds.has(roundKey)) {
              resolvedRounds.add(roundKey);
              persistResolvedRound(snapshot, tableId).catch((err) => {
                console.error("HandRecord write failed", err);
              });
            }
          }
        });
        rooms.set(tableId, room);
      }

      const room = rooms.get(tableId) as GameRoom;

      if (currentUser) {
        // Create a GameSession for this table visit
        const session = await db.gameSession.create({
          data: { userId: currentUser.id, tableId },
        });
        userToSession.set(currentUser.id, session.id);

        room.addPlayer(currentUser.id, currentUser.username, currentUser.bankroll, socket.id);
        socketToTable.set(socket.id, tableId);
        socket.to(tableId).emit("player_joined", {
          seatIndex: room.getSeatIndex(currentUser.id),
          username: currentUser.username,
        });
      }

      // Send current state to the joining socket
      socket.emit("game_state", room.getSnapshot());
    } catch (err) {
      socket.emit("error", { message: (err as Error).message });
    }
  });

  socket.on("start_game", () => {
    const tableId = socketToTable.get(socket.id);
    if (!tableId) {
      socket.emit("error", { message: "Not at a table." });
      return;
    }
    const room = rooms.get(tableId);
    if (!room) {
      socket.emit("error", { message: "Game room not found." });
      return;
    }
    try {
      room.startGame();
      // State change handler broadcasts automatically
    } catch (err) {
      socket.emit("error", { message: (err as Error).message });
    }
  });

  socket.on("place_bet", (payload: PlaceBetPayload) => {
    const tableId = socketToTable.get(socket.id);
    if (!tableId || !currentUser) {
      socket.emit("error", { message: "Not at a table or not authenticated." });
      return;
    }
    const room = rooms.get(tableId);
    if (!room) {
      socket.emit("error", { message: "Game room not found." });
      return;
    }
    try {
      room.placeBet(currentUser.id, payload.amount);
      // State change handler broadcasts automatically
    } catch (err) {
      socket.emit("error", { message: (err as Error).message });
    }
  });

  socket.on("action", (payload: ActionPayload) => {
    const tableId = socketToTable.get(socket.id);
    if (!tableId || !currentUser) {
      socket.emit("error", { message: "Not at a table or not authenticated." });
      return;
    }
    const room = rooms.get(tableId);
    if (!room) {
      socket.emit("error", { message: "Game room not found." });
      return;
    }
    try {
      room.playerAction(currentUser.id, payload.type);
      // State change handler broadcasts automatically
    } catch (err) {
      socket.emit("error", { message: (err as Error).message });
    }
  });

  socket.on("skip_insurance", () => {
    const tableId = socketToTable.get(socket.id);
    if (!tableId) return;
    const room = rooms.get(tableId);
    if (!room) return;
    try {
      room.skipInsurance();
    } catch (err) {
      socket.emit("error", { message: (err as Error).message });
    }
  });

  socket.on("next_round", () => {
    const tableId = socketToTable.get(socket.id);
    if (!tableId) return;
    const room = rooms.get(tableId);
    if (!room) return;
    try {
      room.nextRound();
    } catch (err) {
      socket.emit("error", { message: (err as Error).message });
    }
  });

  socket.on("leave_table", async () => {
    const tableId = socketToTable.get(socket.id);
    if (!tableId) return;

    const room = rooms.get(tableId);
    if (room && currentUser) {
      room.removePlayer(currentUser.id);
    }

    socketToTable.delete(socket.id);
    socket.leave(tableId);

    socket.to(tableId).emit("player_left", {
      seatIndex: -1, // seat already removed from room
    });

    if (currentUser) {
      const sessionId = userToSession.get(currentUser.id);
      if (sessionId) {
        await db.gameSession
          .update({
            where: { id: sessionId },
            data: { endedAt: new Date() },
          })
          .catch((err) => console.error("GameSession close failed", err));
        userToSession.delete(currentUser.id);
      }
    }
  });

  socket.on("disconnect", async () => {
    const tableId = socketToTable.get(socket.id);
    if (!tableId) return;

    const room = rooms.get(tableId);
    if (room && currentUser) {
      room.removePlayer(currentUser.id);
    }

    socketToTable.delete(socket.id);

    socket.to(tableId).emit("player_left", {
      seatIndex: -1,
    });

    if (currentUser) {
      const sessionId = userToSession.get(currentUser.id);
      if (sessionId) {
        await db.gameSession
          .update({
            where: { id: sessionId },
            data: { endedAt: new Date() },
          })
          .catch((err) => console.error("GameSession close failed", err));
        userToSession.delete(currentUser.id);
      }
    }
  });
}

// Exported for testing purposes
export { rooms, userToSession };

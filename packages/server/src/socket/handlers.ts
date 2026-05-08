// ABOUTME: Socket.io event handlers mapping client events to GameRoom state transitions.
// ABOUTME: Maintains an in-memory registry of active GameRoom instances keyed by tableId.

import type {
  ActionPayload,
  GamePhase,
  GameRoomState,
  JoinTablePayload,
  PlaceBetPayload,
  PlayerAction,
} from "@blackjack/shared";
import type { Server, Socket } from "socket.io";
import { db } from "../config/db.js";
import { GameRoom } from "../game/GameRoom.js";
import { dealerShouldHit } from "../game/Rules.js";

// In-memory registry of active game rooms, keyed by tableId
const rooms = new Map<string, GameRoom>();

// Maps socketId → tableId for disconnect handling
const socketToTable = new Map<string, string>();

// Maps userId → sessionId for HandRecord writes
const userToSession = new Map<string, string>();

// Tracks which rounds have already been persisted: "${tableId}:${roundNumber}"
const resolvedRounds = new Set<string>();

// Phase/seat tracking for bot automation and turn timer
const prevPhase = new Map<string, GamePhase>();
const prevActiveSeat = new Map<string, number | null>();

// Active turn timers keyed by tableId
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function persistResolvedRound(snapshot: GameRoomState, _tableId: string): Promise<void> {
  for (const seat of snapshot.seats) {
    if (!seat.outcome) continue;
    // Bots have no sessionId — skip persistence for them
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

function driveBots(snapshot: GameRoomState, tableId: string): void {
  const room = rooms.get(tableId);
  if (!room) return;

  // Bot betting: fire once when entering PLACE_BETS
  if (snapshot.phase === "PLACE_BETS" && prevPhase.get(tableId) !== "PLACE_BETS") {
    const { minBet, maxBet } = room.getConfig();
    snapshot.seats
      .filter((s) => s.isNpc)
      .forEach((seat, i) => {
        setTimeout(
          () => {
            const r = rooms.get(tableId);
            if (!r) return;
            const amount = minBet + Math.floor(Math.random() * (maxBet - minBet + 1));
            try {
              r.placeBet(seat.userId, amount);
            } catch {}
          },
          (i + 1) * 500
        );
      });
  }

  // Bot turns: when active seat changes to an NPC
  if (
    snapshot.phase === "PLAYER_TURNS" &&
    snapshot.activeSeatIndex !== null &&
    snapshot.activeSeatIndex !== prevActiveSeat.get(tableId)
  ) {
    const activeSeat = snapshot.seats.find((s) => s.seatIndex === snapshot.activeSeatIndex);
    if (activeSeat?.isNpc) {
      setTimeout(
        () => {
          const r = rooms.get(tableId);
          if (!r) return;
          const action: PlayerAction = dealerShouldHit({
            value: activeSeat.handValue,
            isSoft: activeSeat.isSoft,
          })
            ? "hit"
            : "stand";
          try {
            r.playerAction(activeSeat.userId, action);
          } catch {}
        },
        800 + Math.floor(Math.random() * 400)
      );
    }
  }
}

function manageTurnTimer(snapshot: GameRoomState, tableId: string, io: Server): void {
  const activeChanged = snapshot.activeSeatIndex !== prevActiveSeat.get(tableId);
  const phaseChanged = snapshot.phase !== prevPhase.get(tableId);

  if (activeChanged || phaseChanged) {
    const existing = turnTimers.get(tableId);
    if (existing) {
      clearTimeout(existing);
      turnTimers.delete(tableId);
    }
  }

  const timerSeat =
    snapshot.phase === "PLAYER_TURNS" && snapshot.activeSeatIndex !== null
      ? snapshot.seats.find((s) => s.seatIndex === snapshot.activeSeatIndex && !s.isNpc)
      : null;

  if (timerSeat && activeChanged) {
    io.to(tableId).emit("turn_start", { seatIndex: timerSeat.seatIndex, timeoutSecs: 30 });
    const timer = setTimeout(() => {
      const r = rooms.get(tableId);
      if (!r) return;
      try {
        r.playerAction(timerSeat.userId, "stand");
      } catch {}
      turnTimers.delete(tableId);
    }, 30_000);
    turnTimers.set(tableId, timer);
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

          driveBots(snapshot, tableId);
          manageTurnTimer(snapshot, tableId, io);

          prevPhase.set(tableId, snapshot.phase);
          prevActiveSeat.set(tableId, snapshot.activeSeatIndex);
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
      room.fillBotsForStart();
      room.startGame();
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

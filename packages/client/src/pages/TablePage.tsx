// ABOUTME: Game table page — connects to Socket.io, renders seats/cards, and handles player actions.
// ABOUTME: Phase 1 supports hit/stand only; auto-declines insurance; shows next-round button on resolve.

import type { Card } from "@blackjack/shared";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { useGameStore } from "../store/gameStore";

function renderCard(card: Card, index: number) {
  if (card.faceDown) {
    return (
      <div
        key={index}
        style={{
          width: 40,
          height: 56,
          background: "var(--card-back)",
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.2)",
          display: "inline-block",
          marginRight: 4,
        }}
      />
    );
  }
  const isRed = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <div
      key={index}
      style={{
        width: 40,
        height: 56,
        background: "var(--card-face)",
        borderRadius: 4,
        border: "1px solid #ccc",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        marginRight: 4,
        color: isRed ? "var(--bust-red)" : "#111",
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      <span>{card.rank}</span>
      <span style={{ fontSize: 11 }}>{card.suit[0].toUpperCase()}</span>
    </div>
  );
}

export function TablePage() {
  const { id: tableId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const user = useGameStore((s) => s.user);
  const gameState = useGameStore((s) => s.gameState);
  const isConnected = useGameStore((s) => s.isConnected);

  const socket = useSocket(tableId ?? null);

  const mySeat = gameState?.seats.find((s) => s.userId === user?.id);
  const isMyTurn =
    gameState?.phase === "PLAYER_TURNS" &&
    gameState.activeSeatIndex !== null &&
    mySeat?.seatIndex === gameState.activeSeatIndex;

  useEffect(() => {
    if (!socket) return;
    if (gameState?.phase === "CHECK_INSURANCE") {
      socket.emit("skip_insurance");
    }
  }, [socket, gameState?.phase]);

  function handleAction(type: "hit" | "stand") {
    socket?.emit("action", { type });
  }

  function handleStartGame() {
    socket?.emit("start_game");
  }

  function handlePlaceBet(amount: number) {
    socket?.emit("place_bet", { amount });
  }

  function handleNextRound() {
    socket?.emit("next_round");
  }

  if (!tableId) {
    navigate("/lobby");
    return null;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--felt-green)",
        padding: 24,
      }}
    >
      {/* HUD */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/lobby")}
          style={{
            background: "transparent",
            border: "1px solid var(--text-dim)",
            color: "var(--text-dim)",
            padding: "4px 12px",
            borderRadius: 4,
          }}
        >
          ← Lobby
        </button>
        <div style={{ color: "var(--text-primary)", fontSize: 14 }}>
          {isConnected ? (
            <span style={{ color: "var(--win-glow)" }}>● Connected</span>
          ) : (
            <span style={{ color: "var(--bust-red)" }}>● Connecting...</span>
          )}
        </div>
        <div style={{ color: "var(--chip-gold)", fontWeight: 600 }}>
          {user?.username} · ${user?.bankroll.toLocaleString()}
        </div>
      </div>

      {/* Phase indicator */}
      {gameState && (
        <div
          style={{ textAlign: "center", color: "var(--text-dim)", marginBottom: 16, fontSize: 13 }}
        >
          Phase: {gameState.phase} · Round {gameState.roundNumber}
        </div>
      )}

      {/* Dealer area */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 32,
          padding: 16,
          background: "rgba(0,0,0,0.2)",
          borderRadius: 8,
        }}
      >
        <div style={{ color: "var(--text-dim)", fontSize: 12, marginBottom: 8 }}>DEALER</div>
        {gameState?.dealer.hand.length ? (
          <div>
            <div style={{ marginBottom: 4 }}>
              {gameState.dealer.hand.map((c, i) => renderCard(c, i))}
            </div>
            {gameState.dealer.handValue > 0 && (
              <span style={{ color: "var(--text-primary)", fontSize: 13 }}>
                {gameState.dealer.handValue}
              </span>
            )}
          </div>
        ) : (
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Waiting...</span>
        )}
      </div>

      {/* Seats */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "center",
          marginBottom: 32,
        }}
      >
        {gameState?.seats.map((seat) => {
          const isActive =
            gameState.phase === "PLAYER_TURNS" && gameState.activeSeatIndex === seat.seatIndex;
          const isMe = seat.userId === user?.id;
          return (
            <div
              key={seat.seatIndex}
              style={{
                minWidth: 120,
                padding: 12,
                background: isMe ? "rgba(201,168,76,0.15)" : "rgba(0,0,0,0.2)",
                border: isActive ? "2px solid var(--win-glow)" : "2px solid transparent",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: isMe ? "var(--chip-gold)" : "var(--text-dim)",
                  marginBottom: 4,
                }}
              >
                {seat.username} {isMe && "(you)"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 6 }}>
                ${seat.bankroll.toLocaleString()}
                {seat.bet > 0 && (
                  <span style={{ color: "var(--chip-gold)", marginLeft: 6 }}>bet: ${seat.bet}</span>
                )}
              </div>
              <div style={{ marginBottom: 4 }}>{seat.hand.map((c, i) => renderCard(c, i))}</div>
              {seat.handValue > 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: seat.isBusted ? "var(--bust-red)" : "var(--text-primary)",
                  }}
                >
                  {seat.handValue}
                  {seat.isBusted && " BUST"}
                  {seat.isBlackjack && " BJ!"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Insurance auto-decline notice */}
      {gameState?.phase === "CHECK_INSURANCE" && (
        <div style={{ textAlign: "center", color: "var(--text-dim)", marginBottom: 16 }}>
          Auto-declining insurance...
        </div>
      )}

      {/* Action strip */}
      <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
        {gameState?.phase === "WAITING_FOR_PLAYERS" && (
          <button type="button" onClick={handleStartGame} style={primaryBtn}>
            Start Game
          </button>
        )}

        {gameState?.phase === "PLACE_BETS" &&
          mySeat &&
          mySeat.bet === 0 &&
          [10, 25, 50, 100].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => handlePlaceBet(amount)}
              disabled={amount > (user?.bankroll ?? 0)}
              style={primaryBtn}
            >
              ${amount}
            </button>
          ))}

        {isMyTurn && (
          <>
            <button type="button" onClick={() => handleAction("hit")} style={primaryBtn}>
              Hit
            </button>
            <button type="button" onClick={() => handleAction("stand")} style={secondaryBtn}>
              Stand
            </button>
          </>
        )}

        {gameState?.phase === "RESOLVE" && (
          <button type="button" onClick={handleNextRound} style={primaryBtn}>
            Next Round
          </button>
        )}
      </div>

      {/* No game state yet */}
      {!gameState && isConnected && (
        <div style={{ textAlign: "center", color: "var(--text-dim)", marginTop: 48 }}>
          Joining table...
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "10px 24px",
  background: "var(--chip-gold)",
  color: "var(--felt-dark)",
  border: "none",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 16,
};

const secondaryBtn: React.CSSProperties = {
  padding: "10px 24px",
  background: "transparent",
  color: "var(--text-primary)",
  border: "2px solid var(--text-primary)",
  borderRadius: 6,
  fontWeight: 700,
  fontSize: 16,
};

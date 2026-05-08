// ABOUTME: Game table page — connects to Socket.io, renders the felt table, and handles player actions.
// ABOUTME: Uses the Card component for animated card rendering and CSS grid for table layout.

import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { useSocket } from "../hooks/useSocket";
import { useGameStore } from "../store/gameStore";

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
    <div className="table-surface">
      {/* HUD */}
      <div className="table-hud">
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
        <div style={{ fontSize: 14 }}>
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

      {/* Dealer zone */}
      <div className="dealer-zone">
        <div className="dealer-zone__label">
          Dealer{gameState && ` · Round ${gameState.roundNumber}`}
        </div>
        {gameState?.dealer.hand.length ? (
          <div>
            <div style={{ marginBottom: 6 }}>
              {gameState.dealer.hand.map((c, i) => (
                <Card
                  key={`${c.suit}-${c.rank}`}
                  suit={c.suit}
                  rank={c.rank}
                  faceDown={c.faceDown}
                  dealIndex={i}
                />
              ))}
            </div>
            {gameState.dealer.handValue > 0 && (
              <div style={{ textAlign: "center", color: "var(--text-primary)", fontSize: 13 }}>
                {gameState.dealer.handValue}
              </div>
            )}
          </div>
        ) : (
          <span style={{ color: "var(--text-dim)", fontSize: 13 }}>Waiting...</span>
        )}
        {gameState && (
          <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 8 }}>
            {gameState.phase}
          </div>
        )}
      </div>

      {/* Seats */}
      <div className="seats-arc">
        {gameState?.seats.map((seat) => {
          const isActive =
            gameState.phase === "PLAYER_TURNS" && gameState.activeSeatIndex === seat.seatIndex;
          const isMe = seat.userId === user?.id;
          return (
            <div
              key={seat.seatIndex}
              className={`seat${isActive ? " is-active" : ""}${isMe ? " is-mine" : ""}`}
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
              <div style={{ marginBottom: 4 }}>
                {seat.hand.map((c, i) => (
                  <Card
                    key={`${c.suit}-${c.rank}`}
                    suit={c.suit}
                    rank={c.rank}
                    faceDown={c.faceDown}
                    dealIndex={seat.seatIndex * 2 + i}
                  />
                ))}
              </div>
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

      {/* Action strip */}
      <div className="action-strip">
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

        {gameState?.phase === "CHECK_INSURANCE" && (
          <div style={{ color: "var(--text-dim)", fontSize: 14 }}>Auto-declining insurance...</div>
        )}

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

      {!gameState && isConnected && (
        <div style={{ textAlign: "center", color: "var(--text-dim)", gridColumn: "1 / -1" }}>
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

"use client";

import { useEffect, useState } from "react";
import { Text, useGui } from "./gui";
import { Button, Screen, useKeyDown } from "./widgets";

export interface LoadingScreenProps {
  progress: number; // 0..1
  title?: string;
  status?: string;
}

export function LoadingScreen({ progress, title = "Loading terrain...", status }: LoadingScreenProps) {
  const { width, height } = useGui();
  const p = Math.max(0, Math.min(1, progress));
  const bx = Math.floor(width / 2 - 50);
  const by = Math.floor(height / 2 + 16);
  return (
    <Screen background="dirt">
      <Text text={title} x={width / 2} y={Math.floor(height / 2 - 4 - 16)} align="center" />
      {status && <Text text={status} x={width / 2} y={Math.floor(height / 2 - 4 + 8)} align="center" />}
      <div style={{ position: "absolute", left: bx, top: by, width: 100, height: 2, background: "#808080" }} />
      <div style={{ position: "absolute", left: bx, top: by, width: Math.round(p * 100), height: 2, background: "#80ff80" }} />
      <Text text={`${Math.floor(p * 100)}%`} color={0xa0a0a0} x={width / 2} y={by + 6} align="center" />
    </Screen>
  );
}

export interface PauseScreenProps {
  onResume: () => void;
  onOptions: () => void;
  onQuit: () => void;
  onAdvancements?: () => void;
  onStatistics?: () => void;
  onLan?: () => void;
  quitLabel?: string;
}

export function PauseScreen({ onResume, onOptions, onQuit, onAdvancements, onStatistics, onLan, quitLabel = "Save and Quit to Title" }: PauseScreenProps) {
  const { width, height } = useGui();
  useKeyDown((e) => e.key === "Escape" && onResume());
  const x = Math.floor(width / 2 - 102);
  const y = Math.floor(height / 4 + 8);
  return (
    <Screen background="ingame">
      <Text text="Game Menu" x={width / 2} y={40} align="center" />
      <Button x={x} y={y} width={204} label="Back to Game" onClick={onResume} />
      <Button x={x} y={y + 24} width={98} label="Advancements" disabled={!onAdvancements} onClick={onAdvancements} />
      <Button x={x + 106} y={y + 24} width={98} label="Statistics" disabled={!onStatistics} onClick={onStatistics} />
      <Button x={x} y={y + 48} width={98} label="Give Feedback" disabled />
      <Button x={x + 106} y={y + 48} width={98} label="Report Bugs" disabled />
      <Button x={x} y={y + 72} width={98} label="Options..." onClick={onOptions} />
      <Button x={x + 106} y={y + 72} width={98} label="Open to LAN" disabled={!onLan} onClick={onLan} />
      <Button x={x} y={y + 96} width={204} label={quitLabel} onClick={onQuit} />
    </Screen>
  );
}

export interface DeathScreenProps {
  message: string;
  score: number;
  hardcore?: boolean;
  onRespawn: () => void; // in hardcore this is "Spectate World"
  onTitle: () => void;
}

export function DeathScreen({ message, score, hardcore, onRespawn, onTitle }: DeathScreenProps) {
  const { width, height } = useGui();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 1000);
    return () => clearTimeout(id);
  }, []);
  const x = Math.floor(width / 2 - 100);
  return (
    <Screen background="death">
      <Text text={hardcore ? "Game Over!" : "You Died!"} scale={2} x={width / 2} y={60} align="center" />
      <Text text={message} x={width / 2} y={85} align="center" />
      <Text text={`Score: §e${score}`} x={width / 2} y={100} align="center" />
      <Button x={x} y={Math.floor(height / 4 + 72)} label={hardcore ? "Spectate World" : "Respawn"} disabled={!ready} onClick={onRespawn} />
      <Button x={x} y={Math.floor(height / 4 + 96)} label="Title Screen" disabled={!ready} onClick={onTitle} />
    </Screen>
  );
}

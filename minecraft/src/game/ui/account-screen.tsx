"use client";

import { useEffect, useState } from "react";
import { Text, useGui } from "./gui";
import { Button, Screen, TextField, useKeyDown } from "./widgets";

export interface AccountScreenProps {
  user: string | null;
  available: boolean;
  usage?: { used: number; quota: number } | null;
  error?: string | null;
  onSubmit: (username: string, password: string, create: boolean) => Promise<string | null>; // resolves to an error message
  onSignOut: () => void;
  onDone: () => void;
}

const mb = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;

export function AccountScreen({ user, available, usage, error, onSubmit, onSignOut, onDone }: AccountScreenProps) {
  const { width, height } = useGui();
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setPass("");
    setCreate(false);
  }, [user]);
  useKeyDown((e) => e.key === "Escape" && onDone());
  const cx = Math.floor(width / 2);
  const top = Math.floor(height / 4);

  if (user)
    return (
      <Screen background="menu">
        <Text text="Account" x={cx} y={top - 20} align="center" />
        <Text text={`Signed in as ${user}`} x={cx} y={top + 4} align="center" />
        {usage && <Text text={`Cloud storage: ${mb(usage.used)} of ${mb(usage.quota)}`} color={0xa0a0a0} x={cx} y={top + 18} align="center" />}
        <Text text="Worlds, options and packs list sync" color={0xa0a0a0} x={cx} y={top + 32} align="center" />
        {error && <Text text={error} color={0xff5555} x={cx} y={top + 46} align="center" />}
        <Button x={cx - 100} y={top + 64} label="Sign Out" onClick={onSignOut} />
        <Button x={cx - 100} y={top + 88} label="Done" onClick={onDone} />
      </Screen>
    );

  const submit = async () => {
    if (busy) return;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return setMsg("Name must be 3-16 letters, digits or _");
    if (pass.length < 8) return setMsg("Password must be at least 8 characters");
    setBusy(true);
    setMsg(null);
    const err = await onSubmit(name, pass, create);
    setBusy(false);
    if (err) setMsg(err);
  };
  const title = create ? "Create Account" : "Sign In";
  return (
    <Screen background="menu">
      <Text text={title} x={cx} y={top - 20} align="center" />
      <Text text="Username" color={0xa0a0a0} x={cx - 100} y={top} />
      <TextField x={cx - 100} y={top + 11} value={name} onChange={(v) => setName(v.replace(/[^A-Za-z0-9_]/g, ""))} maxLength={16} autoFocus onEnter={() => void submit()} />
      <Text text="Password" color={0xa0a0a0} x={cx - 100} y={top + 38} />
      <TextField x={cx - 100} y={top + 49} value={pass} onChange={setPass} maxLength={128} password onEnter={() => void submit()} />
      {(msg || !available) && <Text text={msg ?? "Accounts are not available"} color={0xff5555} x={cx} y={top + 76} align="center" />}
      <Button x={cx - 100} y={top + 90} label={busy ? "Please wait..." : title} disabled={busy || !available} onClick={() => void submit()} />
      <Button
        x={cx - 100}
        y={top + 114}
        width={98}
        label={create ? "Sign In" : "Create Account"}
        onClick={() => {
          setCreate(!create);
          setMsg(null);
        }}
      />
      <Button x={cx + 2} y={top + 114} width={98} label="Cancel" onClick={onDone} />
    </Screen>
  );
}

export interface CloudConflictProps {
  name: string;
  cloud?: { updatedAt: number; device: string };
  onKeepLocal: () => void;
  onUseCloud: () => void;
  onCancel: () => void;
}

export function CloudConflictScreen({ name, cloud, onKeepLocal, onUseCloud, onCancel }: CloudConflictProps) {
  const { width, height } = useGui();
  useKeyDown((e) => e.key === "Escape" && onCancel());
  const cx = Math.floor(width / 2);
  const y = Math.floor(height / 6 + 96);
  return (
    <Screen background="menu">
      <Text text="This world was changed on another device" x={cx} y={60} align="center" />
      <Text text={`'${name}'`} color={0xa0a0a0} x={cx} y={76} align="center" />
      {cloud && <Text text={`Cloud copy: ${new Date(cloud.updatedAt).toLocaleString()}${cloud.device ? `, ${cloud.device}` : ""}`} color={0xa0a0a0} x={cx} y={90} align="center" />}
      <Text text="Pick the copy to keep. The other one is replaced." x={cx} y={104} align="center" />
      <Button x={cx - 155} y={y} width={150} label="Keep This Device" onClick={onKeepLocal} />
      <Button x={cx + 5} y={y} width={150} label="Use Cloud" onClick={onUseCloud} />
      <Button x={cx - 75} y={y + 24} width={150} label="Cancel" onClick={onCancel} />
    </Screen>
  );
}

export function BusyScreen({ title }: { title: string }) {
  const { width, height } = useGui();
  return (
    <Screen background="menu">
      <Text text={title} x={Math.floor(width / 2)} y={Math.floor(height / 2 - 4)} align="center" />
    </Screen>
  );
}

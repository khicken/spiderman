"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { WorldListEntry } from "../ui/world-screens";
import { AccountScreen, BusyScreen, CloudConflictScreen } from "../ui/account-screen";
import { deleteWorld, type WorldMeta } from "../world/save";
import { account, onAccount, refreshAccount, setAccount, signIn, signOut, type AccountState } from "./account";
import { ApiError } from "./api";
import { onProfileApplied, startProfileSync } from "./profile-sync";
import { deleteCloudWorld, prepareToPlay, pullWorld, startAutosync, syncPending, syncWorld, worldStatuses, type CloudStatus, type CloudWorld } from "./sync";

type View = Awaited<ReturnType<typeof worldStatuses>>;
type Modal = null | "account" | { busy: string } | { conflict: string; name: string; play?: boolean };

interface Opts {
  worlds: WorldMeta[];
  refreshWorlds: () => void;
  onSettings: () => void;
  playingId: string | null;
}

export function useCloud({ worlds, refreshWorlds, onSettings, playingId }: Opts) {
  const [acct, setAcct] = useState<AccountState>(account);
  const [view, setView] = useState<View>(null);
  const [modal, setModal] = useState<Modal>(null);
  const settingsRef = useRef(onSettings);
  settingsRef.current = onSettings;
  const worldsRef = useRef(worlds);
  worldsRef.current = worlds;

  useEffect(() => {
    const off = onAccount(setAcct);
    startProfileSync();
    const offApplied = onProfileApplied(() => settingsRef.current());
    void refreshAccount();
    const online = () => void syncPending().then(refreshWorlds);
    window.addEventListener("online", online);
    return () => {
      off();
      offApplied();
      window.removeEventListener("online", online);
    };
  }, [refreshWorlds]);

  const refreshView = useCallback(async () => setView(acct.user ? await worldStatuses(worlds) : null), [acct.user, worlds]);
  useEffect(() => void refreshView(), [refreshView]);

  useEffect(() => {
    if (acct.user && !playingId) void syncPending().then(refreshView);
  }, [acct.user, playingId, refreshView]);

  useEffect(() => {
    if (!playingId || !acct.user) return;
    const id = playingId;
    const stop = startAutosync(id);
    return () => {
      stop();
      void syncWorld(id).then((r) => {
        if (r === "conflict") setModal({ conflict: id, name: worldsRef.current.find((w) => w.id === id)?.name ?? "World" });
        refreshWorlds();
      });
    };
  }, [playingId, acct.user, refreshWorlds]);

  const entries = useCallback(
    (local: WorldListEntry[]): WorldListEntry[] => {
      if (!view) return local;
      const out: WorldListEntry[] = local.map((w) => ({ ...w, cloud: view.status.get(w.id) as CloudStatus | undefined }));
      const have = new Set(local.map((w) => w.id));
      for (const c of view.cloudOnly) if (!have.has(c.id)) out.push(cloudEntry(c));
      return out;
    },
    [view],
  );

  const download = useCallback(
    async (id: string) => {
      setModal({ busy: "Downloading world..." });
      const r = await pullWorld(id, "replace");
      setModal(null);
      if (r !== "synced" && !account().error) setAccount({ error: "Download failed, try again" });
      refreshWorlds();
    },
    [refreshWorlds],
  );

  const play = useCallback(
    async (id: string, start: () => void) => {
      if (!account().user) return start();
      setModal({ busy: "Syncing world..." });
      const r = await prepareToPlay(id);
      if (r === "conflict") return setModal({ conflict: id, name: worlds.find((w) => w.id === id)?.name ?? "World", play: true });
      setModal(null);
      start();
    },
    [worlds],
  );

  const remove = useCallback(async (id: string) => {
    await deleteWorld(id);
    await deleteCloudWorld(id);
  }, []);

  const resolve = async (keepLocal: boolean, m: { conflict: string; play?: boolean }, start?: () => void) => {
    setModal({ busy: keepLocal ? "Uploading world..." : "Downloading world..." });
    const r = keepLocal ? await syncWorld(m.conflict, { force: true }) : await pullWorld(m.conflict, "replace");
    setModal(null);
    refreshWorlds();
    void refreshView();
    if (r === "synced" && m.play) start?.();
  };

  const submit = async (username: string, password: string, create: boolean) => {
    try {
      await signIn(username, password, create);
      return null;
    } catch (e) {
      return e instanceof ApiError ? (e.status === 0 ? "Cannot reach the server" : e.message) : "Something went wrong";
    }
  };

  const overlay = (startWorld: (id: string) => void): ReactNode => {
    if (!modal) return null;
    if (modal === "account")
      return (
        <AccountScreen
          user={acct.user}
          available={acct.available}
          usage={view ? { used: view.used, quota: view.quota } : null}
          error={acct.error}
          onSubmit={submit}
          onSignOut={() => void signOut()}
          onDone={() => setModal(null)}
        />
      );
    if ("busy" in modal) return <BusyScreen title={modal.busy} />;
    const m = modal;
    const c = view?.cloud.get(m.conflict);
    return (
      <CloudConflictScreen
        name={m.name}
        cloud={c ? { updatedAt: c.updatedAt, device: c.device } : undefined}
        onKeepLocal={() => void resolve(true, m, () => startWorld(m.conflict))}
        onUseCloud={() => void resolve(false, m, () => startWorld(m.conflict))}
        onCancel={() => setModal(null)}
      />
    );
  };

  return {
    user: acct.user,
    accountButton: acct.available || acct.user ? { label: acct.user ?? "Sign In", onClick: () => setModal("account") } : undefined,
    entries,
    note: acct.error ?? undefined,
    play,
    download: (id: string) => void download(id),
    remove,
    overlay,
    active: modal !== null,
  };
}

function cloudEntry(c: CloudWorld): WorldListEntry {
  const mode = c.gameMode === "creative" || c.gameMode === "adventure" || c.gameMode === "spectator" ? c.gameMode : "survival";
  return { id: c.id, name: c.name, lastPlayed: c.lastPlayed, gameMode: mode, hardcore: c.hardcore, cheats: c.cheats, icon: c.icon, cloud: "cloud" };
}

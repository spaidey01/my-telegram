"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Sticker from "@/models/sticker";
import StickerPackModel from "@/models/stickerPack";
import StickerGrid from "./StickerGrid";
import StickerPack from "./StickerPack";

interface Props {
  open: boolean;
  onSelect: (sticker: Sticker) => void;
}

type Preferences = { recentStickerIds: string[]; favoriteStickerIds: string[] };

export default function StickerPicker({ open, onSelect }: Props) {
  const [packs, setPacks] = useState<StickerPackModel[]>([]);
  const [prefs, setPrefs] = useState<Preferences>({ recentStickerIds: [], favoriteStickerIds: [] });
  const [activePackId, setActivePackId] = useState("recent");
  const [packCode, setPackCode] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [packsResponse, prefsResponse] = await Promise.all([
        fetch("/api/stickers/packs", { cache: "no-store" }),
        fetch("/api/stickers/preferences", { cache: "no-store" }),
      ]);
      if (packsResponse.ok) setPacks(await packsResponse.json());
      if (prefsResponse.ok) setPrefs(await prefsResponse.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const allStickers = useMemo(() => packs.flatMap((pack) => pack.stickers), [packs]);
  const recent = prefs.recentStickerIds.map((id) => allStickers.find((sticker) => sticker._id === id)).filter(Boolean) as Sticker[];
  const favorites = prefs.favoriteStickerIds.map((id) => allStickers.find((sticker) => sticker._id === id)).filter(Boolean) as Sticker[];
  const activeStickers = activePackId === "recent" ? recent : activePackId === "favorites" ? favorites : packs.find((pack) => pack._id === activePackId)?.stickers || [];

  const select = async (sticker: Sticker) => {
    onSelect(sticker);
    setPrefs((prev) => ({ ...prev, recentStickerIds: [sticker._id, ...prev.recentStickerIds.filter((id) => id !== sticker._id)].slice(0, 50) }));
    await fetch("/api/stickers/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "recent", stickerId: sticker._id }) });
  };

  const favorite = async (stickerId: string) => {
    const wasFavorite = prefs.favoriteStickerIds.includes(stickerId);
    setPrefs((prev) => ({ ...prev, favoriteStickerIds: wasFavorite ? prev.favoriteStickerIds.filter((id) => id !== stickerId) : [stickerId, ...prev.favoriteStickerIds].slice(0, 100) }));
    const response = await fetch("/api/stickers/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "favorite", stickerId }) });
    if (!response.ok) void load();
  };

  const install = async () => {
    const id = packCode.trim();
    if (!id) return;
    const response = await fetch(`/api/stickers/packs/${encodeURIComponent(id)}`, { method: "POST" });
    if (response.ok) { setPackCode(""); await load(); }
  };

  const remove = async (id: string) => {
    const response = await fetch(`/api/stickers/packs/${id}`, { method: "DELETE" });
    if (response.ok) {
      if (activePackId === id) setActivePackId("recent");
      await load();
    }
  };

  if (!open) return null;
  return (
    <div className="border-t border-white/10 bg-modalBg w-full">
      <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10 overflow-x-auto">
        <button type="button" onClick={() => setActivePackId("recent")} className={`px-2 py-1 rounded-lg text-xs ${activePackId === "recent" ? "bg-lightBlue/20" : ""}`}>🕘</button>
        <button type="button" onClick={() => setActivePackId("favorites")} className={`px-2 py-1 rounded-lg text-xs ${activePackId === "favorites" ? "bg-lightBlue/20" : ""}`}>⭐</button>
        {packs.filter((pack) => pack.installed).map((pack) => <StickerPack key={pack._id} pack={pack} active={activePackId === pack._id} onClick={() => setActivePackId(pack._id)} onRemove={() => remove(pack._id)} />)}
        <input value={packCode} onChange={(e) => setPackCode(e.target.value)} placeholder="Pack ID" className="w-20 bg-black/20 rounded-lg px-2 py-2 text-xs outline-none" />
        <button type="button" onClick={install} disabled={!packCode.trim()} className="px-2 py-2 rounded-lg bg-lightBlue/20 text-xs">افزودن</button>
      </div>
      {loading ? <div className="p-6 text-center text-white/50 text-sm">در حال بارگذاری...</div> : <StickerGrid stickers={activeStickers} favoriteStickerIds={prefs.favoriteStickerIds} onSelect={select} onFavorite={favorite} />}
    </div>
  );
}

"use client";

import Sticker from "@/models/sticker";

interface Props {
  stickers: Sticker[];
  favoriteStickerIds: string[];
  onSelect: (sticker: Sticker) => void;
  onFavorite: (stickerId: string) => void;
}

export default function StickerGrid({ stickers, favoriteStickerIds, onSelect, onFavorite }: Props) {
  if (!stickers.length) return <div className="p-6 text-center text-white/50 text-sm">استیکری وجود ندارد.</div>;
  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 p-2 max-h-64 overflow-y-auto">
      {stickers.map((sticker) => (
        <div key={sticker._id} className="relative aspect-square rounded-xl hover:bg-white/10 transition p-1">
          <button type="button" className="w-full h-full rounded-xl" onClick={() => onSelect(sticker)} title={sticker.emoji}>
            <img src={sticker.file} alt={sticker.emoji} className="w-full h-full object-contain" loading="lazy" />
          </button>
          <button
            type="button"
            aria-label={favoriteStickerIds.includes(sticker._id) ? "حذف از علاقه‌مندی" : "افزودن به علاقه‌مندی"}
            className="absolute right-0 bottom-0 text-xs bg-black/70 rounded-full px-1"
            onClick={() => onFavorite(sticker._id)}
          >
            {favoriteStickerIds.includes(sticker._id) ? "★" : "☆"}
          </button>
        </div>
      ))}
    </div>
  );
}

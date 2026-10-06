"use client";

import StickerPackModel from "@/models/stickerPack";

interface Props {
  pack: StickerPackModel;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
}

export default function StickerPack({ pack, active, onClick, onRemove }: Props) {
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={onClick} className={`size-12 rounded-xl p-1 transition ${active ? "bg-lightBlue/20 ring-1 ring-lightBlue" : "hover:bg-white/10"}`} title={pack.title}>
        {pack.thumbnail ? <img src={pack.thumbnail} alt={pack.title} className="size-full object-contain" loading="lazy" /> : <span className="text-xs">{pack.title.slice(0, 2)}</span>}
      </button>
      {onRemove && (
        <button type="button" aria-label="حذف پک" onClick={onRemove} className="absolute -top-1 -right-1 size-4 rounded-full bg-black text-[10px]">×</button>
      )}
    </div>
  );
}

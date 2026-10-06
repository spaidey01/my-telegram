export default interface UserStickerPack {
  _id: string;
  user: string;
  packId: string;
  installedAt: string;
  recentStickerIds: string[];
  favoriteStickerIds: string[];
}

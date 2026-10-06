import Sticker from "./sticker";

export default interface StickerPack {
  _id: string;
  name: string;
  title: string;
  thumbnail: string;
  owner: string;
  stickers: Sticker[];
  installed?: boolean;
}

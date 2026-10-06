export default interface Sticker {
  _id: string;
  packId: string;
  file: string;
  mimeType: "image/png" | "image/webp" | "image/gif";
  emoji: string;
  sortOrder: number;
}

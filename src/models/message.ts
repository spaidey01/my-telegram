import User from "./user";

export default interface Message {
  tempId?: string;
  _id: string;
  message: string;
  sender: User;
  isEdited: boolean;
  seen: string[];
  readTime: Date | null;
  replays: string[];
  pinnedAt: string | null;
  voiceData: { src: string; duration: number; playedBy: string[] } | null;
  attachmentData?: { src: string; name: string; mimeType: string; size: number } | null;
  stickerData?: { stickerId: string; packId: string; file: string; mimeType: string; emoji: string } | null;
  reactions?: { emoji: string; userIds: string[] }[];
  forwardedFrom?: { messageId: string; senderName: string } | null;
  replayedTo: { message: string; msgID: string; username: string } | null;
  roomID: string;
  hideFor: string[];
  createdAt: string;
  updatedAt: string;
  status?: "pending" | "sent" | "failed";
  uploadProgress?: number;
  kind?: "message" | "post" | "system";
  mentions?: string[];
  hashtags?: string[];
}

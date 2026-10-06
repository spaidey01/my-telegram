export default interface Call {
  _id: string; caller: string; receiver: string; roomID: string;
  type: "audio" | "video";
  status: "missed" | "rejected" | "cancelled" | "completed" | "failed";
  startedAt: string; answeredAt: string | null; endedAt: string | null;
}

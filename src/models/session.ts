export default interface Session {
  _id: string; device: string; ip: string; userAgent: string;
  createdAt: string; lastActiveAt: string; revokedAt: string | null;
}

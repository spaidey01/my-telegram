import Room from "./room";

export default interface User {
  _id: string;
  name: string;
  lastName: string;
  username: string;
  phone: string;
  rooms: Room[];
  avatar: string;
  biography: string;
  status: "online" | "offline";
  lastSeenAt: string | null;
  privacySettings: {
    lastSeen: "everyone" | "contacts" | "nobody";
    profilePhoto: "everyone" | "contacts" | "nobody";
    phone: "everyone" | "contacts" | "nobody";
    calls: "everyone" | "contacts" | "nobody";
    messages: "everyone" | "contacts" | "nobody";
  };
  isLogin: boolean;
  roomMessageTrack: { roomId: string; scrollPos: number }[];
  createdAt: string;
  updatedAt: string;
}

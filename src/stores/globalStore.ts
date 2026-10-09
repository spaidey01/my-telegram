import Room from "@/models/room";
import User from "@/models/user";
import { Socket } from "socket.io-client";
import { create } from "zustand";
import { EMPTY_MESSAGE_SELECTION, enterMessageSelection, toggleMessageSelection, selectAllMessages, pruneMessageSelection, replaceMessageSelection } from "@/utils/messageSelection";

export interface MessageSelectionState {
  selectedMessageIds: string[];
  selectionRoomID: string | null;
  selectionMode: boolean;
  pendingMessageJumpId: string | null;
}

export interface ThreadEvent { _id: string; type: "mention" | "reaction" | "call" | "system"; room: string; message?: string; actor: string; data?: { targetUser?: string; username?: string; emoji?: string }; createdAt: string; readBy?: string[]; }

export interface GlobalStoreProps {
  selectedRoom: null | Room;
  RoomDetailsData: null | Room | User;
  rightBarRoute: string;
  onlineUsers: { socketID: string; userID: string }[];
  socket: null | Socket;
  isRoomDetailsShown: boolean;
  shouldCloseAll: boolean;
  isChatPageLoaded: boolean;
  showCreateRoomBtn: boolean;
  createRoomType: "channel" | "group" | null;
  selectedMessageIds: string[];
  selectionRoomID: string | null;
  selectionMode: boolean;
  pendingMessageJumpId: string | null;
  threadEvents: ThreadEvent[];
}

interface Updater {
  updater: (
    key: keyof GlobalStoreProps,
    value: GlobalStoreProps[keyof GlobalStoreProps]
  ) => void;
  setter: (
    state:
      | Partial<GlobalStoreProps>
      | ((prev: GlobalStoreProps) => Partial<GlobalStoreProps>)
  ) => void;
  enterMessageSelection: (roomID: string, messageID: string) => void;
  toggleMessageSelection: (roomID: string, messageID: string) => void;
  selectAllMessages: (roomID: string, messageIDs: string[]) => void;
  clearMessageSelection: () => void;
  pruneMessageSelection: (roomID: string, messageIDs: string[]) => void;
  replaceMessageSelection: (roomID: string, oldMessageID: string, newMessageID: string) => void;
  setPendingMessageJump: (messageID: string | null) => void;
  addThreadEvent: (event: ThreadEvent) => void;
}

const emptySelection = EMPTY_MESSAGE_SELECTION;

const useGlobalStore = create<GlobalStoreProps & Updater>((set) => ({
  selectedRoom: null,
  RoomDetailsData: null,
  rightBarRoute: "/",
  onlineUsers: [],
  socket: null,
  shouldCloseAll: false,
  isRoomDetailsShown: false,
  isChatPageLoaded: false,
  showCreateRoomBtn: true,
  createRoomType: null,
  ...emptySelection,
  pendingMessageJumpId: null,
  threadEvents: [],

  updater(
    key: keyof GlobalStoreProps,
    value: GlobalStoreProps[keyof GlobalStoreProps]
  ) {
    set({ [key]: value });
  },

  setter: set,

  enterMessageSelection(roomID, messageID) {
    set(enterMessageSelection(roomID, messageID));
  },

  toggleMessageSelection(roomID, messageID) {
    set((state) => toggleMessageSelection(state, roomID, messageID));
  },

  selectAllMessages(roomID, messageIDs) {
    set(selectAllMessages(roomID, messageIDs));
  },

  clearMessageSelection() {
    set(emptySelection);
  },

  pruneMessageSelection(roomID, messageIDs) {
    set((state) => pruneMessageSelection(state, roomID, messageIDs));
  },

  replaceMessageSelection(roomID, oldMessageID, newMessageID) {
    set((state) => replaceMessageSelection(state, roomID, oldMessageID, newMessageID));
  },

  setPendingMessageJump(messageID) {
    set({ pendingMessageJumpId: messageID });
  },

  addThreadEvent(event) {
    set((state) => ({ threadEvents: [event, ...state.threadEvents].slice(0, 100) }));
  },

}));

export default useGlobalStore;

import Room from "@/models/room";
import User from "@/models/user";
import { Socket } from "socket.io-client";
import { create } from "zustand";
import { EMPTY_MESSAGE_SELECTION, enterMessageSelection, toggleMessageSelection, selectAllMessages, pruneMessageSelection } from "@/utils/messageSelection";

export interface MessageSelectionState {
  selectedMessageIds: string[];
  selectionRoomID: string | null;
  selectionMode: boolean;
}

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

}));

export default useGlobalStore;

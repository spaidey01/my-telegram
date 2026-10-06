import Room from "@/models/room";
import User from "@/models/user";
import { Socket } from "socket.io-client";
import { create } from "zustand";

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

const emptySelection: MessageSelectionState = {
  selectedMessageIds: [],
  selectionRoomID: null,
  selectionMode: false,
};

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
    set({
      selectedMessageIds: [messageID],
      selectionRoomID: roomID,
      selectionMode: true,
    });
  },

  toggleMessageSelection(roomID, messageID) {
    set((state) => {
      if (state.selectionRoomID && state.selectionRoomID !== roomID) return state;

      const selected = state.selectedMessageIds.includes(messageID)
        ? state.selectedMessageIds.filter((id) => id !== messageID)
        : [...state.selectedMessageIds, messageID];

      if (!selected.length) return emptySelection;

      return {
        selectedMessageIds: selected,
        selectionRoomID: roomID,
        selectionMode: true,
      };
    });
  },

  selectAllMessages(roomID, messageIDs) {
    const uniqueIDs = [...new Set(messageIDs.filter(Boolean))];
    if (!uniqueIDs.length) return set(emptySelection);
    set({
      selectedMessageIds: uniqueIDs,
      selectionRoomID: roomID,
      selectionMode: true,
    });
  },

  clearMessageSelection() {
    set(emptySelection);
  },

  pruneMessageSelection(roomID, messageIDs) {
    set((state) => {
      if (state.selectionRoomID !== roomID) return state;
      const valid = new Set(messageIDs);
      const selected = state.selectedMessageIds.filter((id) => valid.has(id));
      if (!selected.length) return emptySelection;
      return { selectedMessageIds: selected, selectionMode: true };
    });
  },
}));

export default useGlobalStore;

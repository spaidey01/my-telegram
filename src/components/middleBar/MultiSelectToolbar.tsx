"use client";

import { useMemo, useState } from "react";
import { MdContentCopy, MdDeleteOutline, MdDone, MdForward, MdPushPin, MdOutlinePushPin, MdSelectAll } from "react-icons/md";
import { IoClose } from "react-icons/io5";
import useGlobalStore from "@/stores/globalStore";
import useSockets from "@/stores/useSockets";
import useUserStore from "@/stores/userStore";
import Message from "@/models/message";

interface Props {
  messages: Message[];
  roomID: string;
}

const MultiSelectToolbar = ({ messages, roomID }: Props) => {
  const {
    selectedMessageIds,
    selectionMode,
    clearMessageSelection,
    selectAllMessages,
  } = useGlobalStore((state) => state);
  const roomsSocket = useSockets((state) => state.rooms);
  const { _id: myID, rooms } = useUserStore((state) => state);
  const [targetRoomID, setTargetRoomID] = useState("");

  const selectedMessages = useMemo(
    () => selectedMessageIds
      .map((id) => messages.find((message) => message._id === id))
      .filter(Boolean) as Message[],
    [messages, selectedMessageIds],
  );

  if (!selectionMode || !selectedMessageIds.length) return null;

  const currentRoom = rooms.find((room) => room._id === roomID);
  const targetRooms = rooms.filter((room) => room._id !== roomID);
  const allVisibleSelected = selectedMessages.length === selectedMessageIds.length;

  const toggleAll = () => {
    if (selectedMessages.length === messages.length) {
      selectAllMessages(roomID, []);
      return;
    }
    selectAllMessages(
      roomID,
      messages.filter((message) => !message.hideFor.includes(myID)).map((message) => message._id),
    );
  };

  const copySelected = async () => {
    const text = selectedMessages
      .map((message) => message.message || message.stickerData?.emoji || message.attachmentData?.name || "Voice Message")
      .join("\n");
    if (text) await navigator.clipboard?.writeText(text);
    clearMessageSelection();
  };

  const deleteSelected = () => {
    for (const message of selectedMessages) {
      const forAll =
        currentRoom?.type === "private" ||
        message.sender?._id === myID ||
        currentRoom?.admins?.includes(myID);
      roomsSocket?.emit("deleteMsg", {
        forAll,
        msgID: message._id,
        roomID,
      });
    }
    clearMessageSelection();
  };

  const pinSelected = () => {
    const shouldUnpin = selectedMessages.every((message) => Boolean(message.pinnedAt));
    for (const message of selectedMessages) {
      roomsSocket?.emit("pinMessage", message._id, roomID, messages.at(-1)?._id === message._id, shouldUnpin);
    }
    clearMessageSelection();
  };

  const reactSelected = () => {
    for (const message of selectedMessages) {
      roomsSocket?.emit("toggleReaction", {
        msgID: message._id,
        roomID,
        emoji: "❤️",
      });
    }
    clearMessageSelection();
  };

  const forwardSelected = () => {
    if (!targetRoomID) return;
    for (const message of selectedMessages) {
      roomsSocket?.emit(
        "forwardMessage",
        { msgID: message._id, sourceRoomID: roomID, targetRoomID },
        () => {},
      );
    }
    setTargetRoomID("");
    clearMessageSelection();
  };

  return (
    <div className="sticky top-0 z-30 flex min-h-17 items-center gap-2 border-b border-white/5 bg-leftBarBg px-2">
      <button type="button" title="لغو انتخاب" onClick={clearMessageSelection} className="p-2 hover:bg-white/10 rounded-full">
        <IoClose className="size-6" />
      </button>
      <div className="min-w-10 text-center font-vazirBold">{selectedMessageIds.length}</div>
      <button type="button" title="انتخاب همه" onClick={toggleAll} className="p-2 hover:bg-white/10 rounded-full">
        <MdSelectAll className="size-6" />
      </button>
      <button type="button" title="Copy" onClick={copySelected} disabled={!allVisibleSelected} className="p-2 hover:bg-white/10 rounded-full disabled:opacity-40">
        <MdContentCopy className="size-5" />
      </button>
      <button type="button" title="Forward" onClick={forwardSelected} disabled={!targetRoomID} className="p-2 hover:bg-white/10 rounded-full disabled:opacity-40">
        <MdForward className="size-5" />
      </button>
      <button type="button" title="Delete" onClick={deleteSelected} className="p-2 hover:bg-white/10 rounded-full">
        <MdDeleteOutline className="size-5" />
      </button>
      <button type="button" title={selectedMessages.every((message) => message.pinnedAt) ? "Unpin" : "Pin"} onClick={pinSelected} className="p-2 hover:bg-white/10 rounded-full">
        {selectedMessages.every((message) => message.pinnedAt) ? <MdOutlinePushPin className="size-5" /> : <MdPushPin className="size-5" />}
      </button>
      <button type="button" title="React" onClick={reactSelected} className="p-2 hover:bg-white/10 rounded-full">
        ❤️
      </button>
      <select
        aria-label="اتاق مقصد فوروارد"
        value={targetRoomID}
        onChange={(event) => setTargetRoomID(event.target.value)}
        className="ml-auto max-w-40 rounded-lg bg-black/20 px-2 py-1 text-xs outline-none"
      >
        <option value="">Forward to…</option>
        {targetRooms.map((room) => (
          <option key={room._id} value={room._id}>
            {room.name || (room.type === "private" ? "Private chat" : room.type)}
          </option>
        ))}
      </select>
      <MdDone className="hidden" />
    </div>
  );
};

export default MultiSelectToolbar;

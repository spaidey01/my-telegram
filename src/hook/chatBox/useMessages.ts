import Message from "@/models/message";
import { GlobalStoreProps } from "@/stores/globalStore";
import { useEffect } from "react";
import { DefaultEventsMap } from "socket.io";
import { Socket } from "socket.io-client";\nimport useGlobalStore from "@/stores/globalStore";

interface useMessagesProps {
  rooms: Socket<DefaultEventsMap, DefaultEventsMap> | null;
  roomID: string;
  myID: string;
  setter: (
    state:
      | Partial<GlobalStoreProps>
      | ((prev: GlobalStoreProps) => Partial<GlobalStoreProps>)
  ) => void;
  playRingSound: () => void;
}

const useMessages = ({
  rooms,
  roomID,
  myID,
  setter,
  playRingSound,
}: useMessagesProps) => {
  useEffect(() => {
    const handleNewMessage = (newMsg: Message) => {
      if (newMsg.roomID === roomID) {
        playRingSound();
        setter((prev) => ({
          selectedRoom: {
            ...prev.selectedRoom!,
            messages: [...(prev.selectedRoom?.messages ?? []), newMsg],
          },
        }));
      }
    };

    const handleDeleteMsg = (msgID: string) => {
      setter((prev) => {
        const updatedMessages = (prev.selectedRoom?.messages || []).filter(
          (msg) => msg._id !== msgID
        );
        return {
          selectedRoom: {
            ...prev.selectedRoom!,
            messages: updatedMessages,
          },
        };
      });
    };

    const handleEditMessage = ({
      msgID,
      editedMsg,
    }: {
      msgID: string;
      editedMsg: string;
    }) => {
      setter((prev) => ({
        selectedRoom: {
          ...prev.selectedRoom!,
          messages: (prev.selectedRoom?.messages || []).map((msg) =>
            msg._id === msgID
              ? { ...msg, message: editedMsg, isEdited: true }
              : msg
          ),
        },
      }));
    };

    const handleNewMessageIdUpdate = ({
      tempId,
      _id,
    }: {
      tempId: string;
      _id: string;
    }) => {
      playRingSound();
      setter((prev) => ({
        selectedRoom: {
          ...prev.selectedRoom!,
          messages: (prev.selectedRoom?.messages || []).map((msg) =>
            msg.tempId === tempId
              ? { ...msg, _id, tempId: undefined, status: "sent" as const }
              : msg
          ),
        },
      }));
    };

    const handleSeenMsg = ({
      msgID,
      seenBy,
      readTime,
    }: {
      msgID: string;
      seenBy: string;
      readTime: Date;
    }) => {
      setter(
        (prev): Partial<GlobalStoreProps> => ({
          selectedRoom: prev.selectedRoom
            ? {
                ...(prev.selectedRoom ?? {}),
                messages: (prev.selectedRoom?.messages ?? []).map(
                  (msg: Message) =>
                    msg._id === msgID
                      ? {
                          ...msg,
                          seen: [...new Set([...msg.seen, seenBy])],
                          readTime,
                        }
                      : msg
                ),
              }
            : null,
        })
      );
    };

    const handleRoomRead = ({
      roomID: readRoomID,
      messageID,
      readBy,
      readTime,
      unreadCount,
    }: {
      roomID: string;
      messageID: string;
      readBy: string;
      readTime: Date;
      unreadCount: number;
    }) => {
      if (readRoomID !== roomID) return;

      setter((prev): Partial<GlobalStoreProps> => {
        if (!prev.selectedRoom || prev.selectedRoom._id !== readRoomID) return {};
        const messages = prev.selectedRoom.messages ?? [];
        const targetIndex = messages.findIndex((msg) => msg._id === messageID);
        const nextMessages = messages.map((msg, index) => {
          if (targetIndex === -1 || index > targetIndex || msg.sender?._id === readBy) return msg;
          return {
            ...msg,
            seen: msg.seen.includes(readBy) ? msg.seen : [...msg.seen, readBy],
            readTime,
          };
        });

        return {
          selectedRoom: {
            ...prev.selectedRoom,
            messages: nextMessages,
            notSeenCount: unreadCount,
          },
        };
      });
    };

    rooms?.on("newMessage", handleNewMessage);
    rooms?.on("deleteMsg", handleDeleteMsg);
    rooms?.on("editMessage", handleEditMessage);
    rooms?.on("newMessageIdUpdate", handleNewMessageIdUpdate);
    rooms?.on("seenMsg", handleSeenMsg);
    rooms?.on("roomRead", handleRoomRead);

    return () => {
      rooms?.off("newMessage", handleNewMessage);
      rooms?.off("deleteMsg", handleDeleteMsg);
      rooms?.off("editMessage", handleEditMessage);
      rooms?.off("newMessageIdUpdate", handleNewMessageIdUpdate);
      rooms?.off("seenMsg", handleSeenMsg);
      rooms?.off("roomRead", handleRoomRead);
    };
  }, [rooms, roomID, myID, setter, playRingSound]);
};
export default useMessages;

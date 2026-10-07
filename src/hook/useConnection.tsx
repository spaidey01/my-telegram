import Loading from "@/components/modules/ui/Loading";
import Room from "@/models/room";
import User from "@/models/user";
import { GlobalStoreProps, ThreadEvent } from "@/stores/globalStore";
import { UserStoreUpdater } from "@/stores/userStore";
import { SocketsProps } from "@/stores/useSockets";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  pendingMessagesService,
} from "@/utils/pendingMessages";
import { uploadFile as uploadFileWithRetry } from "@/utils";
import { voiceBlobStorage } from "@/utils/voiceBlobStorage";

interface useConnectionProps {
  selectedRoom: Room | null;
  setter: (
    state:
      | Partial<GlobalStoreProps>
      | ((prev: GlobalStoreProps) => Partial<GlobalStoreProps>)
  ) => void;
  userId: string;
  userDataUpdater: (state: Partial<User & UserStoreUpdater>) => void;
  updater: (
    key: keyof SocketsProps,
    value: SocketsProps[keyof SocketsProps]
  ) => void;
}

const useConnection = ({
  selectedRoom,
  setter,
  userId,
  userDataUpdater,
  updater,
}: useConnectionProps) => {
  const socketRef = useRef<Socket | null>(null);
  const refreshingTokenRef = useRef(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isPageLoaded, setIsPageLoaded] = useState<boolean>(false);
  const [status, setStatus] = useState<ReactNode>(
    <span>
      Connecting
      <Loading loading="dots" size="xs" classNames="text-white mt-1.5" />
    </span>
  );

  const setupSocketListeners = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;

    let listenersRemaining = 2;
    const handleListenerUpdate = () => {
      listenersRemaining -= 1;
      // console.log(`Event ${event} completed. Remaining: ${listenersRemaining}`);
      if (listenersRemaining === 0) {
        setStatus("Telegram");
      }
    };

    setStatus(
      <>
        Updating
        <Loading loading="dots" size="xs" classNames="text-white mt-1.5" />
      </>
    );

    socket.emit("joining", selectedRoom?._id);

    socket.on("joining", (roomData) => {
      if (roomData) {
        setter(() => {
          // Get pending messages for this room
          const pendingMessages = pendingMessagesService.getPendingMessages(
            roomData._id
          );

          const serverMessages = roomData.messages || [];

          // Merge server messages with pending messages
          const allMessages = [...serverMessages, ...pendingMessages];

          // Sort by createdAt to maintain order
          allMessages.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );

          return {
            selectedRoom: {
              ...roomData,
              messages: allMessages,
            },
          };
        });

        // Retry pending messages for this room when user enters
        const retryPendingMessagesForRoom = async () => {
          const pendingMessages = pendingMessagesService.getPendingMessages(
            roomData._id
          );

          // Filter only pending messages that haven't been processed
          const pendingOnly = pendingMessages.filter(
            (msg) => msg.status === "pending"
          );

          for (const msg of pendingOnly) {\n            if (msg.retryCount >= 20) continue;\n            pendingMessagesService.updatePendingMessage(roomData._id, msg.tempId, { retryCount: msg.retryCount + 1, lastAttempt: Date.now() });
            // Prepare voice data: if src is missing, try to upload from IndexedDB first
            let preparedVoiceData = msg.voiceData || null;
            if (
              preparedVoiceData &&
              (!preparedVoiceData.src || !preparedVoiceData.src.trim())
            ) {
              try {
                const blob = await voiceBlobStorage.getBlob(
                  msg.tempId || msg._id
                );
                if (!blob) {
                  // No blob to upload; skip emitting, keep pending
                  continue;
                }
                const file = new File([blob], `voice-retry-${Date.now()}.ogg`, {
                  type: "audio/ogg",
                });

                const uploadRes = await uploadFileWithRetry(
                  file,
                  (progress) => {
                    // Update progress in UI for this pending message
                    setter(
                      (prev): Partial<GlobalStoreProps> => ({
                        ...prev,
                        selectedRoom: prev.selectedRoom
                          ? {
                              ...prev.selectedRoom,
                              messages: prev.selectedRoom.messages.map((m) =>
                                m._id === msg._id
                                  ? { ...m, uploadProgress: progress }
                                  : m
                              ),
                            }
                          : prev.selectedRoom,
                      })
                    );
                  }
                );

                if (!uploadRes.success || !uploadRes.downloadUrl) {
                  // Upload failed; keep message pending and try later
                  continue;
                }

                preparedVoiceData = {
                  ...preparedVoiceData,
                  src: uploadRes.downloadUrl,
                };

                // Update UI and pending storage with new src and complete progress
                setter(
                  (prev): Partial<GlobalStoreProps> => ({
                    ...prev,
                    selectedRoom: prev.selectedRoom
                      ? {
                          ...prev.selectedRoom,
                          messages: prev.selectedRoom.messages.map((m) =>
                            m._id === msg._id
                              ? {
                                  ...m,
                                  voiceData: preparedVoiceData,
                                  uploadProgress: 100,
                                }
                              : m
                          ),
                        }
                      : prev.selectedRoom,
                  })
                );
                const list = pendingMessagesService.getPendingMessages(
                  roomData._id
                );
                pendingMessagesService.savePendingMessages(
                  roomData._id,
                  list.map((m) =>
                    m._id === msg._id
                      ? { ...m, voiceData: preparedVoiceData }
                      : m
                  )
                );
              } catch {
                // Any error in uploading, skip this message for now
                continue;
              }
            }

            const payload = {
              roomID: roomData._id,
              message: msg.message,
              sender: msg.sender,
              replayData: msg.replayedTo
                ? { targetID: msg.replayedTo.msgID, replayedTo: msg.replayedTo }
                : null,
              attachmentData: msg.attachmentData || null,
              stickerData: msg.stickerData || null,
              tempId: msg.tempId,
            };
            if (preparedVoiceData) {
              Object.assign(payload, { voiceData: preparedVoiceData });
            }

            await new Promise<void>((resolve) => {
              socket.emit(
                "newMessage",
                payload,
                (response: { success: boolean; _id: string }) => {
                  if (response.success) {
                    setter(
                      (prev): Partial<GlobalStoreProps> => ({
                        ...prev,
                        selectedRoom: prev.selectedRoom
                          ? {
                              ...prev.selectedRoom,
                              messages: prev.selectedRoom.messages.map((m) =>
                                m._id === msg._id
                                  ? {
                                      ...m,
                                      _id: response._id,
                                      status: "sent",
                                      uploadProgress: undefined,
                                    }
                                  : m
                              ),
                            }
                          : prev.selectedRoom,
                      })
                    );
                    pendingMessagesService.removePendingMessage(
                      roomData._id,
                      msg._id
                    );
                    // Cleanup saved blob if any
                    voiceBlobStorage
                      .deleteBlob(msg.tempId || msg._id)
                      .catch(() => {});
                  } else {
                    // Message remains pending, will be retried next time
                    // No action needed
                  }
                  resolve();
                }
              );
            });
          }
        };

        // Retry pending messages when entering the room
        retryPendingMessagesForRoom();
      }
      handleListenerUpdate();
    });

    socket.on("getRooms", (fetchedRooms) => {
      setRooms(fetchedRooms);
      userDataUpdater({ rooms: fetchedRooms });
      setIsPageLoaded(true);
      handleListenerUpdate();
    });

    socket.on("lastMsgUpdate", (newMsg) => {
      setRooms((prevRooms) =>
        prevRooms.map((roomData) =>
          roomData._id === newMsg.roomID
            ? { ...roomData, lastMsgData: newMsg }
            : roomData
        )
      );
    });

    socket.on("createRoom", (roomData) => {
      socket.emit("getRooms", userId);
      const participants = Array.isArray(roomData?.participants) ? roomData.participants : [];
      const isParticipant = participants.some((participant: unknown) =>
        String(typeof participant === "string" ? participant : (participant as { _id?: string })?._id) === userId
      );
      if (roomData?.creator === userId || isParticipant) socket.emit("joining", roomData._id);
    });

    socket.on("updateRoomData", (roomData) => {
      socket.emit("getRooms", userId);

      setter((prev) => ({
        ...prev,
        selectedRoom:
          prev.selectedRoom && prev.selectedRoom._id === roomData._id
            ? { ...prev.selectedRoom, ...roomData }
            : prev.selectedRoom,
      }));
    });

    const updateChannelRole = (roomID: string, memberID: string, role?: string) => {
      const apply = (room: Room) => {
        if (room._id !== roomID) return room;
        const nextRoles = { ...(room.channelRoles || {}) };
        const nextAdmins = [...(room.admins || [])];
        if (role) {
          nextRoles[memberID] = role as NonNullable<Room["channelRoles"]>[string];
          if (!nextAdmins.includes(memberID)) nextAdmins.push(memberID);
        } else {
          delete nextRoles[memberID];
          const index = nextAdmins.indexOf(memberID);
          if (index >= 0) nextAdmins.splice(index, 1);
        }
        return { ...room, channelRoles: nextRoles, admins: nextAdmins };
      };
      setRooms((prev) => prev.map(apply));
      setter((prev) => ({
        selectedRoom: prev.selectedRoom ? apply(prev.selectedRoom) : prev.selectedRoom,
      }));
    };
    const onChannelRole = ({ roomID, memberID, role }: { roomID: string; memberID: string; role: string }) =>
      updateChannelRole(roomID, memberID, role);
    const onChannelRoleRemove = ({ roomID, memberID }: { roomID: string; memberID: string }) =>
      updateChannelRole(roomID, memberID);
    socket.on("channel:role", onChannelRole);
    socket.on("channel:role:remove", onChannelRoleRemove);

    socket.on("thread:event", (event: ThreadEvent) => {
      if (!event || typeof event._id !== "string" || typeof event.type !== "string") return;
      setter((prev) => ({
        threadEvents: [
          event,
          ...prev.threadEvents.filter((item) => item._id !== event._id),
        ].slice(0, 100),
      }));
    });

    socket.on("updateOnlineUsers", (onlineUsers) => setter({ onlineUsers }));
    socket.on("userProfileUpdated", (updatedUser: Pick<User, "_id" | "name" | "lastName" | "username" | "avatar" | "biography" | "status">) => {
      if (updatedUser._id === userId) userDataUpdater(updatedUser);

      setRooms((prevRooms) =>
        prevRooms.map((room) => ({
          ...room,
          participants: room.participants.map((participant) =>
            typeof participant === "object" && participant._id === updatedUser._id
              ? { ...participant, ...updatedUser }
              : participant
          ),
          messages: (room.messages || []).map((message) =>
            typeof message.sender === "object" && message.sender._id === updatedUser._id
              ? { ...message, sender: { ...message.sender, ...updatedUser } }
              : message
          ),
          lastMsgData: room.lastMsgData
            ? {
                ...room.lastMsgData,
                sender:
                  typeof room.lastMsgData.sender === "object" &&
                  room.lastMsgData.sender._id === updatedUser._id
                    ? { ...room.lastMsgData.sender, ...updatedUser }
                    : room.lastMsgData.sender,
              }
            : room.lastMsgData,
        }))
      );

      setter((prev) => ({
        selectedRoom: prev.selectedRoom
          ? {
              ...prev.selectedRoom,
              participants: prev.selectedRoom.participants.map((participant) =>
                typeof participant === "object" && participant._id === updatedUser._id
                  ? { ...participant, ...updatedUser }
                  : participant
              ),
              messages: prev.selectedRoom.messages.map((message) =>
                typeof message.sender === "object" && message.sender._id === updatedUser._id
                  ? { ...message, sender: { ...message.sender, ...updatedUser } }
                  : message
              ),
              lastMsgData: prev.selectedRoom.lastMsgData
                ? {
                    ...prev.selectedRoom.lastMsgData,
                    sender:
                      typeof prev.selectedRoom.lastMsgData.sender === "object" &&
                      prev.selectedRoom.lastMsgData.sender._id === updatedUser._id
                        ? {
                            ...prev.selectedRoom.lastMsgData.sender,
                            ...updatedUser,
                          }
                        : prev.selectedRoom.lastMsgData.sender,
                  }
                : prev.selectedRoom.lastMsgData,
            }
          : prev.selectedRoom,
      }));
    });

    socket.on("updateLastMsgPos", (updatedData) => {
      userDataUpdater({ roomMessageTrack: updatedData });
    });

    socket.on("deleteRoom", (roomID) => {
      socket.emit("getRooms");
      if (roomID === selectedRoom?._id) setter({ selectedRoom: null });
    });

    socket.on("roomRead", ({ roomID, messageID, readBy, readTime }: { roomID: string; messageID: string; readBy: string; readTime: string }) => {
      const applyRead = (messages: MessageModel[]) => {
        const targetIndex = messages.findIndex((message) => message._id === messageID);
        if (targetIndex < 0) return messages;
        return messages.map((message, index) =>
          index <= targetIndex && message.sender?._id !== readBy
            ? { ...message, seen: message.seen?.includes(readBy) ? message.seen : [...(message.seen || []), readBy], readTime }
            : message
        );
      };
      setRooms((prevRooms) => prevRooms.map((room) => {
        if (room._id !== roomID) return room;
        return {
          ...room,
          messages: applyRead(room.messages || []),
          lastMsgData: room.lastMsgData
            ? { ...room.lastMsgData, seen: [...new Set([...(room.lastMsgData.seen || []), readBy])], readTime }
            : room.lastMsgData,
        };
      }));
      setter((prev) => ({
        selectedRoom: prev.selectedRoom && prev.selectedRoom._id === roomID
          ? {
              ...prev.selectedRoom,
              messages: applyRead(prev.selectedRoom.messages || []),
              lastMsgData: prev.selectedRoom.lastMsgData
                ? { ...prev.selectedRoom.lastMsgData, seen: [...new Set([...(prev.selectedRoom.lastMsgData.seen || []), readBy])], readTime }
                : prev.selectedRoom.lastMsgData,
            }
          : prev.selectedRoom,
      }));
    });

    socket.on("seenMsg", ({ roomID, seenBy, readTime }) => {
      setRooms((prevRooms) =>
        prevRooms.map((room) => {
          if (room._id === roomID) {
            return {
              ...room,
              lastMsgData: {
                ...room.lastMsgData!,
                seen: [...new Set([...(room.lastMsgData?.seen || []), seenBy])],
                readTime,
              },
            };
          }
          return room;
        })
      );
    });

    socket.on("newMessageIdUpdate", ({ tempId, _id }) => {
      // Update the message in current room if visible
      if (selectedRoom) {
        setRooms((prevRooms) =>
          prevRooms.map((room) => {
            if (room._id === selectedRoom._id && room.messages) {
              return {
                ...room,
                messages: room.messages.map((msg) =>
                  msg.tempId === tempId ? { ...msg, _id, status: "sent" } : msg
                ),
              };
            }
            return room;
          })
        );
      }
    });

    socket.on("connect", () => {
      setStatus("Telegram");
      socket.emit("getRooms", userId);
      if (selectedRoom?._id) socket.emit("joining", selectedRoom._id);
    });

    const refreshSocketAuth = async () => {
      if (refreshingTokenRef.current || !socketRef.current) return;
      refreshingTokenRef.current = true;
      try {
        const response = await fetch("/api/auth/socket-token", { cache: "no-store" });
        if (!response.ok) return;
        const { token } = await response.json();
        const currentSocket = socketRef.current;
        if (!currentSocket) return;
        currentSocket.auth = { token };
        if (!currentSocket.connected) currentSocket.connect();
      } catch {
        // Keep the existing reconnect flow; the next connection attempt can retry.
      } finally {
        refreshingTokenRef.current = false;
      }
    };

    socket.on("disconnect", (reason) => {
      setStatus(
        <span>
          Connecting
          <Loading loading="dots" classNames="text-white mt-1.5" />
        </span>
      );
      if (reason === "io server disconnect") void refreshSocketAuth();
    });

    socket.on("connect_error", () => {
      void refreshSocketAuth();
      setStatus(
        <span>
          Connecting
          <Loading loading="dots" size="xs" classNames="text-white mt-1.5" />
        </span>
      );
    });

    socket.on("error", () => {
      setStatus(
        <span>
          Connecting
          <Loading loading="dots" size="xs" classNames="text-white mt-1.5" />
        </span>
      );
    });

    return () => {
      [
        "connect",
        "disconnect",
        "connect_error",
        "error",
        "joining",
        "getRooms",
        "createRoom",
        "updateLastMsgPos",
        "lastMsgUpdate",
        "updateOnlineUsers",
        "userProfileUpdated",
        "deleteRoom",
        "seenMsg",
        "roomRead",
        "updateRoomData",
        "channel:role",
        "channel:role:remove",
        "thread:event",
        "newMessageIdUpdate",
      ].forEach((event) => socket.off(event));
    };
  }, [selectedRoom, setter, userDataUpdater, userId]);

  const initializeSocket = useCallback(async () => {
    if (socketRef.current) return;
    try {
      const newSocket = io(process.env.NEXT_PUBLIC_SOCKET_SERVER_URL, {
        auth: async (cb) => {
          try {
            const response = await fetch("/api/auth/socket-token", { cache: "no-store" });
            if (!response.ok) return cb({ token: "" });
            const { token } = await response.json();
            cb({ token: typeof token === "string" ? token : "" });
          } catch {
            cb({ token: "" });
          }
        },
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        transports: ["websocket"],
      });
      socketRef.current = newSocket;
      setupSocketListeners();
      newSocket.connect();
    } catch {
      setStatus(<span>Connecting <Loading loading="dots" size="xs" classNames="text-white mt-1.5" /></span>);
    }
  }, [setupSocketListeners]);

  useEffect(() => {
    const handleOnline = () => {
      setStatus(
        <span>
          Connecting
          <Loading loading="dots" size="xs" classNames="text-white mt-1.5" />
        </span>
      );
      initializeSocket();
    };

    const handleOffline = () => {
      setStatus(
        <span>
          Connecting
          <Loading loading="dots" size="xs" classNames="text-white mt-1.5" />
        </span>
      );
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (!socketRef.current) {
      initializeSocket();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [initializeSocket]);

  useEffect(() => {
    if (socketRef.current && rooms.length) {
      updater("rooms", socketRef.current);
      userDataUpdater({ rooms });
    }
  }, [rooms, updater, userDataUpdater]);

  return { status, isPageLoaded, setRooms, socketRef };
};

export default useConnection;

import { useOnScreen } from "@/hook/useOnScreen";
import { dateString, getTimeFromDate, scrollToMessage } from "@/utils";
import { IoEye } from "react-icons/io5";
import { TiPin } from "react-icons/ti";
import Image from "next/image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MessageActions from "./MessageActions";
import MessageModel from "@/models/message";
import Voice from "@/models/voice";
import useSockets from "@/stores/useSockets";
import VoiceMessagePlayer from "./voice/VoiceMessagePlayer";
import { IoMdCheckmark } from "react-icons/io";
import useModalStore from "@/stores/modalStore";
import ProfileGradients from "../modules/ProfileGradients";
import { IoTimeOutline } from "react-icons/io5";
import { TbExclamationCircle } from "react-icons/tb";
import useGlobalStore from "@/stores/globalStore";

export interface msgDataProps {
  myId: string;
  tempId?: string;
  addReplay: (_id: string) => void;
  edit: (data: MessageModel) => void;
  pin: (_id: string) => void;
  isPv?: boolean;
  voiceData?: Voice | null;
  nextMessage: MessageModel;
  replayedToMessage: MessageModel | null;
  stickyDate?: string | null;
  isLastMessageFromUser: boolean;
  setEditData: (data: Partial<MessageModel>) => void;
  setReplayData: (data: Partial<MessageModel>) => void;
}

const Message = memo((msgData: MessageModel & msgDataProps) => {
  const {
    createdAt,
    message,
    seen,
    _id,
    sender,
    myId,
    roomID,
    replayedTo,
    isEdited,
    addReplay,
    edit,
    pin,
    isPv = false,
    nextMessage,
    voiceData: voiceDataProp,
    stickyDate,
    replayedToMessage,
    status,
  } = msgData;

  const [isMounted, setIsMounted] = useState(false);

  const messageRef = useRef<HTMLDivElement | null>(null);

  const rooms = useSockets((state) => state.rooms);
  const modalSetter = useModalStore((state) => state.setter);
  const isThisMessageSelected = useModalStore(
    useCallback((state) => state.msgData?._id === _id, [_id])
  );
  const setter = useGlobalStore((state) => state.setter);
  const selectionMode = useGlobalStore((state) => state.selectionMode);
  const isSelected = useGlobalStore((state) => state.selectedMessageIds.includes(_id));
  const enterMessageSelection = useGlobalStore((state) => state.enterMessageSelection);
  const toggleMessageSelection = useGlobalStore((state) => state.toggleMessageSelection);
  const reactionChoices = ["❤️", "👍", "😂", "🔥", "😮", "😢"];
  const selectedRoom = useGlobalStore((state) => state.selectedRoom);
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useOnScreen(messageRef, setIsInViewport);

  //Calculate whether the message is the last message from the current sender.
  const isLastMessageFromUser = useMemo(
    () => !nextMessage || nextMessage.sender._id !== sender._id,
    [nextMessage, sender]
  );
  // Check if the message was sent from me
  const isFromMe = useMemo(() => sender?._id === myId, [sender, myId]);

  const isChannel = useMemo(() => {
    return selectedRoom?.type === "channel";
  }, [selectedRoom?.type]);

  const isMeJoined = useMemo(() => {
    if (!selectedRoom) return false;
    const { participants, admins, creator } = selectedRoom;
    return (
      participants.find((user) => user === myId) ||
      admins.includes(myId) ||
      creator === myId
    );
  }, [selectedRoom, myId]);

  const canMessageAction = isMeJoined && isThisMessageSelected;
  const messageTime = useMemo(() => getTimeFromDate(createdAt), [createdAt]);
  const stickyDates = useMemo(() => dateString(createdAt), [createdAt]);

  // Open the sender's profile
  const openProfile = () => {
    setter({
      RoomDetailsData: sender,
      shouldCloseAll: true,
      isRoomDetailsShown: true,
    });
  };

  //Update modal data (for editing, replying, and pinning)
  const updateModalMsgData = (e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault();
      toggleMessageSelection(roomID, _id);
      return;
    }
    if (msgData._id === useModalStore.getState().msgData?._id) return;
    modalSetter((prev) => ({
      ...prev,
      clickPosition: { x: e.clientX, y: e.clientY },
      msgData,
      edit,
      reply: () => addReplay(_id),
      pin,
    }));
  };

  useEffect(() => {
    if (!isFromMe && !seen.some((id) => id === myId) && isInViewport && rooms) {
      rooms.emit("markRoomRead", {
        roomID,
        messageID: _id,
      });
    }
  }, [_id, isFromMe, isInViewport, myId, roomID, rooms, seen]);

  //Set display state only once after mount.
  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <>
      {stickyDate && (
        <div
          className="static top-20 text-xs bg-gray-800/80 w-fit mx-auto text-center rounded-2xl py-1 my-2 px-3 z-10"
          data-date={stickyDates}
        >
          {stickyDate}
        </div>
      )}

      <div
        ref={messageRef}
        className={`chat  w-full  ${isFromMe ? "chat-end " : "chat-start"} ${selectionMode && isSelected ? "bg-lightBlue/10 rounded-xl" : ""} ${
          isMounted ? "" : "opacity-0 scale-0"
        }`}
      >
        {selectionMode && (
          <button type="button" aria-label={isSelected ? "لغو انتخاب پیام" : "انتخاب پیام"} onClick={() => toggleMessageSelection(roomID, _id)} className={`absolute z-20 top-1 ${isFromMe ? "left-1" : "right-1"} size-6 rounded-full border-2 border-white/70 flex items-center justify-center ${isSelected ? "bg-lightBlue" : "bg-black/30"}`}>
            {isSelected ? "✓" : ""}
          </button>
        )}

        {/* Show sender avatar in received messages */}
        {!isFromMe &&
          !isPv &&
          !isChannel &&
          isLastMessageFromUser &&
          (sender.avatar ? (
            <div
              className="chat-image avatar cursor-pointer z-5"
              onClick={openProfile}
            >
              <div className="size-8 shrink-0 rounded-full">
                <Image
                  src={sender.avatar}
                  width={32}
                  height={32}
                  alt="avatar"
                  className="size-8 shrink-0 rounded-full "
                />
              </div>
            </div>
          ) : (
            <ProfileGradients
              classNames="size-8 chat-image avatar cursor-pointer z-10"
              id={sender?._id}
              onClick={openProfile}
            >
              {sender.name[0]}
            </ProfileGradients>
          ))}

        <div
          id="messageBox"
          onClick={updateModalMsgData}
          onContextMenu={(e) => { e.preventDefault(); enterMessageSelection(roomID, _id); }}
          onTouchStart={() => { longPressTimer.current = setTimeout(() => enterMessageSelection(roomID, _id), 450); }}
          onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
          onTouchMove={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
          className={`relative grid break-all w-fit max-w-[80%] min-w-32 xl:max-w-[60%] py-0 rounded-t-xl transition-all duration-200
            ${
              isFromMe
                ? `${
                    !isLastMessageFromUser ? "rounded-br-md col-start-1" : ""
                  } ${
                    canMessageAction ? "bg-darkBlue/60" : "bg-darkBlue"
                  } rounded-bl-xl rounded-br-lg px-1`
                : `${
                    canMessageAction ? "bg-gray-800/60" : "bg-gray-800"
                  } pr-1 rounded-br-xl pl-1`
            }
            ${
              !isLastMessageFromUser &&
              !isFromMe &&
              `${
                !isPv && !isChannel ? `ml-8` : "ml-0"
              } rounded-bl-md col-start-2`
            }
            ${isLastMessageFromUser ? "chat-bubble" : ""}`}
        >
          {!isFromMe && !isPv && (
            <p
              dir="auto"
              className="w-full text-xs font-vazirBold pt-2 pl-1 text-[#13d4d4]"
            >
              {isChannel
                ? selectedRoom?.name
                : sender.name + " " + sender.lastName}
            </p>
          )}

          <div className="flex flex-col text-sm gap-1 p-1 mt-1 wrap-break-word mb-3">
            {msgData.forwardedFrom && (
              <div className="flex items-center gap-2 text-lightBlue text-xs border-l-2 border-lightBlue/60 pl-2 mb-1">
                <span>↪</span>
                <span className="truncate">فوروارد از {msgData.forwardedFrom.senderName}</span>
              </div>
            )}
            {replayedToMessage && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToMessage(replayedToMessage?._id);
                }}
                className={`${
                  isFromMe
                    ? "bg-lightBlue/20 rounded-l-md"
                    : "bg-green-500/15 rounded-r-md"
                } cursor-pointer rounded-md rounded-t-md text-sm relative w-full py-1 px-3 overflow-hidden`}
              >
                <span
                  className={`absolute ${
                    isFromMe ? "bg-white" : "bg-green-500"
                  } left-0 inset-y-0 w-0.75 h-full`}
                ></span>
                <p className="font-vazirBold text-xs wrap-break-word text-start line-clamp-1 text-ellipsis">
                  {replayedToMessage.hideFor.includes(myId)
                    ? "Message deleted"
                    : replayedTo?.username}
                </p>
                <p className="font-thin wrap-break-word line-clamp-1 text-ellipsis text-left text-xs whitespace-pre-wrap">
                  {!replayedToMessage.hideFor.includes(myId) &&
                    (replayedTo?.message || "Voice Message")}
                </p>
              </div>
            )}
            {msgData.stickerData?.emoji && <div className="text-6xl leading-none py-2 text-center">{msgData.stickerData.emoji}</div>}
            {msgData.attachmentData && <div className="w-full mt-2" onClick={(e)=>e.stopPropagation()}>
              {msgData.attachmentData.mimeType.startsWith("image/") ? <a href={msgData.attachmentData.src} target="_blank" rel="noreferrer"><img src={msgData.attachmentData.src} alt={msgData.attachmentData.name} className="max-h-80 max-w-full rounded-xl object-contain"/></a>
              : msgData.attachmentData.mimeType.startsWith("video/") ? <video controls preload="metadata" src={msgData.attachmentData.src} className="max-h-80 max-w-full rounded-xl"/>
              : msgData.attachmentData.mimeType.startsWith("audio/") ? <audio controls preload="metadata" src={msgData.attachmentData.src} className="max-w-full"/>
              : <a href={msgData.attachmentData.src} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl bg-black/20 px-4 py-3"><span className="text-2xl">📎</span><span className="min-w-0"><span className="block truncate font-vazirBold">{msgData.attachmentData.name}</span><span className="text-xs text-white/60">{Math.ceil(msgData.attachmentData.size/1024)} KB</span></span></a>}
            </div>}
            {voiceDataProp && (
              <div className="flex items-center gap-3 bg-inherit w-full mt-2">
                <VoiceMessagePlayer
                  _id={_id}
                  voiceDataProp={voiceDataProp}
                  msgData={msgData}
                  isFromMe={isFromMe}
                  myId={myId}
                  roomID={roomID}
                />
              </div>
            )}
            <p dir="auto" className="text-white break-all whitespace-pre-wrap">
              {message}
            </p>
            {msgData.reactions?.length ? (
              <div className="flex flex-wrap gap-1 mt-1 pr-1" onClick={(e) => e.stopPropagation()}>
                {msgData.reactions.map((reaction) => (
                  <button
                    key={reaction.emoji}
                    type="button"
                    title={reaction.userIds.includes(myId) ? "برداشتن واکنش" : "واکنش"}
                    onClick={() => rooms?.emit("toggleReaction", { msgID: _id, roomID, emoji: reaction.emoji })}
                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${reaction.userIds.includes(myId) ? "bg-lightBlue/30 border-lightBlue/60" : "bg-black/20 border-white/10"}`}
                  >
                    {reaction.emoji} {reaction.userIds.length}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
              {reactionChoices.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`واکنش ${emoji}`}
                  onClick={() => rooms?.emit("toggleReaction", { msgID: _id, roomID, emoji })}
                  className="size-7 rounded-full bg-black/10 hover:bg-white/10 text-sm transition-transform hover:scale-110"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <span
            className={`flex items-end justify-end gap-1.5 absolute bottom-0 right-1 w-full text-sm ${
              isFromMe ? "text-[#B7D9F3]" : "text-darkGray"
            } text-right`}
          >
            {isChannel && (
              <div className="flex items-end text-[10px]">
                <IoEye size={14} className="mb-[1.2px] mr-0.5" />
                {seen.length > 0 ? seen.length : ""}
              </div>
            )}
            {msgData?.pinnedAt && (
              <TiPin data-aos="zoom-in" className="size-4" />
            )}
            <p
              className={`whitespace-nowrap text-[10px] ${!isFromMe && "pr-1"}`}
            >
              {isEdited && "edited "} {messageTime}
            </p>
            {isFromMe && !isChannel && (
              <>
                {status === "pending" && (
                  <IoTimeOutline className="size-4 mb-0.5" />
                )}
                {status === "failed" && (
                  <TbExclamationCircle className="size-4 mb-0.5 text-red-500" />
                )}
                {status !== "pending" &&
                  status !== "failed" &&
                  (seen?.length ? (
                    <Image
                      src="/shapes/seen.svg"
                      width={15}
                      height={15}
                      className="size-4 mb-0.5 duration-500"
                      alt="seen"
                    />
                  ) : (
                    <IoMdCheckmark
                      width={15}
                      height={15}
                      className="size-4 mb-0.5 rounded-full bg-center duration-500"
                    />
                  ))}
              </>
            )}
          </span>
        </div>
        {canMessageAction && (
          <MessageActions isFromMe={isFromMe} msgData={msgData} />
        )}
      </div>
    </>
  );
});

Message.displayName = "Message";

export default Message;

import { useMemo, memo } from "react";
import { dateString } from "@/utils";
import Message from "./Message";
import MessageModel from "@/models/message";

interface MsgDate {
  date: string;
  usedBy: string;
}

interface MessageListProps {
  messages: MessageModel[];
  myID: string;
  type: string;
  lastMsgRef: React.RefObject<HTMLDivElement | null>;
  setEditData: React.Dispatch<React.SetStateAction<MessageModel | null>>;
  setReplayData: React.Dispatch<React.SetStateAction<string | null>>;
  pinMessage: (id: string) => void;
}

const MessageList = ({
  messages,
  myID,
  type,
  lastMsgRef,
  setEditData,
  setReplayData,
  pinMessage,
}: MessageListProps) => {
  const firstUnreadId = messages?.find((msg) => msg.sender?._id !== myID && !msg.seen?.includes(myID))?._id;

  const messageContent = useMemo(() => {
    const dates: MsgDate[] = [];
    return messages?.length ? (
      messages.map((data, index) => {
        if (data?.hideFor?.includes(myID)) return null;

        const isDateUsed = dates.some(
          (date) =>
            date.date === dateString(data.createdAt) || date.usedBy === data._id
        );

        if (!isDateUsed) {
          dates.push({ date: dateString(data.createdAt), usedBy: data._id });
        }

        const stickyDate =
          dates.find((date) => date.usedBy === data._id)?.date || null;

        return (
          <>
            {data._id === firstUnreadId && (
              <div
                data-unread-divider="true"
                className="sticky top-1 z-10 mx-auto my-2 w-fit rounded-full bg-lightBlue/20 px-3 py-1 text-xs text-lightBlue backdrop-blur"
              >
                پیام‌های خوانده‌نشده
              </div>
            )}
            <div
              className={`${data._id} highLightedMessage`}
            key={data._id}
            ref={index === messages.length - 1 ? lastMsgRef : null}
          >
            <Message
              isLastMessageFromUser={
                messages[index + 1]?.sender._id !== data.sender._id
              }
              setEditData={(data) => setEditData(data as MessageModel)}
              setReplayData={(data) => setReplayData(data.message || null)}
              addReplay={(replyData) => {
                setEditData(null);
                setReplayData(replyData);
              }}
              edit={() => {
                setReplayData(null);
                setEditData(data);
              }}
              pin={pinMessage}
              myId={myID}
              isPv={type === "private"}
              stickyDate={stickyDate}
              nextMessage={messages[index + 1] || null}
              replayedToMessage={
                messages.find((msg) => msg._id === data.replayedTo?.msgID) ||
                null
              }
              {...data}
            />
            </div>
          </>
        );
      })
    ) : (
      <div className="flex-center size-full pb-[40vh]">
        <p className="rounded-full w-fit text-sm py-1 px-3 text-center bg-gray-800/80">
          Send a message to start the chat
        </p>
      </div>
    );
  }, [
    messages,
    myID,
    firstUnreadId,
    type,
    lastMsgRef,
    setEditData,
    setReplayData,
    pinMessage,
  ]);

  return <>{messageContent}</>;
};

export default memo(MessageList);

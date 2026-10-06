"use client";

import useGlobalStore from "@/stores/globalStore";
import useUserStore from "@/stores/userStore";
import useSockets from "@/stores/useSockets";
import React, {
  lazy,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  Suspense,
} from "react";
import { BiSearch } from "react-icons/bi";
import { RxHamburgerMenu } from "react-icons/rx";

import ChatCard from "./ChatCard";
import RoomSkeleton from "../modules/ui/RoomSkeleton";
import RoomFolders from "./RoomFolders";
import useConnection from "@/hook/useConnection";
import Message from "@/models/message";
import NotificationPermission from "@/utils/NotificationPermission";
import CallHistory from "./CallHistory";
import { FiPhoneCall, FiBell } from "react-icons/fi";

const CreateRoomBtn = lazy(() => import("@/components/leftBar/CreateRoomBtn"));
const LeftBarMenu = lazy(() => import("@/components/leftBar/menu/LeftBarMenu"));
const SearchPage = lazy(() => import("@/components/leftBar/SearchPage"));
const CreateRoom = lazy(() => import("@/components/leftBar/CreateRoom"));

const LeftBar = () => {
  const [filterBy, setFilterBy] = useState("all");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLeftBarMenuOpen, setIsLeftBarMenuOpen] = useState(false);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [leftBarActiveRoute, setLeftBarActiveRoute] = useState("/");
  const [showThreadEvents, setShowThreadEvents] = useState(false);
  const ringAudioRef = useRef<HTMLAudioElement>(null);

  const userId = useUserStore((state) => state._id);
  const { updater, rooms: roomsSocket } = useSockets((state) => state);
  const { setter: userDataUpdater, rooms: userRooms } = useUserStore(
    (state) => state
  );

  const {
    selectedRoom,
    setter,
    isRoomDetailsShown,
    createRoomType,
    showCreateRoomBtn,
    threadEvents,
  } = useGlobalStore((state) => state);
  const interactUser = useRef(false);

  useEffect(() => {
    NotificationPermission();
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    const markInteracted = () => { interactUser.current = true; };
    document.addEventListener("click", markInteracted);
    return () => document.removeEventListener("click", markInteracted);
  }, []);

  const playRingSound = useCallback(() => {
    if (ringAudioRef.current && interactUser.current) {
      ringAudioRef.current.currentTime = 0;
      ringAudioRef.current.play();
    }
  }, []);

  useEffect(() => {
    const handleNewMessage = async (newMsg: Message) => {
      if (newMsg.roomID !== selectedRoom?._id || !selectedRoom?._id) {
        if (document.visibilityState !== "visible") {
          if (
            "serviceWorker" in navigator &&
            Notification.permission === "granted"
          ) {
            const registration = await navigator.serviceWorker.ready;
            registration.showNotification(newMsg.sender.name || "", {
              body: newMsg.message || "",
              icon: newMsg.sender.avatar || "/images/favicon.svg",
              data: { url: window.location.href },
              dir: "auto",
              badge: "/images/favicon-96x96.png",
              silent: true,
            });
          }
        }
        playRingSound();
      }
    };

    roomsSocket?.on("newMessage", handleNewMessage);

    return () => {
      roomsSocket?.off("newMessage", handleNewMessage);
    };
  }, [playRingSound, roomsSocket, selectedRoom]);

  const { status, isPageLoaded } = useConnection({
    selectedRoom,
    setter,
    userId,
    userDataUpdater,
    updater,
  });

  //Sort rooms by filter and last message time
  const sortedRooms = useMemo(() => {
    const filteredRooms =
      filterBy === "all"
        ? userRooms
        : userRooms.filter((room) => room.type === filterBy);

    return [...filteredRooms].sort((a, b) => {
      const aTime = a?.lastMsgData?.createdAt
        ? new Date(a.lastMsgData.createdAt).getTime()
        : 0;
      const bTime = b?.lastMsgData?.createdAt
        ? new Date(b.lastMsgData.createdAt).getTime()
        : 0;
      return bTime - aTime;
    });
  }, [userRooms, filterBy]);

  const handleThreadEventClick = useCallback((event: { room: string; message?: string }) => {
    const room = userRooms.find((item) => item._id === event.room);
    if (!room) return;
    setter({ selectedRoom: room, rightBarRoute: "/" });
    roomsSocket?.emit("joining", room._id);
    if (event.message) useGlobalStore.getState().setPendingMessageJump(event.message);
    setShowThreadEvents(false);
  }, [roomsSocket, setter, userRooms]);

  const handleOpenLeftBarMenu = useCallback(() => {
    setIsLeftBarMenuOpen(true);
  }, []);

  const handleCloseLeftBarMenu = useCallback(() => {
    setIsLeftBarMenuOpen(false);
  }, []);

  const handleOpenSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const containerClassName = useMemo(() => {
    return `size-full h-dvh ${
      selectedRoom ? "hidden" : ""
    } md:block md:w-[40%] lg:w-[35%] ${
      isRoomDetailsShown ? "xl:w-[25%]" : "xl:w-[30%]"
    } relative border-r border-chatBg/[50%]`;
  }, [selectedRoom, isRoomDetailsShown]);

  return (
    <>
      <div className={containerClassName}>
        <LeftBarMenu
          isOpen={isLeftBarMenuOpen}
          closeMenu={handleCloseLeftBarMenu}
          onRouteChanged={setLeftBarActiveRoute}
        />
        {createRoomType && (
          <Suspense>
            <CreateRoom />
          </Suspense>
        )}
        {isPageLoaded && showCreateRoomBtn && <CreateRoomBtn />}
        {isSearchOpen && <SearchPage closeSearch={handleCloseSearch} />}
        {showThreadEvents && (
          <div className="absolute top-16 right-2 z-50 w-[min(22rem,calc(100vw-1rem))] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-gray-900/95 shadow-2xl backdrop-blur p-2">
            <div className="flex items-center justify-between px-2 py-2 border-b border-white/10">
              <span className="font-vazirBold text-white">اعلان‌ها</span>
              <button type="button" onClick={() => setShowThreadEvents(false)} className="text-white/50 hover:text-white">×</button>
            </div>
            {threadEvents.length ? threadEvents.map((event) => (
              <button key={event._id} type="button" onClick={() => handleThreadEventClick(event)} className="w-full text-right rounded-xl px-3 py-3 hover:bg-white/10 border-b border-white/5 last:border-0">
                <div className="text-sm text-white">{event.type === "mention" ? "در یک پیام منشن شدید" : event.type === "reaction" ? `واکنش ${event.data?.emoji || ""} به پیام شما` : "اعلان جدید"}</div>
                <div className="text-[11px] text-white/40 mt-1">{new Date(event.createdAt).toLocaleString("fa-IR")}</div>
              </button>
            )) : <div className="p-5 text-center text-sm text-white/50">اعلانی ندارید</div>}
          </div>
        )}

        {showCallHistory && <CallHistory onClose={() => setShowCallHistory(false)} />}
        {leftBarActiveRoute !== "/settings" && (
          <div
            data-aos-duration="400"
            data-aos="fade-right"
            id="leftBar-container"
            className="flex-1 bg-leftBarBg h-full relative scroll-w-none overflow-y-auto "
          >
            <div
              className="w-full sticky top-0 bg-leftBarBg border-b border-white/5 h-20 overflow-hidden"
              style={{ zIndex: 1 }}
            >
              <div className="flex items-center justify-between gap-6 mx-3">
                <div className="flex items-center flex-1 gap-5 mt-3 w-full text-white">
                  <RxHamburgerMenu
                    size={20}
                    onClick={handleOpenLeftBarMenu}
                    className="cursor-pointer"
                  />
                  <h1 className="font-vazirBold mt-0.5">{status}</h1>
                </div>
                <div className="flex items-center gap-3">
                  <FiPhoneCall size={20} onClick={() => setShowCallHistory(true)} className="cursor-pointer text-white/90 mt-3" title="Call history" />
                  <button type="button" onClick={() => setShowThreadEvents((value) => !value)} className="relative mt-3 p-0.5 text-white/90" title="Mentions and reactions">
                    <FiBell size={20} />
                    {threadEvents.length > 0 && <span className="absolute -right-1 -top-2 min-w-4 h-4 px-1 rounded-full bg-lightBlue text-black text-[9px] font-bold flex items-center justify-center">{threadEvents.length > 99 ? "99+" : threadEvents.length}</span>}
                  </button>
                  <BiSearch size={22} onClick={handleOpenSearch} className="cursor-pointer text-white/90 mt-3" />
                </div>
              </div>
              <RoomFolders updateFilterBy={setFilterBy} />
            </div>

            <div
              className="flex flex-col overflow-y-auto overflow-x-hidden scroll-w-none w-full"
              style={{ zIndex: 0 }}
            >
              {isPageLoaded ? (
                sortedRooms.length ? (
                  sortedRooms.map((data) => (
                    <ChatCard {...data} key={data?._id} />
                  ))
                ) : (
                  <div className="text-xl text-white font-bold w-full text-center font-vazirBold pt-20">
                    No chats found
                  </div>
                )
              ) : (
                <RoomSkeleton />
              )}
            </div>
          </div>
        )}
        <audio
          ref={ringAudioRef}
          className="hidden invisible opacity-0"
          src="/files/new_msg.mp3"
        ></audio>
      </div>
    </>
  );
};

export default LeftBar;

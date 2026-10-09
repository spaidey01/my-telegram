"use client";
import useGlobalStore from "@/stores/globalStore";
import { lazy, Suspense } from "react";
import Loading from "../modules/ui/Loading";
import AudioManager from "./voice/AudioManager";

const ChatPage = lazy(() => import("./ChatPage"));

const MiddleBar = () => {
  const { selectedRoom, isRoomDetailsShown } = useGlobalStore((state) => state);

  return (
    <div
      className={` chatBackground relative ${
        !selectedRoom && "hidden"
      }  md:block md:w-[60%] lg:w-[65%] ${
        isRoomDetailsShown ? "xl:w-[50%]" : "xl:w-[70%]"
      }   text-white overflow-x-hidden  scroll-w-none size-full `}
    >
      <AudioManager />
      {selectedRoom !== null ? (
        <Suspense
          fallback={
            <div className="size-full h-screen flex-center">
              <Loading size="xl" />
            </div>
          }
        >
          <ChatPage />
        </Suspense>
      ) : (
        <div className="relative size-full min-h-dvh overflow-hidden flex items-center justify-center bg-[#080513]">
          <div className="absolute -top-32 left-1/2 size-72 -translate-x-1/2 rounded-full bg-[#4f08ec]/10 blur-3xl" />
          <div className="absolute -bottom-24 right-10 size-64 rounded-full bg-[#9a2df6]/10 blur-3xl" />
          <div className="relative flex flex-col items-center text-center px-6 select-none">
            <div className="relative mb-7">
              <div className="absolute inset-0 scale-125 rounded-[2rem] bg-[#4f08ec]/15 blur-2xl animate-pulse" />
              <img
                src="/images/stargram-logo.svg"
                alt="Stargram"
                className="relative size-28 object-contain drop-shadow-[0_0_28px_rgba(94,235,255,0.2)]"
              />
            </div>
            <h2 className="font-vazirBold text-2xl md:text-3xl text-white tracking-tight">
              Welcome to Stargram
            </h2>
            <p className="mt-2 text-sm md:text-base text-white/45">
              a place made with love
            </p>
            <div className="mt-5 h-px w-16 bg-gradient-to-r from-transparent via-[#5eebff]/60 to-transparent" />
            <p className="mt-4 text-xs text-white/25">
              یک گفتگو را انتخاب کنید تا شروع کنیم
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default MiddleBar;

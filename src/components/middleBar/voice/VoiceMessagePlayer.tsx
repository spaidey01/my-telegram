import { memo, useEffect, useMemo, useRef, useState } from "react";
import useAudio from "@/stores/audioStore";
import useSockets from "@/stores/useSockets";
import { FaPlay, FaPause, FaArrowDown } from "react-icons/fa";
import { IoClose } from "react-icons/io5";
import { IoMdDownload } from "react-icons/io";
import Loading from "../../modules/ui/Loading";
import MessageModel from "@/models/message";
import Voice from "@/models/voice";
import AudioWaveDisplay from "./AudioWaveDisplay";
import CircularProgress from "../../modules/ui/CircularProgress";

interface Props {
  _id: string;
  voiceDataProp: Voice | null | undefined;
  msgData: MessageModel;
  isFromMe: boolean;
  myId: string;
  roomID: string;
}

const VoiceMessagePlayer = memo(({ _id, voiceDataProp, msgData, isFromMe, myId, roomID }: Props) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [rateMenu, setRateMenu] = useState(false);
  const isPlaying = useAudio((s) => s.isPlaying);
  const voiceData = useAudio((s) => s.voiceData);
  const audioElem = useAudio((s) => s.audioElem);
  const downloadedAudios = useAudio((s) => s.downloadedAudios);
  const setAudioElement = useAudio((s) => s.setAudioElement);
  const setVoiceDataAndPlay = useAudio((s) => s.setVoiceDataAndPlay);
  const toggleAudioPlayback = useAudio((s) => s.toggleAudioPlayback);
  const downloadVoice = useAudio((s) => s.downloadVoice);
  const clearVoiceCache = useAudio((s) => s.clearVoiceCache);
  const playbackRate = useAudio((s) => s.playbackRate);
  const setPlaybackRate = useAudio((s) => s.setPlaybackRate);
  const currentTime = useAudio((s) => s.currentTime);

  useEffect(() => {
    if (audioRef.current) setAudioElement(audioRef.current);
    return () => {
      if (audioRef.current && useAudio.getState().audioElem === audioRef.current) {
        audioRef.getState?.();
        useAudio.getState().audioElem?.pause();
        useAudio.getState().setter({ audioElem: null, isPlaying: false, voiceData: null });
      }
    };
  }, [setAudioElement]);

  const cached = downloadedAudios.find((audio) => audio._id === _id);
  const isCurrent = voiceData?._id === _id;
  const isDownloading = !!cached?.isDownloading;
  const isDownloaded = !!cached?.downloaded;

  useEffect(() => {
    if (!isDownloaded && voiceDataProp?.src && isCurrent && !isDownloading) {
      void downloadVoice({ ...voiceDataProp, ...msgData });
    }
  }, [isCurrent, isDownloaded, isDownloading, msgData, voiceDataProp, downloadVoice]);

  const togglePlay = async () => {
    if (!voiceDataProp?.src) return;
    const socket = useSockets.getState().rooms;
    if (!isFromMe && !voiceDataProp.playedBy?.includes(myId)) {
      socket?.emit("listenToVoice", { userID: myId, voiceID: _id, roomID });
    }

    if (!isDownloaded) {
      await downloadVoice({ ...voiceDataProp, ...msgData });
      const fresh = useAudio.getState().downloadedAudios.find((x) => x._id === _id);
      if (!fresh?.src) return;
      await setVoiceDataAndPlay({ ...voiceDataProp, ...msgData }, fresh.src);
      return;
    }

    if (isCurrent) toggleAudioPlayback();
    else await setVoiceDataAndPlay({ ...voiceDataProp, ...msgData }, cached?.src);
  };

  const changeRate = (rate: number) => {
    setPlaybackRate(rate);
    setRateMenu(false);
  };

  const handleDownload = async () => {
    await downloadVoice({ ...voiceDataProp!, ...msgData });
  };

  const icon = useMemo(() => {
    if (msgData.status === "pending" && msgData.uploadProgress !== undefined) {
      return <div className="relative flex-center"><CircularProgress progress={msgData.uploadProgress} /><IoClose className="absolute size-6" /></div>;
    }
    if (isDownloading) return <span className="relative flex-center"><Loading classNames="absolute w-9" /><IoClose className="size-6" /></span>;
    if (isCurrent && isPlaying) return <FaPause className="size-4" />;
    return isDownloaded ? <FaPlay className="ml-0.5 size-4" /> : <FaArrowDown className="size-4" />;
  }, [isCurrent, isDownloaded, isDownloading, isPlaying, msgData.status, msgData.uploadProgress]);

  if (!voiceDataProp) return null;

  return (
    <div className={`flex min-w-0 items-center gap-2 ${isFromMe ? "text-white" : "text-gray-700"}`}>
      <button type="button" aria-label={isPlaying && isCurrent ? "توقف پخش" : "پخش پیام صوتی"} className={`relative flex size-10 shrink-0 items-center justify-center rounded-full ${isFromMe ? "bg-white text-darkBlue" : "bg-darkBlue text-white"}`} onClick={(e) => { e.stopPropagation(); void togglePlay(); }}>
        {icon}
      </button>
      <AudioWaveDisplay _id={_id} voiceDataProp={voiceDataProp} />
      <div className="relative shrink-0">
        <button type="button" aria-label="سرعت پخش" onClick={() => setRateMenu((v) => !v)} className="rounded px-1 text-[10px] font-bold">{playbackRate}x</button>
        {rateMenu && (
          <div className="absolute bottom-full right-0 z-30 mb-1 flex gap-1 rounded bg-black/80 p-1">
            {[1, 1.5, 2].map((rate) => <button key={rate} type="button" onClick={() => changeRate(rate)} className="rounded px-1.5 py-1 text-[10px]">{rate}x</button>)}
        </div>
        )}
      </div>
      <button type="button" aria-label="دانلود پیام صوتی" onClick={(e) => { e.stopPropagation(); void handleDownload(); }} className="p-1">
        <IoMdDownload className="size-4" />
      </button>
      {isDownloaded && <button type="button" aria-label="پاک کردن cache" onClick={(e) => { e.stopPropagation(); void clearVoiceCache(_id); }} className="hidden" />}
      {isCurrent && <span className="sr-only">{currentTime}</span>}
      <audio ref={audioRef} preload="metadata" className="hidden" />
    </div>
  );
});

VoiceMessagePlayer.displayName = "VoiceMessagePlayer";
export default VoiceMessagePlayer;

"use client";

import Message from "@/models/message";
import useGlobalStore, { GlobalStoreProps } from "@/stores/globalStore";
import useUserStore from "@/stores/userStore";
import useSockets from "@/stores/useSockets";
import { createUploadTask } from "@/utils/file/UploadFile";
import { secondsToTimeString, toaster } from "@/utils";
import { voiceBlobStorage } from "@/utils/voiceBlobStorage";
import { useCallback, useEffect, useRef, useState } from "react";
import { PiMicrophoneLight } from "react-icons/pi";
import { IoClose, IoPlay, IoRefresh, IoStop, IoTrash } from "react-icons/io5";
import { RiSendPlaneFill } from "react-icons/ri";
import { v4 as uuidv4 } from "uuid";

interface Props {
  replayData: Partial<Message> | undefined;
  closeEdit: () => void;
  closeReplay: () => void;
}

type RecorderState = "idle" | "recording" | "preview" | "uploading" | "sent" | "failed";

const BAR_COUNT = 28;

export default function VoiceMessageRecorder({ replayData, closeEdit, closeReplay }: Props) {
  const selectedRoom = useGlobalStore((state) => state.selectedRoom);
  const myData = useUserStore((state) => state);
  const setter = useGlobalStore((state) => state.setter);
  const rooms = useSockets((state) => state.rooms);

  const [state, setState] = useState<RecorderState>("idle");
  const [duration, setDuration] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(Array.from({ length: BAR_COUNT }, () => 0.2));

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uploadTaskRef = useRef<{ cancel: () => void } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef("");
  const roomRef = useRef<string | undefined>(selectedRoom?._id);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformFrameRef = useRef<number | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearPreview = useCallback(() => {
    uploadTaskRef.current?.cancel();
    uploadTaskRef.current = null;
    audioRef.current?.pause();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
    setBlob(null);
    setPlaying(false);
    setProgress(0);
    setError("");
    setDuration(0);
    durationRef.current = 0;
    setState("idle");
  }, []);

  const stopWaveform = useCallback(() => {
    if (waveformFrameRef.current !== null) cancelAnimationFrame(waveformFrameRef.current);
    waveformFrameRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, []);

  const startWaveform = useCallback((stream: MediaStream) => {
    try {
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyserRef.current = analyser;
      audioContextRef.current = context;
      const draw = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        setWaveform(Array.from({ length: BAR_COUNT }, (_, index) => {
          const value = data[Math.min(data.length - 1, Math.floor(index * data.length / BAR_COUNT))] / 255;
          return Math.max(0.12, Math.min(1, value));
        }));
        waveformFrameRef.current = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      setWaveform(Array.from({ length: BAR_COUNT }, () => 0.2));
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (state !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toaster("error", "مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.");
      return;
    }

    try {
      setError("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/webm",
        "audio/ogg",
      ].find((type) => MediaRecorder.isTypeSupported(type));

      if (!mimeType) {
        stream.getTracks().forEach((track) => track.stop());
        toaster("error", "فرمت مناسب ضبط صدا در این مرورگر پیدا نشد.");
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      streamRef.current = stream;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      durationRef.current = 0;
      setDuration(0);
      setWaveform(Array.from({ length: BAR_COUNT }, () => 0.2));

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        chunksRef.current = [];
        recorderRef.current = null;
        stopStream();
        setState("idle");
        setError("ضبط صدا با خطا متوقف شد.");
      };

      recorder.onstop = () => {
        stopStream();
        recorderRef.current = null;

        const audioBlob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        chunksRef.current = [];
        if (!audioBlob.size) {
          setState("idle");
          setError("صدایی ضبط نشد.");
          return;
        }

        const url = URL.createObjectURL(audioBlob);
        previewUrlRef.current = url;
        setBlob(audioBlob);
        setPreviewUrl(url);
        setState("preview");
      };

      recorder.start(250);
      setState("recording");

      timerRef.current = setInterval(() => {
        const seconds = Math.min(3600, Math.floor((Date.now() - startedAtRef.current) / 1000));
        durationRef.current = seconds;
        setDuration(seconds);
        setWaveform((bars) => bars.map((_, index) => Math.max(0.15, ((Date.now() / 180 + index * 7) % 100) / 100)));
        if (seconds >= 3600) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          if (recorder.state !== "inactive") recorder.stop();
        }
      }, 250);
    } catch (err) {
      console.error(err);
      stopStream();
      setState("idle");
      toaster("error", "دسترسی میکروفون داده نشد یا میکروفون در دسترس نیست.");
    }
  }, [state, startWaveform, stopStream, stopWaveform]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    chunksRef.current = [];
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
    stopStream();
    setState("idle");
    setDuration(0);
    durationRef.current = 0;
  }, [stopStream]);

  const togglePreview = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, []);

  const replayPayload = useCallback(() => replayData?._id ? ({
    targetID: replayData._id,
    replayedTo: {
      message: replayData.message || "",
      msgID: replayData._id,
      username: replayData.sender?.name || "",
    },
  }) : null, [replayData]);

  const sendMessage = useCallback(async (src: string, tempId: string) => {
    if (!selectedRoom?._id || !rooms) throw new Error("Room unavailable");

    const voiceData = { src, duration: durationRef.current, playedBy: [] };
    const localMessage = {
      _id: tempId,
      message: "",
      sender: myData,
      isEdited: false,
      seen: [],
      readTime: null,
      replays: [],
      pinnedAt: null,
      hideFor: [],
      updatedAt: new Date().toISOString(),
      roomID: selectedRoom._id,
      status: "pending" as const,
      voiceData,
      replayedTo: replayPayload()?.replayedTo || null,
      createdAt: new Date().toISOString(),
      tempId,
    } as Message;

    setter((prev: GlobalStoreProps) => ({
      selectedRoom: prev.selectedRoom
        ? { ...prev.selectedRoom, messages: [...prev.selectedRoom.messages, localMessage] }
        : null,
    }));

    await new Promise<void>((resolve, reject) => {
      rooms.emit("newMessage", {
        roomID: selectedRoom._id,
        message: "",
        sender: myData,
        replayData: replayPayload(),
        voiceData,
        tempId,
      }, (response: { success: boolean; _id?: string; error?: string }) => {
        if (!response?.success || !response._id) {
          reject(new Error(response?.error || "ارسال پیام صوتی ناموفق بود."));
          return;
        }

        setter((prev: GlobalStoreProps) => ({
          selectedRoom: prev.selectedRoom ? {
            ...prev.selectedRoom,
            messages: prev.selectedRoom.messages.map((msg) =>
              msg._id === tempId ? { ...msg, _id: response._id!, status: "sent" } : msg
            ),
          } : null,
        }));
        resolve();
      });
    });
  }, [myData, replayPayload, rooms, selectedRoom?._id, setter]);

  const upload = useCallback(async () => {
    if (!blob || !selectedRoom?._id || (state !== "preview" && state !== "failed")) return;

    const tempId = uuidv4();
    setState("uploading");
    setProgress(0);
    setError("");

    await voiceBlobStorage.saveBlob(tempId, blob).catch(() => {});

    const extension = blob.type.includes("webm") ? "webm" : "ogg";
    const file = new File([blob], `voice-message-${tempId}.${extension}`, {
      type: blob.type || "audio/webm",
    });
    const task = createUploadTask(file, setProgress);
    uploadTaskRef.current = { cancel: task.cancel };

    try {
      const result = await task.promise;
      uploadTaskRef.current = null;

      if (!result.success || !result.downloadUrl) {
        throw new Error(result.error || "آپلود پیام صوتی ناموفق بود.");
      }

      await sendMessage(result.downloadUrl, tempId);
      await voiceBlobStorage.deleteBlob(tempId).catch(() => {});
      setProgress(100);
      setState("sent");
      closeEdit();
      closeReplay();
      clearPreview();
    } catch (err) {
      uploadTaskRef.current = null;
      if (err instanceof DOMException && err.name === "AbortError") {
        setState("preview");
        return;
      }
      setError(err instanceof Error ? err.message : "آپلود پیام صوتی ناموفق بود.");
      setState("failed");
    }
  }, [blob, clearPreview, closeEdit, closeReplay, sendMessage, selectedRoom?._id, state]);

  const cancelUpload = useCallback(() => {
    uploadTaskRef.current?.cancel();
    uploadTaskRef.current = null;
    setState("preview");
  }, []);

  useEffect(() => {
    if (roomRef.current === undefined) {
      roomRef.current = selectedRoom?._id;
      return;
    }
    if (roomRef.current === selectedRoom?._id) return;
    uploadTaskRef.current?.cancel();
    uploadTaskRef.current = null;
    stopStream();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreviewUrl("");
    setBlob(null);
    setProgress(0);
    setError("");
    setState("idle");
    roomRef.current = selectedRoom?._id;
  }, [selectedRoom?._id, stopStream]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    uploadTaskRef.current?.cancel();
    stopStream();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, [stopStream]);

  const bars = waveform.map((height, index) => (
    <span key={index} className="w-1 rounded-full bg-lightBlue transition-all" style={{ height: `${Math.max(4, Math.round(height * 28))}px` }} />
  ));

  if (state === "idle" || state === "sent") {
    return (
      <button type="button" aria-label="ضبط پیام صوتی" onClick={() => void startRecording()} className="size-6 cursor-pointer">
        <PiMicrophoneLight className="size-6" />
      </button>
    );
  }

  if (state === "recording") {
    return (
      <div className="absolute inset-0 z-20 flex items-center gap-2 bg-leftBarBg px-2">
        <button type="button" aria-label="لغو ضبط" onClick={cancelRecording} className="p-2 text-red-500"><IoTrash className="size-5" /></button>
        <span className="w-10 text-xs tabular-nums">{secondsToTimeString(duration)}</span>
        <div className="flex flex-1 items-center gap-0.5 overflow-hidden" aria-label="waveform">{bars}</div>
        <button type="button" aria-label="پایان ضبط" onClick={stopRecording} className="rounded-full bg-lightBlue p-2"><IoStop className="size-5" /></button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center gap-2 bg-leftBarBg px-2">
      <button type="button" aria-label="لغو پیش‌نمایش" onClick={clearPreview} className="p-2 text-red-500"><IoClose className="size-5" /></button>
      <button type="button" aria-label="پخش پیش‌نمایش" onClick={togglePreview} className="rounded-full bg-lightBlue p-2">
        {playing ? <IoStop className="size-4" /> : <IoPlay className="size-4" />}
      </button>
      <span className="w-10 text-xs tabular-nums">{secondsToTimeString(duration)}</span>
      <div className="flex flex-1 items-center gap-0.5 overflow-hidden">{bars}</div>
      {state === "uploading" ? (
        <>
          <span className="w-10 text-right text-[10px] tabular-nums">{progress}%</span>
          <button type="button" aria-label="لغو آپلود" onClick={cancelUpload} className="p-1 text-red-500"><IoClose className="size-5" /></button>
        </>
      ) : state === "failed" ? (
        <button type="button" aria-label="تلاش دوباره" onClick={() => void upload()} className="p-1 text-yellow-400"><IoRefresh className="size-5" /></button>
      ) : (
        <button type="button" aria-label="ارسال پیام صوتی" onClick={() => void upload()} className="rounded-full bg-lightBlue p-2"><RiSendPlaneFill className="size-5 rotate-45" /></button>
      )}
      <audio
        ref={audioRef}
        src={previewUrl}
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

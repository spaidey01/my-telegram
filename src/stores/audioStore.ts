import Message from "@/models/message";
import User from "@/models/user";
import Voice from "@/models/voice";
import { create } from "zustand";
import { voiceBlobStorage } from "@/utils/voiceBlobStorage";

interface DownloadedAudio {
  _id: string;
  src?: string;
  downloaded: boolean;
  isDownloading: boolean;
}

interface Updater {
  updater: (key: keyof User, value: User[keyof User]) => void;
  isPlaying: boolean;
  audioElem: HTMLAudioElement | null;
  currentTime: number;
  playbackRate: number;
  voiceData: (Voice & Message) | null;
  downloadedAudios: DownloadedAudio[];
  setter: (partialState: Partial<Updater> | ((state: Updater) => Partial<Updater>)) => void;
  setAudioElement: (audio: HTMLAudioElement) => void;
  setVoiceDataAndPlay: (voice: Voice & Message, src?: string) => Promise<void>;
  toggleAudioPlayback: () => void;
  seekAudio: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  downloadVoice: (voice: Voice & Message) => Promise<void>;
  clearVoiceCache: (id?: string) => Promise<void>;
}

const useAudio = create<Updater>((set, get) => ({
  isPlaying: false,
  audioElem: null,
  currentTime: 0,
  playbackRate: 1,
  voiceData: null,
  downloadedAudios: [],

  updater: (key, value) => set((state) => ({ ...state, [key]: value })),
  setter: (partialState) => set(partialState),

  setAudioElement: (audio) => {
    set({ audioElem: audio });
    audio.onended = () => set({ isPlaying: false, currentTime: 0 });
    audio.ontimeupdate = () => set({ currentTime: audio.currentTime });
    audio.onpause = () => set({ isPlaying: false });
    audio.onplay = () => set({ isPlaying: true });
  },

  setVoiceDataAndPlay: async (voice, src) => {
    const audio = get().audioElem;
    if (!audio) return;
    const resolvedSrc = src || voice.src;
    audio.pause();
    audio.src = resolvedSrc;
    audio.currentTime = 0;
    audio.playbackRate = get().playbackRate;
    audio.load();
    set({ voiceData: voice, currentTime: 0, isPlaying: false });
    try {
      await audio.play();
    } catch {
      set({ isPlaying: false });
    }
  },

  toggleAudioPlayback: () => {
    const audio = get().audioElem;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  },

  seekAudio: (time) => {
    const audio = get().audioElem;
    if (!audio || !Number.isFinite(time)) return;
    const duration = Number.isFinite(audio.duration) ? audio.duration : get().voiceData?.duration || 0;
    audio.currentTime = Math.max(0, Math.min(time, duration));
    set({ currentTime: audio.currentTime });
  },

  setPlaybackRate: (rate) => {
    const allowed = [1, 1.5, 2].includes(rate) ? rate : 1;
    const audio = get().audioElem;
    if (audio) audio.playbackRate = allowed;
    set({ playbackRate: allowed });
  },

  downloadVoice: async (voice) => {
    const existing = get().downloadedAudios.find((audio) => audio._id === voice._id);
    if (existing?.downloaded || existing?.isDownloading) return;

    set((state) => ({
      downloadedAudios: [...state.downloadedAudios.filter((audio) => audio._id !== voice._id), { _id: voice._id, src: voice.src, isDownloading: true, downloaded: false }],
    }));

    try {
      const response = await fetch(voice.src);
      if (!response.ok) throw new Error("Voice download failed");
      const blob = await response.blob();
      await voiceBlobStorage.saveBlob(voice._id, blob);
      const objectUrl = URL.createObjectURL(blob);
      set((state) => ({
        downloadedAudios: state.downloadedAudios.map((audio) =>
          audio._id === voice._id ? { ...audio, src: objectUrl, downloaded: true, isDownloading: false } : audio
        ),
      }));
    } catch {
      set((state) => ({ downloadedAudios: state.downloadedAudios.filter((audio) => audio._id !== voice._id) }));
    }
  },

  clearVoiceCache: async (id) => {
    const entries = get().downloadedAudios;
    const targets = id ? entries.filter((entry) => entry._id === id) : entries;
    targets.forEach((entry) => { if (entry.src?.startsWith("blob:")) URL.revokeObjectURL(entry.src); });
    if (id) await voiceBlobStorage.deleteBlob(id).catch(() => {});
    else await voiceBlobStorage.clearAll().catch(() => {});
    set({ downloadedAudios: id ? entries.filter((entry) => entry._id !== id) : [] });
  },
}));

export default useAudio;

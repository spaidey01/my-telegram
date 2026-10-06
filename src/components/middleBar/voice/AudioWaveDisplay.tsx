import { memo, useMemo } from "react";
import useAudio from "@/stores/audioStore";
import { secondsToTimeString } from "@/utils";
import Voice from "@/models/voice";

interface Props { _id: string; voiceDataProp: Voice | null | undefined; }

const AudioWaveDisplay = memo(({ _id, voiceDataProp }: Props) => {
  const currentTime = useAudio((s) => s.currentTime);
  const voiceData = useAudio((s) => s.voiceData);
  const audioElem = useAudio((s) => s.audioElem);
  const seekAudio = useAudio((s) => s.seekAudio);
  const isCurrent = voiceData?._id === _id;
  const waves = useMemo(() => Array.from({ length: 25 }, (_, index) => ({
    index, height: 6 + ((index * 17 + _id.length * 11) % 10),
  })), [_id]);
  const duration = isCurrent ? (audioElem?.duration || voiceData?.duration || voiceDataProp?.duration || 0) : (voiceDataProp?.duration || 0);
  const progress = isCurrent && duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button type="button" aria-label="جستجو در پیام صوتی" className="flex items-center gap-[1.5px] overflow-hidden"
        onClick={(event) => {
          if (!duration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          seekAudio(duration * ratio);
        }}>
        {waves.map(({ index, height }) => (
          <span key={index} className="w-[0.17rem] shrink-0 rounded-4xl"
            style={{ height: `${height}px`, background: index / waves.length < progress ? "white" : "#4bbfff" }} />
        ))}
      </button>
      <div className="flex items-center gap-1">
        <span className="text-[12px] text-white/60">{secondsToTimeString(isCurrent ? currentTime : duration)}</span>
        <span className={`size-1.5 ml-1 mb-0.5 rounded-full ${voiceDataProp?.playedBy?.length === 0 ? "bg-white" : "bg-white/20"}`} />
      </div>
    </div>
  );
});
AudioWaveDisplay.displayName = "AudioWaveDisplay";
export default AudioWaveDisplay;

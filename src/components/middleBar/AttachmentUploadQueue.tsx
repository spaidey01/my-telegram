"use client";

import { IoClose, IoRefresh } from "react-icons/io5";
import { TbFileUpload } from "react-icons/tb";
import { toaster } from "@/utils";
import { MAX_FILE_SIZE, UploadTask } from "@/utils/file/UploadFile";

const ALLOWED = new Set([
  "image/jpeg","image/png","image/gif","image/webp",
  "audio/ogg","audio/mpeg","audio/wav","audio/flac","audio/webm","audio/mp4",
  "video/mp4","video/webm","video/quicktime","video/ogg",
  "application/pdf","application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain","text/csv","application/json",
]);

export type QueueItem = {
  id: string;
  file: File;
  preview?: string;
  progress: number;
  status: "queued" | "uploading" | "sent" | "failed" | "cancelled";
  error?: string;
  task?: UploadTask;
};

export const validateAttachmentFiles = (files: File[]) => {
  const valid: File[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      toaster("error", `«${file.name}» بیشتر از ۲۵ مگابایت است.`);
      continue;
    }
    if (!ALLOWED.has(file.type.toLowerCase())) {
      toaster("error", `نوع فایل «${file.name}» پشتیبانی نمی‌شود.`);
      continue;
    }
    valid.push(file);
  }
  return valid;
};

interface Props {
  files: QueueItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

export default function AttachmentUploadQueue({ files, onRemove, onRetry, onCancel }: Props) {
  if (!files.length) return null;

  return (
    <div className="border-t border-white/10 px-2 py-2 bg-modalBg/70 max-h-48 overflow-y-auto">
      <div className="flex flex-wrap gap-2">
        {files.map((item) => (
          <div key={item.id} className="relative w-44 rounded-xl bg-black/20 p-2">
            {item.preview ? (
              <img src={item.preview} alt="" className="h-20 w-full rounded-lg object-cover" />
            ) : (
              <div className="h-20 rounded-lg flex items-center justify-center bg-black/20">
                <TbFileUpload className="size-8 text-lightBlue" />
              </div>
            )}
            <p className="mt-1 text-xs truncate" title={item.file.name}>{item.file.name}</p>
            <p className="text-[10px] text-white/50">{Math.ceil(item.file.size / 1024)} KB</p>
            <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-lightBlue transition-all" style={{ width: `${item.progress}%` }} />
            </div>
            <div className="flex items-center justify-between mt-1 text-[10px]">
              <span className={item.status === "failed" ? "text-red-400" : item.status === "sent" ? "text-green-400" : "text-white/60"}>
                {item.status === "queued" && "در صف"}
                {item.status === "uploading" && `${item.progress}%`}
                {item.status === "sent" && "ارسال شد"}
                {item.status === "failed" && "ناموفق"}
                {item.status === "cancelled" && "لغو شد"}
              </span>
              {item.status === "failed" ? (
                <button type="button" onClick={() => onRetry(item.id)} title="تلاش دوباره"><IoRefresh className="size-4" /></button>
              ) : item.status === "queued" || item.status === "uploading" ? (
                <button type="button" onClick={() => onCancel(item.id)} title="لغو"><IoClose className="size-4" /></button>
              ) : (
                <button type="button" onClick={() => onRemove(item.id)} title="حذف"><IoClose className="size-4" /></button>
              )}
            </div>
            {item.error && <p className="text-[9px] text-red-400 truncate mt-0.5" title={item.error}>{item.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

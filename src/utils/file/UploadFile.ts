import compressImage from "./CompressImage";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

export type UploadTask = {
  promise: Promise<{ success: boolean; error?: string; downloadUrl?: string }>;
  cancel: () => void;
};

const checkNetworkConnectivity = async (): Promise<boolean> => {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    await fetch(window.location.origin, { method: "HEAD", cache: "no-store", signal: controller.signal });
    clearTimeout(timeoutId);
    return true;
  } catch {
    return false;
  }
};

const postWithProgress = (
  url: string,
  fields: Record<string, string>,
  file: File,
  onProgress?: (progress: number) => void,
  registerXhr?: (xhr: XMLHttpRequest) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    registerXhr?.(xhr);
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("file", file);
    xhr.send(form);
  });

const uploadFileOnce = async (
  file: File,
  onProgress?: (progress: number) => void,
  registerXhr?: (xhr: XMLHttpRequest) => void,
  signal?: AbortSignal,
) => {
  let upload = file;
  if (file.type.match("image.*")) upload = await compressImage(file);
  if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");

  const response = await fetch("/api/files/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: upload.type, size: upload.size }),
    signal,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to prepare upload");

  const { uploadUrl, uploadFields, key } = await response.json();
  if (!uploadUrl || !uploadFields) throw new Error("Invalid upload authorization");

  await postWithProgress(uploadUrl, uploadFields, upload, onProgress, registerXhr);
  if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");

  const verifyResponse = await fetch("/api/files/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType: upload.type }),
    signal,
  });
  if (!verifyResponse.ok) {
    const error = await verifyResponse.json().catch(() => null);
    throw new Error(error?.message || "File verification failed");
  }
  const verified = await verifyResponse.json();
  onProgress?.(100);
  return verified.downloadUrl as string;
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1200;

const createUploadTask = (file: File, onProgress?: (progress: number) => void): UploadTask => {
  const controller = new AbortController();
  let currentXhr: XMLHttpRequest | null = null;

  const promise = (async () => {
    let lastError = "Upload failed permanently.";
    for (let i = 0; i < MAX_RETRIES; i++) {
      if (controller.signal.aborted) return { success: false, error: "Upload cancelled." };
      if (!(await checkNetworkConnectivity())) {
        lastError = "Network connection unavailable.";
        if (i < MAX_RETRIES - 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      try {
        const downloadUrl = await uploadFileOnce(
          file,
          onProgress,
          (xhr) => { currentXhr = xhr; },
          controller.signal,
        );
        currentXhr = null;
        return { success: true, downloadUrl };
      } catch (error) {
        currentXhr = null;
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return { success: false, error: "Upload cancelled." };
        }
        lastError = error instanceof Error ? error.message : "Upload failed.";
        if (i < MAX_RETRIES - 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
    return { success: false, error: lastError };
  })();

  return { promise, cancel: () => { controller.abort(); currentXhr?.abort(); } };
};

export { checkNetworkConnectivity, MAX_FILE_SIZE };
export default uploadFileWithRetry;

import compressImage from "./CompressImage";

const checkNetworkConnectivity = async (): Promise<boolean> => {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    await fetch(window.location.origin, { method: "HEAD", cache: "no-store", signal: controller.signal });
    clearTimeout(timeoutId);
    return true;
  } catch {
    return true;
  }
};

const postWithProgress = (
  url: string,
  fields: Record<string, string>,
  file: File,
  onProgress?: (progress: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload failed"));

    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("file", file);
    xhr.send(form);
  });

const uploadFileOnce = async (file: File, onProgress?: (progress: number) => void) => {
  let upload = file;
  if (file.type.match("image.*")) upload = await compressImage(file);

  const response = await fetch("/api/files/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: upload.type, size: upload.size }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Unable to prepare upload");

  const { uploadUrl, uploadFields, downloadUrl } = await response.json();
  if (!uploadUrl || !uploadFields) throw new Error("Invalid upload authorization");

  await postWithProgress(uploadUrl, uploadFields, upload, onProgress);
  onProgress?.(100);
  return downloadUrl as string;
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const uploadFileWithRetry = async (
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ success: boolean; error?: string; downloadUrl?: string }> => {
  for (let i = 0; i < MAX_RETRIES; i++) {
    if (!(await checkNetworkConnectivity())) {
      if (i < MAX_RETRIES - 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }
    try {
      const downloadUrl = await uploadFileOnce(file, onProgress);
      return { success: true, downloadUrl };
    } catch (error) {
      if (i < MAX_RETRIES - 1) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      else return { success: false, error: error instanceof Error ? error.message : "Upload failed permanently." };
    }
  }
  return { success: false, error: "Network connection unavailable." };
};

export { checkNetworkConnectivity };
export default uploadFileWithRetry;

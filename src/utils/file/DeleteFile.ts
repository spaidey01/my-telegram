import { toaster } from "@/utils";

const deleteFile = async (fileUrl: string) => {
  try {
    const response = await fetch("/api/files/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl }),
    });
    if (!response.ok) throw new Error("Delete failed");
  } catch (error) {
    console.error("Delete failed:", error);
    toaster("error", "Delete failed! Please try again.");
  }
};

export default deleteFile;

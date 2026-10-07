import Message from "@/models/message";

export interface PendingMessage extends Message {
  retryCount: number;
  lastAttempt: number;
  tempId: string;
}

const PENDING_MESSAGES_KEY = "telegram_pending_messages";
const DB_NAME = "stargram-offline";
const DB_VERSION = 1;
const STORE = "outgoingMessages";

const openOfflineDB = () => new Promise<IDBDatabase | null>((resolve) => {
  if (typeof indexedDB === "undefined") return resolve(null);
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "tempId" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => resolve(null);
});

const mirrorToIndexedDB = (messages: PendingMessage[]) => {
  void openOfflineDB().then((db) => {
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    for (const message of messages) tx.objectStore(STORE).put(message);
    tx.oncomplete = () => db.close();
  });
};

const removeFromIndexedDB = (tempId: string) => {
  void openOfflineDB().then((db) => {
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(tempId);
    tx.oncomplete = () => db.close();
  });
};

export const pendingMessagesService = {
  savePendingMessages: (roomId: string, messages: PendingMessage[]) => {
    try {
      const existing = pendingMessagesService.getAllPendingMessages();
      existing[roomId] = messages;
      localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(existing));
      mirrorToIndexedDB(messages);
    } catch (error) {
      console.error("Error saving pending messages:", error);
    }
  },

  getPendingMessages: (roomId: string): PendingMessage[] => {
    try {
      const allMessages = pendingMessagesService.getAllPendingMessages();
      return allMessages[roomId] || [];
    } catch (error) {
      console.error("Error getting pending messages:", error);
      return [];
    }
  },

  getAllPendingMessages: (): Record<string, PendingMessage[]> => {
    try {
      const stored = localStorage.getItem(PENDING_MESSAGES_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error("Error parsing pending messages:", error);
      return {};
    }
  },

  removePendingMessage: (roomId: string, tempId: string) => {
    try {
      const existing = pendingMessagesService.getAllPendingMessages();
      if (existing[roomId]) {
        existing[roomId] = existing[roomId].filter((msg) => msg.tempId !== tempId);
        if (existing[roomId].length === 0) delete existing[roomId];
        localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(existing));
        removeFromIndexedDB(tempId);
      }
    } catch (error) {
      console.error("Error removing pending message:", error);
    }
  },

  addPendingMessage: (
    roomId: string,
    message: Omit<PendingMessage, "retryCount" | "lastAttempt">
  ) => {
    const pendingMessage: PendingMessage = { ...message, retryCount: 0, lastAttempt: Date.now() };
    const existing = pendingMessagesService.getPendingMessages(roomId);
    existing.push(pendingMessage);
    pendingMessagesService.savePendingMessages(roomId, existing);
    return pendingMessage;
  },

  updatePendingMessage: (roomId: string, tempId: string, patch: Partial<Pick<PendingMessage, "retryCount" | "lastAttempt">>) => {
    const all = pendingMessagesService.getAllPendingMessages();
    const roomMessages = all[roomId] || [];
    all[roomId] = roomMessages.map((message) => message.tempId === tempId ? { ...message, ...patch } : message);
    localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(all));
    mirrorToIndexedDB(all[roomId]);
  },

  clearPendingMessages: (roomId: string) => {
    const existing = pendingMessagesService.getAllPendingMessages();
    for (const message of existing[roomId] || []) removeFromIndexedDB(message.tempId);
    delete existing[roomId];
    localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(existing));
  },

  cancelPendingMessage: (roomId: string, tempId: string) => {
    try {
      const existing = pendingMessagesService.getAllPendingMessages();
      if (existing[roomId]) {
        existing[roomId] = existing[roomId].filter((msg) => msg.tempId !== tempId);
        if (existing[roomId].length === 0) delete existing[roomId];
        localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(existing));
        removeFromIndexedDB(tempId);
      }
    } catch (error) {
      console.error("Error canceling pending message:", error);
    }
  },
};

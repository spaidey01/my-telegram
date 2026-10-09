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
    if (!request.result.objectStoreNames.contains(STORE)) {
      request.result.createObjectStore(STORE, { keyPath: "tempId" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => resolve(null);
});

const mirrorToIndexedDB = (messages: PendingMessage[]) => {
  void openOfflineDB().then((db) => {
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const message of messages) store.put(message);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
};

const removeFromIndexedDB = (tempId: string) => {
  void openOfflineDB().then((db) => {
    if (!db) return;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(tempId);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
};

const readIndexedDB = () => new Promise<PendingMessage[]>((resolve) => {
  void openOfflineDB().then((db) => {
    if (!db) return resolve([]);
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      const value = Array.isArray(request.result) ? request.result as PendingMessage[] : [];
      db.close();
      resolve(value);
    };
    request.onerror = () => {
      db.close();
      resolve([]);
    };
  });
});

export const pendingMessagesService = {
  savePendingMessages: (roomId: string, messages: PendingMessage[]) => {
    try {
      const existing = pendingMessagesService.getAllPendingMessages();
      existing[roomId] = messages;
      localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(existing));
    } catch (error) {
      console.error("Error saving pending messages:", error);
    }
    mirrorToIndexedDB(messages);
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

  hydrateFromIndexedDB: async () => {
    const indexedMessages = await readIndexedDB();
    if (!indexedMessages.length) return;

    const all = pendingMessagesService.getAllPendingMessages();
    let changed = false;
    for (const message of indexedMessages) {
      if (!message?.tempId || !message?.roomID) continue;
      const roomId = String(message.roomID);
      const roomMessages = all[roomId] || [];
      if (roomMessages.some((item) => item.tempId === message.tempId)) continue;
      all[roomId] = [...roomMessages, message];
      changed = true;
    }
    if (!changed) return;
    try {
      localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(all));
    } catch (error) {
      console.error("Error hydrating pending messages:", error);
    }
  },

  removePendingMessage: (roomId: string, tempId: string) => {
    try {
      const existing = pendingMessagesService.getAllPendingMessages();
      if (existing[roomId]) {
        existing[roomId] = existing[roomId].filter((msg) => msg.tempId !== tempId);
        if (existing[roomId].length === 0) delete existing[roomId];
        localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(existing));
      }
    } catch (error) {
      console.error("Error removing pending message:", error);
    }
    removeFromIndexedDB(tempId);
  },

  addPendingMessage: (
    roomId: string,
    message: Omit<PendingMessage, "retryCount" | "lastAttempt">
  ) => {
    const pendingMessage: PendingMessage = {
      ...message,
      retryCount: 0,
      lastAttempt: Date.now(),
    };
    const existing = pendingMessagesService.getPendingMessages(roomId);
    existing.push(pendingMessage);
    pendingMessagesService.savePendingMessages(roomId, existing);
    return pendingMessage;
  },

  updatePendingMessage: (
    roomId: string,
    tempId: string,
    patch: Partial<Pick<PendingMessage, "retryCount" | "lastAttempt">>
  ) => {
    const all = pendingMessagesService.getAllPendingMessages();
    const roomMessages = all[roomId] || [];
    all[roomId] = roomMessages.map((message) =>
      message.tempId === tempId ? { ...message, ...patch } : message
    );
    try {
      localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(all));
    } catch (error) {
      console.error("Error updating pending message:", error);
    }
    mirrorToIndexedDB(all[roomId]);
  },

  clearPendingMessages: (roomId: string) => {
    const existing = pendingMessagesService.getAllPendingMessages();
    for (const message of existing[roomId] || []) removeFromIndexedDB(message.tempId);
    delete existing[roomId];
    try {
      localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(existing));
    } catch (error) {
      console.error("Error clearing pending messages:", error);
    }
  },

  cancelPendingMessage: (roomId: string, tempId: string) => {
    pendingMessagesService.removePendingMessage(roomId, tempId);
  },
};

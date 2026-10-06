export const EMPTY_MESSAGE_SELECTION = {
  selectedMessageIds: [],
  selectionRoomID: null,
  selectionMode: false,
};

export const enterMessageSelection = (roomID, messageID) => ({
  selectedMessageIds: [messageID],
  selectionRoomID: roomID,
  selectionMode: true,
});

export const toggleMessageSelection = (state, roomID, messageID) => {
  if (state.selectionRoomID && state.selectionRoomID !== roomID) return state;

  const selectedMessageIds = state.selectedMessageIds.includes(messageID)
    ? state.selectedMessageIds.filter((id) => id !== messageID)
    : [...state.selectedMessageIds, messageID];

  return selectedMessageIds.length
    ? { selectedMessageIds, selectionRoomID: roomID, selectionMode: true }
    : EMPTY_MESSAGE_SELECTION;
};

export const selectAllMessages = (roomID, messageIDs) => {
  const selectedMessageIds = [...new Set(messageIDs.filter(Boolean))];
  return selectedMessageIds.length
    ? { selectedMessageIds, selectionRoomID: roomID, selectionMode: true }
    : EMPTY_MESSAGE_SELECTION;
};

export const pruneMessageSelection = (state, roomID, messageIDs) => {
  if (state.selectionRoomID !== roomID) return state;
  const validIds = new Set(messageIDs);
  const selectedMessageIds = state.selectedMessageIds.filter((id) => validIds.has(id));
  return selectedMessageIds.length
    ? { selectedMessageIds, selectionRoomID: roomID, selectionMode: true }
    : EMPTY_MESSAGE_SELECTION;
};

export const replaceMessageSelection = (state, roomID, oldMessageID, newMessageID) => {
  if (state.selectionRoomID !== roomID || !state.selectedMessageIds.includes(oldMessageID)) return state;
  return {
    selectedMessageIds: state.selectedMessageIds.map((id) => id === oldMessageID ? newMessageID : id),
    selectionRoomID: roomID,
    selectionMode: true,
  };
};

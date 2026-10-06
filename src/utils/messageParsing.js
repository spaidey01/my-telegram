export const parseMentions = (text) => [...new Set((String(text).match(/(^|\s)@([a-zA-Z0-9_]{3,20})\b/g)||[]).map(v=>v.trim().slice(1).toLowerCase()))];
export const parseHashtags = (text) => [...new Set((String(text).match(/(^|\s)#[\p{L}\p{N}_]{1,64}/gu)||[]).map(v=>v.trim().slice(1).toLowerCase()))];

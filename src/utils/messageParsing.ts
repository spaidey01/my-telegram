export const parseMentions = (text: string) => {
  const out = new Set<string>();
  const re = /(^|\\s)@([a-zA-Z0-9_]{3,20})\\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[2].toLowerCase());
  return [...out];
};

export const parseHashtags = (text: string) => {
  const out = new Set<string>();
  const re = /(^|\\s)#([\\p{L}\\p{N}_]{1,64})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[2].toLowerCase());
  return [...out];
};

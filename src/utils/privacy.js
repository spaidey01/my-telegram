import UserSchema from "../schemas/userSchema.js";
import RoomSchema from "../schemas/roomSchema.js";

export const PRIVACY_VALUES = ["everyone", "contacts", "nobody"];
export const PRIVACY_KEYS = ["lastSeen", "profilePhoto", "phone", "calls", "messages"];
export const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  lastSeen: "everyone",
  profilePhoto: "everyone",
  phone: "everyone",
  calls: "everyone",
  messages: "everyone",
});

export const normalizePrivacySettings = (value) => {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(PRIVACY_KEYS.map((key) => [
    key,
    PRIVACY_VALUES.includes(source[key]) ? source[key] : DEFAULT_PRIVACY_SETTINGS[key],
  ]));
};

export const getPrivacySettings = async (userID) => {
  const user = await UserSchema.findById(userID).select("privacySettings").lean();
  return normalizePrivacySettings(user?.privacySettings);
};

export const isContact = async (userA, userB) => {
  if (!userA || !userB || userA === userB) return true;
  const room = await RoomSchema.findOne({
    type: "private",
    participants: { $all: [userA, userB], $size: 2 },
  }).select("_id").lean();
  return Boolean(room);
};

export const canViewPrivacy = async (targetUserID, viewerUserID, key) => {
  if (!targetUserID || targetUserID === viewerUserID) return true;
  const settings = await getPrivacySettings(targetUserID);
  const value = settings[key] || "everyone";
  if (value === "everyone") return true;
  if (value === "nobody") return false;
  return isContact(targetUserID, viewerUserID);
};

export const sanitizeUserForViewer = async (user, viewerUserID, { includePhone = false } = {}) => {
  if (!user) return null;
  const data = typeof user.toObject === "function" ? user.toObject() : { ...user };
  const targetUserID = data._id?.toString?.() || String(data._id || "");
  const [canSeePhoto, canSeePhone, canSeeLastSeen] = await Promise.all([
    canViewPrivacy(targetUserID, viewerUserID, "profilePhoto"),
    includePhone ? canViewPrivacy(targetUserID, viewerUserID, "phone") : Promise.resolve(false),
    canViewPrivacy(targetUserID, viewerUserID, "lastSeen"),
  ]);
  if (!canSeePhoto) data.avatar = "";
  if (!canSeeLastSeen) {
    data.status = "offline";
    data.lastSeenAt = null;
  }
  if (includePhone && !canSeePhone) delete data.phone;
  return data;
};

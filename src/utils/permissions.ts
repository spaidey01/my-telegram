export const GROUP_PERMISSION_KEYS=["sendMessages","sendMedia","sendStickers","sendLinks","addMembers","pinMessages","changeInfo","manageMembers"] as const;
export type GroupPermission=typeof GROUP_PERMISSION_KEYS[number];
export const sanitizePermissions=(value:unknown)=>{const out:Record<string,boolean>={};if(!value||typeof value!=="object")return out;for(const key of GROUP_PERMISSION_KEYS){const v=(value as Record<string,unknown>)[key];if(typeof v==="boolean")out[key]=v}return out};

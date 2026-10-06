export const GROUP_PERMISSION_KEYS=["sendMessages","sendMedia","sendStickers","sendLinks","addMembers","pinMessages","changeInfo","manageMembers"];
export const isAdmin=(room,userID)=>!!room&&(room.creator?.toString()===userID||room.admins?.some(id=>id.toString()===userID));
export const hasGroupPermission=(room,userID,key)=>{
 if(!room||room.type!=="group")return true;
 if(isAdmin(room,userID))return true;
 if(room.bannedUsers?.some(id=>id.toString()===userID)||room.restrictedUsers?.some(id=>id.toString()===userID))return false;
 if(room.mutedUsers?.some(id=>id.toString()===userID)&&key==="sendMessages")return false;
 const member=room.memberPermissions?.get?.(userID)||room.memberPermissions?.[userID]||{};
 if(typeof member[key]==="boolean")return member[key];
 return room.groupPermissions?.[key]!==false;
};
export const channelCanPost=(room,userID)=>{
 if(room?.type!=="channel")return true;
 if(isAdmin(room,userID))return true;
 const role=room.channelRoles?.get?.(userID)||room.channelRoles?.[userID];
 return role==="editor"||role==="moderator";
};
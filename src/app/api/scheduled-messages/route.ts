import { isSafeBrowserRequest } from "@/utils/csrf";
import connectToDB from "@/db";
type ScheduledRoom={_id:unknown;type:string;channelRoles?:Record<string,string>;groupPermissions?:Record<string,boolean>;memberPermissions?:Map<string,Record<string,boolean>>;bannedUsers?:unknown[];restrictedUsers?:unknown[];mutedUsers?:unknown[];admins?:unknown[];participants?:unknown[];};
import ScheduledSchema from "@/schemas/scheduledMessageSchema";import SessionSchema from "@/schemas/sessionSchema";import RoomSchema from "@/schemas/roomSchema";import UserSchema from "@/schemas/userSchema";import tokenDecoder from "@/utils/TokenDecoder";import {cookies}from"next/headers";import mongoose from"mongoose";import { GROUP_PERMISSION_KEYS, hasGroupPermission, channelCanPost } from"../../../../server/security/permissions.js";
import { canViewPrivacy } from "@/utils/privacy";
const auth=async()=>{const t=(await cookies()).get("token")?.value,d=t?tokenDecoder(t):false;if(!d||typeof d!=="object"||typeof d.sub!=="string"||typeof d.sv!=="number"||typeof d.sid!=="string"||!mongoose.isValidObjectId(d.sub)||!mongoose.isValidObjectId(d.sid))return null;await connectToDB();const [session,user]=await Promise.all([SessionSchema.findOne({_id:d.sid,user:d.sub,revokedAt:null}).select("_id").lean(),UserSchema.findOne({_id:d.sub,sessionVersion:d.sv}).select("_id").lean()]);return session&&user?d:null};
export const GET=async()=>{const d=await auth();if(!d)return Response.json({message:"Unauthorized"},{status:401});return Response.json({scheduled:await ScheduledSchema.find({sender:d.sub,status:"pending"}).sort({scheduledFor:1}).lean().then((value)=>value)})};
export const DELETE=async(req:Request)=>{
  if(!isSafeBrowserRequest(req))return Response.json({message:"Forbidden"},{status:403});
  const d=await auth();if(!d)return Response.json({message:"Unauthorized"},{status:401});
  const id=new URL(req.url).searchParams.get("id");
  if(!mongoose.isValidObjectId(id))return Response.json({message:"Invalid id"},{status:400});
  const updated=await ScheduledSchema.findOneAndUpdate(
    {_id:id,sender:d.sub,status:"pending"},
    {$set:{status:"cancelled",processingAt:null}},
    {new:true},
  ).lean();
  if(!updated)return Response.json({message:"Scheduled message not found or not cancellable"},{status:404});
  return Response.json({scheduled:updated});
};
export const POST=async(req:Request)=>{if(!isSafeBrowserRequest(req))return Response.json({message:"Forbidden"},{status:403});const d=await auth();if(!d)return Response.json({message:"Unauthorized"},{status:401});const b=await req.json().catch(()=>({}));if(!mongoose.isValidObjectId(b?.roomId)||!b?.payload||typeof b.payload!=="object"||Array.isArray(b.payload)||JSON.stringify(b.payload).length>12000||!b?.scheduledFor)return Response.json({message:"Invalid scheduled message"},{status:400});const when=new Date(b.scheduledFor);if(Number.isNaN(when.getTime())||when.getTime()<Date.now()+5000)return Response.json({message:"scheduledFor must be in the future"},{status:400});const room=await RoomSchema.findOne({_id:b.roomId,participants:d.sub}).select("_id type admins channelRoles groupPermissions memberPermissions bannedUsers restrictedUsers mutedUsers participants").lean().then((value)=>value as unknown as ScheduledRoom | null);if(!room)return Response.json({message:"Forbidden"},{status:403});if(room.type==="group"){for(const permission of GROUP_PERMISSION_KEYS){if(room.type==="group"&&!hasGroupPermission(room,d.sub,permission))return Response.json({message:"Forbidden"},{status:403});}if(room.restrictedUsers?.some((id)=>String(id)===d.sub))return Response.json({message:"Forbidden"},{status:403});}if(room.type==="channel"&&!channelCanPost(room,d.sub))return Response.json({message:"Forbidden"},{status:403});if(room.type==="private"){const recipientID=room.participants?.map((id)=>String(id)).find((id)=>id!==d.sub);if(recipientID&&!(await canViewPrivacy(recipientID,d.sub,"messages")))return Response.json({message:"Forbidden"},{status:403});}const doc=await ScheduledSchema.create({sender:d.sub,room:b.roomId,payload:b.payload,scheduledFor:when});return Response.json({scheduled:doc},{status:201})};

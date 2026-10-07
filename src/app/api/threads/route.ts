import connectToDB from "@/db";import ThreadEventSchema from "@/schemas/threadEventSchema";import RoomSchema from "@/schemas/roomSchema";import UserSchema from "@/schemas/userSchema";import SessionSchema from "@/schemas/sessionSchema";import tokenDecoder from "@/utils/TokenDecoder";import {cookies}from"next/headers";import mongoose from"mongoose";
const auth=async()=>{
  const t=(await cookies()).get("token")?.value,d=t?tokenDecoder(t):false;
  if(!d||typeof d!=="object"||typeof d.sub!=="string"||typeof d.sv!=="number"||typeof d.sid!=="string")return null;
  if(!mongoose.isValidObjectId(d.sub)||!mongoose.isValidObjectId(d.sid))return null;
  await connectToDB();
  const [session,user]=await Promise.all([
    SessionSchema.findOne({_id:d.sid,user:d.sub,revokedAt:null}).select("_id").lean(),
    UserSchema.findOne({_id:d.sub,sessionVersion:d.sv}).select("_id").lean(),
  ]);
  return session&&user?d:null;
};
export const GET=async(req:Request)=>{const d=await auth();if(!d)return Response.json({message:"Unauthorized"},{status:401});const params=new URL(req.url).searchParams;const roomId=params.get("roomId");const mine=params.get("mine")==="true";if(mine){return Response.json({events:await ThreadEventSchema.find({$or:[{"data.targetUser":d.sub},{actor:d.sub,type:{$in:["call","system"]}}]}).sort({createdAt:-1}).limit(100).populate("actor","name username avatar _id").lean()})}if(!mongoose.isValidObjectId(roomId))return Response.json({message:"Invalid roomId"},{status:400});if(!await RoomSchema.exists({_id:roomId,participants:d.sub}))return Response.json({message:"Forbidden"},{status:403});return Response.json({events:await ThreadEventSchema.find({room:roomId,$or:[{"data.targetUser":d.sub},{type:{$in:["call","system"]}}]}).sort({createdAt:-1}).limit(100).populate("actor","name username avatar _id").lean()})};
export const POST=async(req:Request)=>{
  return Response.json({message:"Thread events are server-generated."},{status:405});
};

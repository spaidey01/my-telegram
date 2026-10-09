import connectToDB from "@/db";
import CallSchema from "@/schemas/callSchema";
import UserSchema from "@/schemas/userSchema";import SessionSchema from "@/schemas/sessionSchema";import { sanitizeUserForViewer } from "@/utils/privacy";
import tokenDecoder from "@/utils/TokenDecoder";
import { cookies } from "next/headers";
import mongoose from "mongoose";
const auth=async()=>{const t=(await cookies()).get("token")?.value,d=t?tokenDecoder(t):false;if(!d||typeof d!=="object"||typeof d.sub!=="string"||typeof d.sv!=="number"||typeof d.sid!=="string"||!mongoose.isValidObjectId(d.sub)||!mongoose.isValidObjectId(d.sid))return null;await connectToDB();const session=await SessionSchema.findOne({_id:d.sid,user:d.sub,revokedAt:null}).select("_id").lean();return session&&await UserSchema.findOne({_id:d.sub,sessionVersion:d.sv}).select("_id").lean()?d:null};
export const GET=async(req:Request)=>{const d=await auth();if(!d)return Response.json({message:"Unauthorized"},{status:401});const limit=Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit"))||50,1),100);const calls=await CallSchema.find({$or:[{caller:d.sub},{receiver:d.sub}]}).sort({startedAt:-1}).limit(limit).populate("caller","name username avatar _id").populate("receiver","name username avatar _id").lean();const safeCalls=await Promise.all(calls.map(async(call)=>({...call,caller:call.caller?await sanitizeUserForViewer(call.caller,d.sub):call.caller,receiver:call.receiver?await sanitizeUserForViewer(call.receiver,d.sub):call.receiver})));return Response.json({calls:safeCalls});};

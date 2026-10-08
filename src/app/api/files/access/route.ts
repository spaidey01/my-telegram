import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { cookies } from "next/headers";
import connectToDB from "@/db";
import UserSchema from "@/schemas/userSchema";
import SessionSchema from "@/schemas/sessionSchema";
import RoomSchema from "@/schemas/roomSchema";
import MessageSchema from "@/schemas/messageSchema";
import StickerSchema from "@/schemas/stickerSchema";
import StickerPackSchema from "@/schemas/stickerPackSchema";
import UserStickerPackSchema from "@/schemas/userStickerPackSchema";
import tokenDecoder from "@/utils/TokenDecoder";
import { canViewPrivacy } from "@/utils/privacy";
import mongoose from "mongoose";

const s3 = () => new S3Client({region:process.env.S3_REGION||"us-east-1",endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY!,secretAccessKey:process.env.S3_SECRET_KEY!}});
const validKey=(key:string)=>/^(images|voices|files|stickers)\/[a-fA-F0-9]{24}\/[0-9a-f-]{36}$/.test(key);

export async function GET(req:Request){
 try{
  const token=(await cookies()).get("token")?.value,decoded=token?tokenDecoder(token):false;
  const userId=decoded&&typeof decoded==="object"&&typeof decoded.sub==="string"?String(decoded.sub):null;
  const sessionVersion=decoded&&typeof decoded==="object"&&typeof decoded.sv==="number"?decoded.sv:null;
  const sessionId=decoded&&typeof decoded==="object"&&typeof decoded.sid==="string"?decoded.sid:null;
  if(!userId||sessionVersion===null||!sessionId||!mongoose.isValidObjectId(userId)||!mongoose.isValidObjectId(sessionId))return NextResponse.json({message:"Unauthorized"},{status:401});
  await connectToDB();
  const session=await SessionSchema.findOne({_id:sessionId,user:userId,revokedAt:null}).select("_id").lean();
  const activeUser=session?await UserSchema.findOne({_id:userId,sessionVersion}).select("_id").lean():null;
  if(!activeUser)return NextResponse.json({message:"Unauthorized"},{status:401});
  const key=new URL(req.url).searchParams.get("key")||"";
  if(!validKey(key))return NextResponse.json({message:"Invalid file"},{status:400});
  const bucket=process.env.S3_BUCKET_NAME;
  if(!bucket||!process.env.S3_ACCESS_KEY||!process.env.S3_SECRET_KEY||!process.env.S3_ENDPOINT)return NextResponse.json({message:"Storage is not configured"},{status:500});
  const accessUrl=`/api/files/access?key=${encodeURIComponent(key)}`;
  const ownsFile=key.split("/")[1]===userId;let canAccess=ownsFile;
  if(!canAccess){
   if(key.startsWith("stickers/")){
    const sticker=await StickerSchema.findOne({file:accessUrl}).select("packId").lean() as { packId: mongoose.Types.ObjectId } | null;
    if(sticker){
      const pack=await StickerPackSchema.findById(sticker.packId).select("_id owner").lean() as { _id: mongoose.Types.ObjectId; owner: mongoose.Types.ObjectId } | null;
      const isOwner=Boolean(pack&&String(pack.owner)===userId);
      const isInstalled=Boolean(pack&&!isOwner&&await UserStickerPackSchema.exists({user:userId,packId:pack._id}));
      let isSharedInRoom=false;
      if(!isOwner&&!isInstalled){
        const stickerMessage=await MessageSchema.findOne({
          "stickerData.file":accessUrl,
          roomID:{$in:(await RoomSchema.find({participants:userId}).select("_id").lean()).map((room)=>room._id)},
          hideFor:{$nin:[userId]},
        }).select("_id").lean();
        isSharedInRoom=Boolean(stickerMessage);
      }
      canAccess=isOwner||isInstalled||isSharedInRoom;
    }
  }
   const messageRefs=await MessageSchema.find({$or:[{"voiceData.src":accessUrl},{"attachmentData.src":accessUrl}]}).select("roomID").lean();
   const roomIds=messageRefs.map((message)=>message.roomID);
   const roomRef=await RoomSchema.findOne({avatar:accessUrl,participants:userId}).select("_id").lean();
   if(roomIds.length)canAccess=Boolean(await RoomSchema.exists({_id:{$in:roomIds},participants:userId}));
   if(roomRef&&!Array.isArray(roomRef))canAccess=true;
   if(!canAccess&&key.startsWith("images/")){const owner=await UserSchema.findOne({avatar:accessUrl}).select("_id").lean() as { _id:{toString():string} }|null;canAccess=Boolean(owner&&await canViewPrivacy(owner._id.toString(),userId,"profilePhoto"));}
  }
  if(!canAccess)return NextResponse.json({message:"Forbidden"},{status:403});
  const signedUrl=await getSignedUrl(s3(),new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:5*60});
  const response=NextResponse.redirect(signedUrl,302);response.headers.set("Cache-Control","private, no-store");return response;
 }catch(error){console.error("file access:",error);return NextResponse.json({message:"Unable to access file"},{status:404});}
}

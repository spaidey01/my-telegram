import mongoose from "mongoose";
export const validateRoomId=(id:unknown)=>typeof id==="string"&&mongoose.isValidObjectId(id);
export const validateAdmin=(room:any,userID:string)=>Boolean(room&&(room.creator?.toString()===userID||room.admins?.some((id:any)=>id.toString()===userID)));
export const validatePayload=(payload:unknown,max=10000)=>{if(payload===null||payload===undefined)return false;try{return JSON.stringify(payload).length<=max}catch{return false}};

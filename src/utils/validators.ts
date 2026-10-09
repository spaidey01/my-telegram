import mongoose from "mongoose";
export const validateRoomId=(id:unknown)=>typeof id==="string"&&mongoose.isValidObjectId(id);
type AdminRoom={creator?:unknown;admins?:unknown[]};
const toId=(value:unknown)=>typeof value==="string"?value:(value&&typeof value==="object"&&"_id" in value?String((value as {_id:unknown})._id):String(value));
export const validateAdmin=(room:unknown,userID:string)=>{
 if(!room||typeof room!=="object")return false;
 const value=room as AdminRoom;
 return toId(value.creator)===userID||Boolean(value.admins?.some((id)=>toId(id)===userID));
};
export const validatePayload=(payload:unknown,max=10000)=>{if(payload===null||payload===undefined)return false;try{return JSON.stringify(payload).length<=max}catch{return false}};

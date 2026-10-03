"use client";
import { BsEmojiSmile } from "react-icons/bs";
import { IoMdClose } from "react-icons/io";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { MdAttachFile, MdModeEditOutline, MdOutlineDone } from "react-icons/md";
import { PiStickerLight } from "react-icons/pi";
import { BsFillReplyFill } from "react-icons/bs";
import VoiceMessageRecorder from "./voice/VoiceMessageRecorder";
import Message from "@/models/message";
import useGlobalStore, { GlobalStoreProps } from "@/stores/globalStore";
import useUserStore from "@/stores/userStore";
import useSockets from "@/stores/useSockets";
import { RiSendPlaneFill } from "react-icons/ri";
import { scrollToMessage, toaster, uploadFile } from "@/utils";
import EmojiPicker from "../modules/EmojiPicker";
import { v4 as uuidv4 } from "uuid";
import { pendingMessagesService, PendingMessage } from "@/utils/pendingMessages";
import { isMobile } from "@/utils/isMobile";

interface Props { replayData?: Partial<Message>; editData?: Partial<Message>; closeReplay:()=>void; closeEdit:()=>void; }
type Attachment={src:string;name:string;type:string;size:number};

export default function MessageInput({replayData,editData,closeReplay,closeEdit}:Props){
 const [text,setText]=useState(""); const [emoji,setEmoji]=useState(false); const [sticker,setSticker]=useState(false); const [uploading,setUploading]=useState(false);
 const input=useRef<HTMLTextAreaElement|null>(null); const fileInput=useRef<HTMLInputElement|null>(null);
 const room=useGlobalStore(s=>s.selectedRoom); const setter=useGlobalStore(s=>s.setter); const rooms=useSockets(s=>s.rooms); const me=useUserStore(s=>s); const roomId=room?._id;
 const resize=useCallback(()=>{if(input.current){input.current.style.height="24px";input.current.style.height=Math.min(input.current.scrollHeight,100)+"px";}},[]);
 const cleanup=useCallback(()=>{closeReplay();closeEdit();setText("");if(roomId)localStorage.removeItem(roomId);resize();input.current?.focus();},[closeReplay,closeEdit,roomId,resize]);
 const send=useCallback((payload:{roomID:string;message:string;sender:{_id:string;name:string};replayData?:{targetID:string;replayedTo:{message:string;msgID:string;username:string}}|null;attachmentData?:Attachment|null;stickerData?:{emoji:string}|null;tempId:string})=>{
   const local={_id:payload.tempId,message:payload.message,sender:me,roomID:payload.roomID,status:"pending" as const,replayedTo:payload.replayData?.replayedTo||null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),isEdited:false,seen:[],readTime:null,pinnedAt:null,hideFor:[],replays:[],voiceData:null,attachmentData:payload.attachmentData||null,stickerData:payload.stickerData||null,tempId:payload.tempId} as Message;
   pendingMessagesService.addPendingMessage(payload.roomID,local as Omit<PendingMessage,"retryCount"|"lastAttempt">);
   setter((prev:GlobalStoreProps)=>({selectedRoom:prev.selectedRoom?{...prev.selectedRoom,messages:[...prev.selectedRoom.messages,local]}:null}));
   rooms?.emit("newMessage",payload,(res:{success:boolean;_id:string})=>{setter((prev:GlobalStoreProps)=>({selectedRoom:prev.selectedRoom?{...prev.selectedRoom,messages:prev.selectedRoom.messages.map(m=>m.tempId===payload.tempId?{...m,_id:res?.success?res._id:m._id,status:res?.success?"sent":"failed"}:m)}:null}));if(res?.success)pendingMessagesService.removePendingMessage(payload.roomID,payload.tempId);});
 },[rooms,me,setter]);
 const sendText=()=>{const message=text.trim().replace(/\n+$/,"");if(!roomId||!message||!room||room.type==="channel"&&!room.admins.includes(me._id))return;send({roomID:roomId,message,sender:{_id:me._id,name:me.name},replayData:replayData?{targetID:replayData._id!,replayedTo:{message:replayData.message||"",msgID:replayData._id!,username:replayData.sender?.name||""}}:null,attachmentData:null,stickerData:null,tempId:uuidv4()});cleanup();};
 const sendSticker=(emojiValue:string)=>{if(!roomId)return;send({roomID:roomId,message:"",sender:{_id:me._id,name:me.name},replayData:null,attachmentData:null,stickerData:{emoji:emojiValue},tempId:uuidv4()});setSticker(false);};
 const pickFile=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];e.target.value="";if(!file||!roomId)return;if(file.size>25*1024*1024)return toaster("error","حداکثر حجم فایل ۲۵ مگابایت است.");setUploading(true);try{const r=await uploadFile(file);if(!r.success||!r.downloadUrl)throw new Error(r.error||"آپلود ناموفق بود.");send({roomID:roomId,message:"",sender:{_id:me._id,name:me.name},replayData:null,stickerData:null,tempId:uuidv4(),attachmentData:{src:r.downloadUrl,name:file.name,type:file.type||"application/octet-stream",size:file.size}});}catch(err){toaster("error",err instanceof Error?err.message:"آپلود ناموفق بود.");}finally{setUploading(false);}};
 const edit=()=>{if(editData?._id&&roomId&&text.trim()){rooms?.emit("editMessage",{msgID:editData._id,editedMsg:text.trim(),roomID:roomId});cleanup();}};
 const typing=useRef<ReturnType<typeof setTimeout>|null>(null); const typingNow=()=>{if(typing.current)clearTimeout(typing.current);rooms?.emit("typing",{roomID:roomId,sender:me});typing.current=setTimeout(()=>rooms?.emit("stop-typing",{roomID:roomId,sender:me}),1500);};
 const onChange=(e:ChangeEvent<HTMLTextAreaElement>)=>{setText(e.target.value);resize();typingNow();};
 const onKey=(e:React.KeyboardEvent<HTMLTextAreaElement>)=>{if(e.key==="Enter"&&!e.shiftKey&&!isMobile()&&text.trim()){e.preventDefault();editData?edit():sendText();}};
 useEffect(()=>{resize();setText(roomId?localStorage.getItem(roomId)||"":"");},[roomId,resize]);
 useEffect(()=>{if(roomId&&text)localStorage.setItem(roomId,text);},[roomId,text]);
 useEffect(()=>{if(editData?.message)setText(editData.message);},[editData?.message]);
 return <div className="sticky bottom-0 w-full flex flex-col bg-leftBarBg z-20">
  {(replayData?._id||editData?._id)&&<div className="flex justify-between border-b border-chatBg h-12 items-center px-2"><div className="flex items-center gap-3 min-w-0">{editData?<MdModeEditOutline className="size-6 text-lightBlue"/>:<BsFillReplyFill className="size-6 text-lightBlue"/>}<div className="min-w-0"><p className="text-lightBlue text-sm truncate">{editData?"ویرایش پیام":`پاسخ به ${replayData?.sender?.name||"پیام"}`}</p><p className="text-xs text-white/60 truncate">{replayData?.message||editData?.message||"پیام صوتی"}</p></div></div><IoMdClose className="size-7 cursor-pointer" onClick={cleanup}/></div>}
  <div className="relative flex items-center min-h-12 px-3 gap-2">
   <BsEmojiSmile className="size-6 cursor-pointer" onClick={()=>{setEmoji(v=>!v);setSticker(false);}}/>
   <PiStickerLight className="size-6 cursor-pointer" onClick={()=>{setSticker(v=>!v);setEmoji(false);}}/>
   {!editData&&<><input ref={fileInput} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.txt,.csv,.json,.docx,.xlsx,.pptx,.zip" onChange={pickFile}/><MdAttachFile className={`size-7 rotate-[215deg] cursor-pointer ${uploading?"opacity-40":""}`} onClick={()=>!uploading&&fileInput.current?.click()}/></>}
   <textarea dir="auto" ref={input} value={text} onChange={onChange} onKeyDown={onKey} className="bg-transparent w-full resize-none outline-none" placeholder="پیام..."/>
   {editData?<button onClick={edit} disabled={!text.trim()} className="p-1 bg-lightBlue rounded-full"><MdOutlineDone size={20}/></button>:text.trim()?<RiSendPlaneFill onClick={sendText} className="size-7 cursor-pointer text-lightBlue rotate-45"/>:<VoiceMessageRecorder replayData={replayData} closeEdit={closeEdit} closeReplay={closeReplay}/>}
  </div>
  {sticker&&<div className="grid grid-cols-4 gap-2 p-3 bg-modalBg border-t border-white/10">{["❤️","😂","🔥","😍","😎","🥳","😭","🤯","👍","👎","🎉","🚀"].map(e=><button key={e} onClick={()=>sendSticker(e)} className="text-3xl hover:scale-125 transition-transform">{e}</button>)}</div>}
  {emoji&&<div><EmojiPicker handleEmojiClick={(e:{emoji:string})=>setText(v=>v+e.emoji)} isEmojiOpen={emoji}/></div>}
 </div>;
}
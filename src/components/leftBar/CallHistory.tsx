"use client";
import { useEffect, useState } from "react";
import { FiPhoneCall, FiVideo, FiX } from "react-icons/fi";
import useSockets from "@/stores/useSockets";
import useUserStore from "@/stores/userStore";
type CallRow={_id:string;callId:string;caller:any;receiver:any;roomID:string;type:"audio"|"video";status:string;startedAt:string};
export default function CallHistory({onClose}:{onClose:()=>void}){
 const [calls,setCalls]=useState<CallRow[]>([]); const myID=useUserStore(s=>s._id); const socket=useSockets(s=>s.rooms);
 useEffect(()=>{fetch("/api/calls/history").then(r=>r.ok?r.json():{calls:[]}).then(x=>setCalls(x.calls||[])).catch(()=>setCalls([]));},[]);
 const again=(c:CallRow)=>{const peer=String(c.caller?._id)===myID?c.receiver:c.caller;if (!peer || !peer._id) return;if(!socket)return;socket.emit("call:invite",{callId:crypto.randomUUID(),roomID:c.roomID,targetUserID:peer._id,type:c.type});};
 return <div className="absolute inset-0 z-50 bg-leftBarBg text-white overflow-y-auto p-4"><div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">Call History</h2><button onClick={onClose}><FiX/></button></div>{calls.length===0?<p className="text-gray-400">No calls yet.</p>:calls.map(c=>{const peer=String(c.caller?._id)===myID?c.receiver:c.caller;return <div key={c._id} className="flex items-center gap-3 border-b border-white/10 py-3"><div className="flex-1"><div>{peer?.name||peer?.username||"User"}</div><div className="text-xs text-gray-400">{c.status} · {new Date(c.startedAt).toLocaleString()}</div></div><button title="Call again" className="p-2 rounded-full hover:bg-white/10" onClick={()=>again(c)}>{c.type==="video"?<FiVideo/>:<FiPhoneCall/>}</button></div>})}</div>;
}

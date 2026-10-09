"use client";
import { useEffect, useState } from "react";
import useGlobalStore from "@/stores/globalStore";
import useUserStore from "@/stores/userStore";
import { toaster } from "@/utils";

type ScheduledItem={_id:string;room:string;payload:{message?:string};scheduledFor:string;status:string;sentAt?:string};
export default function ScheduledMessages({getBack}:{getBack:()=>void}){
 const rooms=useUserStore(s=>s.rooms);
 const [items,setItems]=useState<ScheduledItem[]>([]);
 const [roomId,setRoomId]=useState(""); const [message,setMessage]=useState(""); const [when,setWhen]=useState(""); const [loading,setLoading]=useState(false);
 const load=async()=>{const r=await fetch("/api/scheduled-messages");if(r.ok)setItems((await r.json()).scheduled||[]);};
 useEffect(()=>{load()},[]);
 const schedule=async()=>{if(!roomId||!message.trim()||!when)return;setLoading(true);try{const r=await fetch("/api/scheduled-messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({roomId,payload:{message:message.trim()},scheduledFor:new Date(when).toISOString()})});const d=await r.json();if(!r.ok)throw new Error(d.message);setMessage("");setWhen("");await load();toaster("success","پیام زمان‌بندی شد")}catch(e){toaster("error",e instanceof Error?e.message:"خطا")}finally{setLoading(false)}};
 return <div className="min-h-dvh text-white p-4"><button onClick={getBack} className="mb-5">← Scheduled Messages</button>
 <div className="space-y-3 mb-8"><select value={roomId} onChange={e=>setRoomId(e.target.value)} className="w-full bg-white/10 rounded p-2"><option value="">انتخاب گفتگو</option>{rooms.filter(r=>r.type!=="private"||r.participants.length>1).map(r=><option key={r._id} value={r._id}>{r.name}</option>)}</select><textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="پیام..." className="w-full min-h-24 bg-white/10 rounded p-2"/><input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} className="w-full bg-white/10 rounded p-2"/><button disabled={loading||!roomId||!message.trim()||!when} onClick={schedule} className="bg-lightBlue rounded px-4 py-2">زمان‌بندی</button></div>
 <div className="space-y-2">{items.map(i=><div key={i._id} className="border-b border-white/10 p-3"><div className="font-bold">{rooms.find(r=>r._id===i.room)?.name||"گفتگو"}</div><div className="text-sm">{i.payload?.message}</div><div className="text-xs text-white/50">{new Date(i.scheduledFor).toLocaleString()} · {i.status}</div></div>)}</div>
 </div>;
}

"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {FiMic,FiMicOff,FiPhoneOff,FiVideo,FiVideoOff,FiWifi,FiWifiOff} from "react-icons/fi";
import useSockets from "@/stores/useSockets";

type CallType="audio"|"video";
type CallState="idle"|"calling"|"incoming"|"connecting"|"connected"|"reconnecting"|"failed";
type Quality="excellent"|"good"|"poor"|"unknown";
type CallInfo={callId:string;roomID:string;type:CallType;name:string;avatar?:string;isCaller:boolean};
type TurnConfigResponse={iceServers:RTCIceServer[];ttl:number|null;expiresAt:number|null;mode:"ephemeral"|"static"};

const STUN_FALLBACK:RTCIceServer={urls:"stun:stun.l.google.com:19302"};
const CALL_STORAGE_KEY="stargram:active-call";
const RING_TIMEOUT_MS=30_000;
const ICE_RESTART_DELAY_MS=1_500;
const MAX_ICE_RESTARTS=2;

const persistCall=(call:CallInfo|null)=>{
  try{if(call)sessionStorage.setItem(CALL_STORAGE_KEY,JSON.stringify(call));else sessionStorage.removeItem(CALL_STORAGE_KEY);}catch{}
};
const readPersistedCall=():CallInfo|null=>{
  try{const raw=sessionStorage.getItem(CALL_STORAGE_KEY);if(!raw)return null;const value=JSON.parse(raw);return value?.callId&&value?.roomID&&value?.type?value:null;}catch{return null;}
};

export default function CallOverlay(){
 const socket=useSockets(s=>s.rooms);
 const [state,setState]=useState<CallState>("idle");
 const [call,setCall]=useState<CallInfo|null>(null);
 const [local,setLocal]=useState<MediaStream|null>(null);
 const [remote,setRemote]=useState<MediaStream|null>(null);
 const [muted,setMuted]=useState(false);
 const [cameraOff,setCameraOff]=useState(false);
 const [quality,setQuality]=useState<Quality>("unknown");
 const [error,setError]=useState("");
 const [seconds,setSeconds]=useState(0);
 const [networkOnline,setNetworkOnline]=useState(true);
 const pc=useRef<RTCPeerConnection|null>(null);
 const localRef=useRef<MediaStream|null>(null);
 const pending=useRef<RTCIceCandidateInit[]>([]);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const statsTimer=useRef<ReturnType<typeof setInterval>|null>(null);
 const reconnectTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const durationTimer=useRef<ReturnType<typeof setInterval>|null>(null);
 const restartCount=useRef(0);
 const retrying=useRef(false);
 const restoring=useRef(false);
 const lv=useRef<HTMLVideoElement|null>(null);
 const rv=useRef<HTMLVideoElement|null>(null);
 const ra=useRef<HTMLAudioElement|null>(null);
 const rtcConfigRef=useRef<RTCConfiguration|null>(null);

 const stopTimers=useCallback(()=>{
   if(timer.current)clearTimeout(timer.current);
   if(statsTimer.current)clearInterval(statsTimer.current);
   if(reconnectTimer.current)clearTimeout(reconnectTimer.current);
   if(durationTimer.current)clearInterval(durationTimer.current);
   timer.current=null;statsTimer.current=null;reconnectTimer.current=null;durationTimer.current=null;
 },[]);

 const cleanup=useCallback((notify=false)=>{
   if(notify&&call?.callId)socket?.emit("call:end",{callId:call.callId});
   stopTimers();pc.current?.close();pc.current=null;
   localRef.current?.getTracks().forEach(t=>t.stop());localRef.current=null;
   setLocal(null);setRemote(null);setCall(null);setState("idle");setQuality("unknown");setError("");
   setMuted(false);setCameraOff(false);setSeconds(0);pending.current=[];rtcConfigRef.current=null;
   restartCount.current=0;retrying.current=false;persistCall(null);
 },[call,socket,stopTimers]);

 const getMedia=useCallback(async(type:CallType)=>{
   if(!navigator.mediaDevices?.getUserMedia)throw new Error("MEDIA_UNAVAILABLE");
   try{
     const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:type==="video"});
     localRef.current=stream;setLocal(stream);return stream;
   }catch(e){
     const name=e instanceof DOMException?e.name:"";
     throw new Error(name==="NotAllowedError"||name==="SecurityError"?"PERMISSION_DENIED":name==="NotFoundError"?"DEVICE_NOT_FOUND":"MEDIA_ERROR");
   }
 },[]);

 const loadRtcConfig=useCallback(async()=>{
   if(rtcConfigRef.current)return rtcConfigRef.current;
   try{
     const response=await fetch("/api/calls/turn-credentials",{cache:"no-store",credentials:"same-origin"});
     if(!response.ok)throw new Error("TURN_UNAVAILABLE");
     const data=(await response.json()) as TurnConfigResponse;
     if(!Array.isArray(data.iceServers)||!data.iceServers.length)throw new Error("TURN_INVALID");
     const config:RTCConfiguration={iceServers:data.iceServers};
     rtcConfigRef.current=config;return config;
   }catch(error){
     if(process.env.NODE_ENV==="production")throw error;
     const config:RTCConfiguration={iceServers:[STUN_FALLBACK]};
     rtcConfigRef.current=config;return config;
   }
 },[]);

 const restartIce=useCallback(async(reason:string)=>{
   const peer=pc.current;
   if(!peer||!call||retrying.current)return false;
   if(restartCount.current>=MAX_ICE_RESTARTS){setState("failed");setError("اتصال پایدار نشد. دوباره تلاش کنید.");return false;}
   retrying.current=true;restartCount.current+=1;setState("reconnecting");setError(reason);
   if(!call.isCaller){socket?.emit("call:retry",{callId:call.callId});setTimeout(()=>{retrying.current=false;},ICE_RESTART_DELAY_MS);return true;}
   try{
     const offer=await peer.createOffer({iceRestart:true});
     await peer.setLocalDescription(offer);
     socket?.emit("call:offer",{callId:call.callId,description:peer.localDescription,restart:true});
     socket?.emit("call:retry",{callId:call.callId});
     return true;
   }catch{setState("failed");setError("بازسازی اتصال ناموفق بود.");return false;}
   finally{setTimeout(()=>{retrying.current=false;},ICE_RESTART_DELAY_MS);}
 },[call,socket]);

 const startQualityMonitor=useCallback((peer:RTCPeerConnection)=>{
   if(statsTimer.current)clearInterval(statsTimer.current);
   statsTimer.current=setInterval(async()=>{
     if(peer.connectionState!=="connected")return;
     try{
       const stats=await peer.getStats();
       let lost=0,received=0,jitter=0,rtt=0;
       stats.forEach(report=>{
         if(report.type==="candidate-pair"&&report.state==="succeeded")rtt=Math.max(rtt,Number(report.currentRoundTripTime||0));
         if(report.type==="inbound-rtp"&&(report.kind==="audio"||report.kind==="video"||report.mediaType==="audio"||report.mediaType==="video")){lost+=Number(report.packetsLost||0);received+=Number(report.packetsReceived||0);jitter=Math.max(jitter,Number(report.jitter||0));}
       });
       const prev=qualityPrevious.current;
       const intervalLost=prev?Math.max(0,lost-prev.lost):0;
       const intervalReceived=prev?Math.max(0,received-prev.received):received;
       const lossRate=intervalLost+intervalReceived>0?intervalLost/(intervalLost+intervalReceived):0;
       qualityPrevious.current={lost,received,at:Date.now()};
       const score=lossRate>.08||rtt>.35||jitter>.06?"poor":lossRate>.03||rtt>.18||jitter>.03?"good":"excellent";
       setQuality(score);
     }catch{}
   },3000);
 },[]);

 const makePeer=useCallback(async(info:CallInfo)=>{
   const config=await loadRtcConfig();
   const peer=new RTCPeerConnection(config);
   peer.onicecandidate=e=>e.candidate&&socket?.emit("call:ice",{callId:info.callId,candidate:e.candidate.toJSON()});
   peer.ontrack=e=>setRemote(e.streams?.[0]||new MediaStream([e.track]));
   peer.onconnectionstatechange=()=>{
     if(peer.connectionState==="connected"){setState("connected");setError("");retrying.current=false;startQualityMonitor(peer);}
     if(peer.connectionState==="disconnected"){if(reconnectTimer.current)clearTimeout(reconnectTimer.current);reconnectTimer.current=setTimeout(()=>{if(peer.connectionState==="disconnected")restartIce("شبکه ناپایدار است؛ در حال بازسازی اتصال...");},5000);}
     if(peer.connectionState==="failed"){restartIce("اتصال قطع شد؛ در حال تلاش مجدد...");}
     if(peer.connectionState==="closed")stopTimers();
   };
   peer.oniceconnectionstatechange=()=>{
     if(peer.iceConnectionState==="failed")restartIce("مسیر شبکه‌ی تماس از دست رفت.");
   };
   pc.current=peer;return peer;
 },[loadRtcConfig,socket,startQualityMonitor,restartIce,stopTimers]);

 const beginDuration=useCallback(()=>{
   if(durationTimer.current)clearInterval(durationTimer.current);
   setSeconds(0);durationTimer.current=setInterval(()=>setSeconds(v=>v+1),1000);
 },[]);

 useEffect(()=>{
   if(lv.current&&local)lv.current.srcObject=local;
   if(rv.current&&remote)rv.current.srcObject=remote;
   if(ra.current&&remote)ra.current.srcObject=remote;
 },[local,remote]);

 useEffect(()=>{
  const online=()=>{setNetworkOnline(true);if(state==="reconnecting")restartIce("اتصال اینترنت برگشت؛ در حال بازسازی تماس...");};
  const offline=()=>{setNetworkOnline(false);if(call)setState("reconnecting");};
  window.addEventListener("online",online);window.addEventListener("offline",offline);
  const connection=(navigator as Navigator&{connection?:EventTarget}).connection;
  connection?.addEventListener("change",()=>{if(call&&networkOnline)restartIce("شبکه تغییر کرد؛ در حال بهینه‌سازی مسیر...");});
  return()=>{window.removeEventListener("online",online);window.removeEventListener("offline",offline);};
 },[call,networkOnline,restartIce,state]);

 useEffect(()=>{if(socket&&call&&restoring.current){restoring.current=false;socket.emit("call:reconnect",{callId:call.callId});}},[socket,call?.callId]);

 useEffect(()=>{
  if(!socket)return;
  const outgoing=(d:Omit<CallInfo,"isCaller">)=>{const next={...d,isCaller:true};rtcConfigRef.current=null;setCall(next);persistCall(next);setState("calling");setError("");setSeconds(0);timer.current=setTimeout(()=>cleanup(true),RING_TIMEOUT_MS);};
  const incoming=(d:CallInfo&{from:{name?:string;avatar?:string}})=>{const next={...d,name:d.from?.name||"کاربر",avatar:d.from?.avatar,isCaller:false};rtcConfigRef.current=null;setCall(next);persistCall(next);setState("incoming");setError("");};
  const accepted=async({callId}:{callId:string})=>{
    if(!call||call.callId!==callId)return;
    try{
      const stream=localRef.current||await getMedia(call.type);const p=pc.current||await makePeer(call);
      stream.getTracks().forEach(t=>{if(!p.getSenders().some(s=>s.track===t))p.addTrack(t,stream);});
      const offer=await p.createOffer();await p.setLocalDescription(offer);socket.emit("call:offer",{callId,description:p.localDescription});
      setState("connecting");
    }catch(e){setError(e instanceof Error&&e.message==="PERMISSION_DENIED"?"دسترسی میکروفون یا دوربین داده نشد.":"شروع تماس ناموفق بود.");setState("failed");}
  };
  const rejected=({callId,reason}:{callId:string;reason?:string})=>{if(call?.callId===callId){setError(reason==="permission"?"طرف مقابل به میکروفون یا دوربین دسترسی نداد.":"تماس رد شد.");cleanup(false);}};
  const offer=async({callId,description}:{callId:string;description:RTCSessionDescriptionInit})=>{
    if(!call||call.callId!==callId)return;
    try{
      const p=pc.current||await makePeer(call);await p.setRemoteDescription(description);
      const stream=localRef.current||await getMedia(call.type);
      stream.getTracks().forEach(t=>{if(!p.getSenders().some(s=>s.track===t))p.addTrack(t,stream);});
      for(const candidate of pending.current.splice(0))await p.addIceCandidate(candidate);
      const answer=await p.createAnswer();await p.setLocalDescription(answer);socket.emit("call:answer",{callId,description:p.localDescription});setState("connecting");beginDuration();
    }catch(e){setError(e instanceof Error&&e.message==="PERMISSION_DENIED"?"برای تماس باید اجازه‌ی میکروفون یا دوربین را بدهید.":"دریافت تماس ناموفق بود.");setState("failed");}
  };
  const answer=async({callId,description}:{callId:string;description:RTCSessionDescriptionInit})=>{
    if(!call||call.callId!==callId||!pc.current)return;
    try{await pc.current.setRemoteDescription(description);for(const candidate of pending.current.splice(0))await pc.current.addIceCandidate(candidate);setState("connecting");}
    catch{restartIce("پاسخ تماس نامعتبر بود؛ در حال تلاش مجدد...");}
  };
  const ice=async({callId,candidate}:{callId:string;candidate:RTCIceCandidateInit})=>{
    if(!call||call.callId!==callId)return;
    if(pc.current?.remoteDescription){try{await pc.current.addIceCandidate(candidate);}catch{}}else pending.current.push(candidate);
  };
  const reconnect=async({callId,ready}:{callId:string;ready?:boolean})=>{if(call?.callId!==callId)return;if(!ready){setState("reconnecting");return;}if(!call.isCaller){setState("reconnecting");return;}try{const stream=localRef.current||await getMedia(call.type);const p=pc.current||await makePeer(call);stream.getTracks().forEach(t=>{if(!p.getSenders().some(s=>s.track===t))p.addTrack(t,stream);});const offer=await p.createOffer({iceRestart:true});await p.setLocalDescription(offer);socket.emit("call:offer",{callId,description:p.localDescription,restart:true});setState("connecting");}catch{setState("failed");setError("بازیابی تماس ممکن نشد.");}};
  const peerReconnecting=({callId}:{callId:string})=>{if(call?.callId===callId){setState("reconnecting");if(call.isCaller)void restartIce("طرف مقابل دوباره متصل شد؛ در حال بازسازی تماس...");}};
  const retry=({callId}:{callId:string})=>{if(call?.callId===callId&&call.isCaller)void restartIce("طرف مقابل در حال تلاش مجدد برای اتصال است.");};
  const ended=({callId,reason}:{callId:string;reason?:string})=>{if(call?.callId===callId){setError(reason==="timeout"?"پاسخی دریافت نشد.":reason==="disconnected"?"تماس به‌دلیل قطع اتصال پایان یافت.":"تماس پایان یافت.");cleanup(false);}};
  const onConnect=()=>{const saved=readPersistedCall();if(saved&&!call){restoring.current=true;setCall(saved);setState("reconnecting");}};
  socket.on("call:outgoing",outgoing);socket.on("call:incoming",incoming);socket.on("call:accepted",accepted);socket.on("call:rejected",rejected);
  socket.on("call:offer",offer);socket.on("call:answer",answer);socket.on("call:ice",ice);socket.on("call:reconnected",reconnect);
  socket.on("call:peer-reconnecting",peerReconnecting);
  socket.on("call:retry",retry);socket.on("call:ended",ended);socket.on("connect",onConnect);
  return()=>{socket.off("call:outgoing",outgoing);socket.off("call:incoming",incoming);socket.off("call:accepted",accepted);socket.off("call:rejected",rejected);socket.off("call:offer",offer);socket.off("call:answer",answer);socket.off("call:ice",ice);socket.off("call:reconnected",reconnect);socket.off("call:peer-reconnecting",peerReconnecting);socket.off("call:retry",retry);socket.off("call:ended",ended);socket.off("connect",onConnect);};
 },[socket,call,cleanup,getMedia,makePeer,restartIce,beginDuration]);

 const accept=async()=>{
   if(!call)return;
   try{setError("");await getMedia(call.type);await makePeer(call);socket?.emit("call:accept",{callId:call.callId});setState("connecting");beginDuration();}
   catch(e){setError(e instanceof Error&&e.message==="PERMISSION_DENIED"?"برای پاسخ به تماس باید اجازه‌ی میکروفون یا دوربین را بدهید.":"دسترسی به رسانه ممکن نشد.");setState("failed");}
 };
 const retryCall=async()=>{if(!call)return;restartCount.current=0;setError("");setState("reconnecting");if(pc.current){await restartIce("در حال تلاش مجدد...");}else{socket?.emit("call:reconnect",{callId:call.callId});}};
 const reject=()=>{if(call)socket?.emit("call:reject",{callId:call.callId});cleanup(false);};
 const mute=()=>{const t=localRef.current?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;setMuted(!t.enabled);}};
 const camera=()=>{const t=localRef.current?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;setCameraOff(!t.enabled);}};
 const fmt=(n:number)=>`${Math.floor(n/60).toString().padStart(2,"0")}:${(n%60).toString().padStart(2,"0")}`;
 if(state==="idle"||!call)return null;
 const status=state==="incoming"?"تماس ورودی":state==="calling"?"در حال تماس...":state==="connected"?`در تماس • ${fmt(seconds)}`:state==="reconnecting"?"در حال اتصال مجدد...":state==="failed"?"اتصال ناموفق":"در حال اتصال...";
 const qualityText=quality==="excellent"?"عالی":quality==="good"?"خوب":quality==="poor"?"ضعیف":"—";
 return <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col items-center justify-center p-4">
  <div className="absolute top-5 text-center"><p className="text-white/60">{status}</p><h2 className="text-white text-2xl font-vazirBold">{call.name}</h2>{state==="connected"&&<p className="text-white/50 text-xs mt-1">کیفیت: {qualityText}</p>}{!networkOnline&&<p className="text-red-300 text-xs mt-1">اینترنت قطع است</p>}</div>
  {call.type==="video"&&<div className="relative w-full max-w-3xl aspect-video rounded-3xl overflow-hidden bg-gray-950">{remote?<video ref={rv} autoPlay playsInline className="w-full h-full object-cover"/>:<div className="size-full flex-center text-7xl">👤</div>}{local&&<video ref={lv} autoPlay muted playsInline className="absolute right-3 top-3 w-28 aspect-video rounded-xl object-cover"/>}</div>}
  {call.type==="audio"&&<audio ref={ra} autoPlay className="hidden"/>}
  {error&&<div className="mt-5 max-w-md rounded-2xl bg-red-500/15 px-4 py-3 text-center text-red-100 text-sm">{error}</div>}
  {state==="incoming"?<div className="mt-8 flex gap-5"><button onClick={reject} aria-label="رد تماس" className="size-14 rounded-full bg-red-600 text-white flex-center"><FiPhoneOff/></button><button onClick={accept} aria-label="پاسخ" className="size-14 rounded-full bg-emerald-500 text-white flex-center"><FiPhoneOff className="rotate-[135deg]"/></button></div>
   :<div className="mt-8 flex gap-4 items-center">{state==="connected"&&<><button onClick={mute} aria-label="میکروفون" className="size-12 rounded-full bg-white/10 text-white flex-center">{muted?<FiMicOff/>:<FiMic/>}</button>{call.type==="video"&&<button onClick={camera} aria-label="دوربین" className="size-12 rounded-full bg-white/10 text-white flex-center">{cameraOff?<FiVideoOff/>:<FiVideo/>}</button>}<span className="text-white/50"><FiWifi/></span></>}{(state==="failed"||state==="reconnecting")&&<button onClick={retryCall} aria-label="تلاش مجدد" className="size-12 rounded-full bg-emerald-500 text-white flex-center"><FiWifiOff/></button>}<button onClick={()=>cleanup(true)} aria-label="پایان تماس" className="size-14 rounded-full bg-red-600 text-white flex-center"><FiPhoneOff/></button></div>}
 </div>;
}

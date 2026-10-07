"use client";

import { useEffect, useMemo, useState } from "react";
import { IoClose, IoSearch } from "react-icons/io5";
import useGlobalStore from "@/stores/globalStore";
import useUserStore from "@/stores/userStore";

interface SearchResult {
  _id: string;
  roomID: string;
  sender?: { _id: string; name?: string; username?: string };
  message?: string;
  createdAt: string;
  attachmentData?: { name?: string };
  stickerData?: { emoji?: string };
  room?: { _id: string; name?: string; type?: string };
}

interface Props {
  roomId: string;
  initialQuery?: string;
  initialHashtagMode?: boolean;
  onClose: () => void;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^()|[\]\\]/g, "\\$&");

const MessageSearch = ({ roomId, initialQuery = "", initialHashtagMode = false, onClose }: Props) => {
  const { rooms } = useUserStore((state) => state);
  const { selectedRoom, setter, setPendingMessageJump } = useGlobalStore((state) => state);
  const [allRooms, setAllRooms] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [hashtagMode, setHashtagMode] = useState(initialHashtagMode);
  const [senderId, setSenderId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const participants = useMemo(() => {
    const sourceRooms = allRooms ? rooms : (selectedRoom ? [selectedRoom] : []);
    return sourceRooms
      .flatMap((room) => room.participants)
      .filter((participant) => typeof participant !== "string")
      .map((participant) => participant as { _id: string; name?: string })
      .filter((participant, index, list) => list.findIndex((item) => item._id === participant._id) === index);
  }, [allRooms, rooms, selectedRoom]);

  useEffect(() => {
    const handleSetSearchQuery = (event: Event) => {
      const detail = (event as CustomEvent<{ query?: string; hashtagMode?: boolean }>).detail;
      if (!detail?.query) return;
      setHashtagMode(Boolean(detail.hashtagMode));
      setQuery(detail.query);
    };
    window.addEventListener("stargram:set-search-query", handleSetSearchQuery);
    return () => window.removeEventListener("stargram:set-search-query", handleSetSearchQuery);
  }, []);

  useEffect(() => {
    setPage(1);
    setResults([]);
    setHasMore(false);
  }, [query, roomId, senderId, from, to, allRooms, hashtagMode]);

  useEffect(() => {
    if (!hashtagMode || query.trim().length < 1) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query.trim(), limit: "8" });
        if (!allRooms) params.set("roomId", roomId);
        const response = await fetch("/api/messages/hashtags?" + params.toString(), { signal: controller.signal });
        const data = await response.json();
        if (response.ok) setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSuggestions([]);
      }
    }, 180);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, roomId, allRooms, hashtagMode]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams(hashtagMode ? { hashtag: query.trim() } : { query: query.trim() });
        params.set("page", "1");
        params.set("limit", "50");
        if (!allRooms) params.set("roomId", roomId);
        if (senderId) params.set("senderId", senderId);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (from) params.set("fromOffset", String(new Date(from + "T12:00:00").getTimezoneOffset()));
        if (to) params.set("toOffset", String(new Date(to + "T12:00:00").getTimezoneOffset()));
        const response = await fetch("/api/messages/search?" + params.toString(), { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || "Search failed");
        setResults(data.results || []);
        setHasMore(Boolean(data.hasMore));
        setPage(1);
        setSearched(true);
      } catch (searchError) {
        setError(searchError instanceof Error ? searchError.message : "Search failed");
        setResults([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, roomId, senderId, from, to, allRooms, hashtagMode]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !query.trim()) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const params = new URLSearchParams(hashtagMode ? { hashtag: query.trim() } : { query: query.trim() });
      if (!allRooms) params.set("roomId", roomId);
      if (senderId) params.set("senderId", senderId);
      if (from) { params.set("from", from); params.set("fromOffset", String(new Date(from + "T12:00:00").getTimezoneOffset())); }
      if (to) { params.set("to", to); params.set("toOffset", String(new Date(to + "T12:00:00").getTimezoneOffset())); }
      params.set("page", String(nextPage));
      params.set("limit", "50");
      const response = await fetch("/api/messages/search?" + params.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || "Search failed");
      setResults((current) => [...current, ...(data.results || []).filter((item: SearchResult) => !current.some((existing) => existing._id === item._id))]);
      setPage(nextPage);
      setHasMore(Boolean(data.hasMore));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setLoadingMore(false);
    }
  };

  const highlight = (text: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp("(" + escapeRegExp(query.trim()) + ")", "ig"));
    return parts.map((part, index) =>
      part.toLowerCase() === query.trim().toLowerCase()
        ? <mark key={index} className="rounded bg-yellow-400/40 px-0.5">{part}</mark>
        : <span key={index}>{part}</span>
    );
  };

  const jumpTo = (result: SearchResult) => {
    if (result.roomID === selectedRoom?._id) {
      setPendingMessageJump(result._id);
      onClose();
      return;
    }
    const targetRoom = rooms.find((room) => room._id === result.roomID);
    if (!targetRoom) return;
    setter({ selectedRoom: targetRoom, isRoomDetailsShown: false });
    setPendingMessageJump(result._id);
    onClose();
  };

  return (
    <div className="absolute inset-x-0 top-0 z-40 flex max-h-[80dvh] flex-col border-b border-white/10 bg-leftBarBg shadow-xl">
      <div className="flex items-center gap-2 p-2">
        <IoSearch className="size-5 text-gray-400" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={hashtagMode ? "Search hashtag…" : "Search messages"} className="min-w-0 flex-1 bg-transparent px-2 py-2 outline-none" />
        <button type="button" onClick={onClose} title="Close"><IoClose className="size-6" /></button>
      </div>
      <div className="flex gap-2 overflow-x-auto px-2 pb-2">
        <button type="button" onClick={() => setAllRooms((value) => !value)} className="rounded bg-white/10 px-2 py-1 text-sm whitespace-nowrap">{allRooms ? "All chats" : "This chat"}</button>
        <button type="button" onClick={() => { setHashtagMode((value) => !value); setQuery(""); }} className={`rounded px-2 py-1 text-sm whitespace-nowrap ${hashtagMode ? "bg-lightBlue/30" : "bg-white/10"}`}># Hashtag</button>
        <select value={senderId} onChange={(event) => setSenderId(event.target.value)} className="rounded bg-white/10 px-2 py-1 text-sm">
          <option value="">All senders</option>
          {participants.map((participant) => <option key={participant._id} value={participant._id}>{participant.name || participant._id}</option>)}
        </select>
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded bg-white/10 px-2 py-1 text-sm" />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="rounded bg-white/10 px-2 py-1 text-sm" />
      </div>
      {hashtagMode && suggestions.length > 0 && (\n        <div className="flex flex-wrap gap-2 px-3 pb-2">{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => { setQuery(suggestion); setSuggestions([]); }} className="rounded-full bg-white/10 px-3 py-1 text-sm hover:bg-white/15">#{suggestion}</button>)}</div>\n      )}\n      <div className="overflow-y-auto">
        {loading && <div className="p-4 text-center text-sm text-gray-400">Searching…</div>}
        {!loading && error && <div className="p-4 text-center text-sm text-red-300">{error}</div>}
        {!loading && !error && searched && !results.length && <div className="p-4 text-center text-sm text-gray-400">No messages found.</div>}
        {results.map((result) => (
          <button key={result._id} type="button" onClick={() => jumpTo(result)} className="flex w-full gap-3 border-t border-white/5 px-3 py-3 text-left hover:bg-white/5">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex justify-between gap-2 text-xs text-gray-400">
                <span className="truncate">{result.sender?.name || "Unknown"} · {result.room?.name || "Room"}</span>
                <span>{new Date(result.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="line-clamp-2 text-sm">{highlight(result.message || result.attachmentData?.name || result.stickerData?.emoji || "Media")}</div>
            </div>
          </button>
        ))}
        {hasMore && <button type="button" disabled={loadingMore} onClick={loadMore} className="w-full border-t border-white/5 px-3 py-3 text-sm text-lightBlue disabled:opacity-50">{loadingMore ? "Loading…" : "Load more"}</button>}
      </div>
    </div>
  );
};

export default MessageSearch;

"use client";

import { useEffect, useState } from "react";
import useUserStore from "@/stores/userStore";
import useGlobalStore from "@/stores/globalStore";
import Loading from "../modules/ui/Loading";
import { toaster } from "@/utils";

type PrivacyKey = "lastSeen" | "profilePhoto" | "phone" | "calls" | "messages";
type PrivacyValue = "everyone" | "contacts" | "nobody";

const labels: Record<PrivacyKey, string> = {
  lastSeen: "Last seen & online",
  profilePhoto: "Profile photo",
  phone: "Phone number",
  calls: "Calls",
  messages: "Messages",
};

const PrivacySettings = () => {
  const myData = useUserStore((state) => state);
  const setter = useGlobalStore((state) => state.setter);
  const [settings, setSettings] = useState(myData.privacySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<PrivacyKey | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/privacy", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Unable to load privacy settings");
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setSettings(data);
        useUserStore.getState().setter({ privacySettings: data });
      })
      .catch(() => toaster("error", "Unable to load privacy settings"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const update = async (key: PrivacyKey, value: PrivacyValue) => {
    const previous = settings[key];
    setSettings((current) => ({ ...current, [key]: value }));
    setSaving(key);
    try {
      const res = await fetch("/api/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Unable to update privacy");
      setSettings(data);
      useUserStore.getState().setter({ privacySettings: data });
    } catch {
      setSettings((current) => ({ ...current, [key]: previous }));
      toaster("error", "Unable to update privacy setting");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="flex-center py-10"><Loading size="lg" /></div>;

  return (
    <div className="px-3 py-2 space-y-1">
      <p className="text-lightBlue text-sm mb-4">Who can see or contact you</p>
      {(Object.keys(labels) as PrivacyKey[]).map((key) => (
        <label key={key} className="flex items-center justify-between gap-3 py-3 border-b border-black/30">
          <span>{labels[key]}</span>
          <span className="flex items-center gap-2">
            {saving === key && <Loading size="sm" />}
            <select
              value={settings[key]}
              disabled={saving !== null}
              onChange={(event) => update(key, event.target.value as PrivacyValue)}
              className="bg-leftBarBg border border-white/10 rounded px-2 py-1 text-sm outline-none"
            >
              <option value="everyone">Everyone</option>
              <option value="contacts">Contacts</option>
              <option value="nobody">Nobody</option>
            </select>
          </span>
        </label>
      ))}
      <p className="text-darkGray text-xs pt-3">Exceptions (allow/deny) will be added in the next privacy stage.</p>
    </div>
  );
};

export default PrivacySettings;

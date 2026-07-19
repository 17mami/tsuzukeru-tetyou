import React, { useState, useEffect, useCallback } from "react";
import {
  Flame,
  Settings2,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Check,
  Users,
} from "lucide-react";
import { storage } from "./storage";

/* ---------- design tokens ----------
  cream:      #FAF6EE  base background
  cream-deep: #F1EADB  card / panel background
  ink:        #34302A  primary text
  ink-soft:   #6B6459  secondary text
  bloom:      #B5651D  "full" rank — warm rust, fully bloomed
  sprout:     #8C9574  "mid" rank — sage green, growing
  seed:       #C9BFA5  "seed" rank — muted sand, just a seed
  line:       #E4DBCB  hairline dividers
*/

const RANK_META = {
  bloom: { label: "花が咲いた日", color: "#B5651D", bg: "#F3E3D3", emoji: "🌸" },
  sprout: { label: "芽が出た日", color: "#8C9574", bg: "#E6E9DC", emoji: "🌱" },
  seed: { label: "種をまいた日", color: "#9C9280", bg: "#EDE8DC", emoji: "🌰" },
};

const DEFAULT_TASK = {
  name: "リール投稿",
  ranks: {
    bloom: "台本から作った、しっかりしたリール",
    sprout: "使いまわしネタリール",
    seed: "トライアルリール",
  },
};

const DEFAULT_REACTION_SET = ["👏", "👍", "❤️‍🔥"];

// name is kept only in this browser's localStorage (no login system here) —
// everything else lives in the shared Supabase table, namespaced by name.
const NAME_STORAGE_KEY = "tsuzukeru_myname";

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// A branch blooms every 10 days, and after 3 branches (30 days) the whole
// plant returns to a fresh seed and starts again — so a month always plays
// out as: bloom, bloom, bloom, then back to the start.
const BLOOM_CYCLE_LENGTH = 10;
const MONTH_LENGTH = 30;
function monthPositionFromTotal(total) {
  if (!total || total <= 0) return 0;
  return ((total - 1) % MONTH_LENGTH) + 1; // 1..30, wraps every 30 days
}
function bloomCyclesCompleted(total) {
  return Math.floor(monthPositionFromTotal(total) / BLOOM_CYCLE_LENGTH); // 0..3
}

function sanitizeName(name) {
  return name.trim().replace(/[\s/\\'"]+/g, "_").slice(0, 40) || "member";
}

// key builders for this person's own data, namespaced by their chosen name
const taskKey = (key) => `task:${key}`;
const logKey = (key) => `logs:${key}`;
const cheerKey = (key) => `cheers:${key}`;
const reactionSetKey = (key) => `reactionset:${key}`;

export default function TsuzukeruApp() {
  const [task, setTask] = useState(DEFAULT_TASK);
  const [logs, setLogs] = useState({}); // { '2026-07-18': 'bloom' }
  const [cheers, setCheers] = useState([]); // [{date, text}]
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [cheerDraft, setCheerDraft] = useState("");
  const [toast, setToast] = useState("");

  const [profile, setProfile] = useState(null); // { name }
  const [nameDraft, setNameDraft] = useState("");
  const [feed, setFeed] = useState([]); // [{name, rank, taskName, ts}]
  const [reactions, setReactions] = useState({}); // { "ownerKey:date": {emoji: [names]} }
  const [showNameEdit, setShowNameEdit] = useState(false);

  const [reactionSet, setReactionSet] = useState(DEFAULT_REACTION_SET);
  const [showReactionEdit, setShowReactionEdit] = useState(false);
  const [reactionDraft, setReactionDraft] = useState(DEFAULT_REACTION_SET.join(" "));
  const [memberStreaks, setMemberStreaks] = useState([]); // [{name, streak, total, rank}]
  const [monthOffset, setMonthOffset] = useState(0); // 0 = current month, -1 = last month, etc.

  const [shareLogs, setShareLogs] = useState(true); // whether this device's records are shared to the group
  const [calendarMode, setCalendarMode] = useState("self"); // "self" | "all"
  const [activeTab, setActiveTab] = useState("record"); // "record" | "calendar" | "group" — bottom tab bar
  const [selectedMemberKey, setSelectedMemberKey] = useState(null); // sanitized name of teammate whose calendar is shown
  const [teammateLogsCache, setTeammateLogsCache] = useState({}); // { ownerKey: {date: rank} }
  const [selectedDay, setSelectedDay] = useState(null); // { ownerKey, ownerName, date } for the stamp panel
  const [myStamps, setMyStamps] = useState({}); // { emoji: count } received by me, across all days

  const today = todayStr();

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  }, []);

  // ---------- load this person's own data (task/logs/cheers/reactionSet) ----------
  // Called once when the name is known (either restored from localStorage on
  // load, or just entered). If Supabase already has data for that name, we
  // adopt it (so typing the same name on another device resumes progress).
  // Otherwise we push whatever is currently in memory up as the starting point.
  const loadPersonalData = useCallback(async (name, currentState) => {
    const key = sanitizeName(name);
    try {
      const t = await storage.get(taskKey(key));
      if (t?.value) setTask(JSON.parse(t.value));
      else await storage.set(taskKey(key), JSON.stringify(currentState.task));
    } catch (e) {
      /* keep local task on error */
    }
    try {
      const l = await storage.get(logKey(key));
      if (l?.value) setLogs(JSON.parse(l.value));
      else if (Object.keys(currentState.logs).length) await storage.set(logKey(key), JSON.stringify(currentState.logs));
    } catch (e) {
      /* keep local logs on error */
    }
    try {
      const c = await storage.get(cheerKey(key));
      if (c?.value) setCheers(JSON.parse(c.value));
      else if (currentState.cheers.length) await storage.set(cheerKey(key), JSON.stringify(currentState.cheers));
    } catch (e) {
      /* keep local cheers on error */
    }
    try {
      const rs = await storage.get(reactionSetKey(key));
      if (rs?.value) {
        const parsed = JSON.parse(rs.value);
        if (Array.isArray(parsed) && parsed.length) {
          setReactionSet(parsed);
          setReactionDraft(parsed.join(" "));
        }
      }
    } catch (e) {
      /* keep default reaction set on error */
    }
  }, []);

  useEffect(() => {
    (async () => {
      const savedName = typeof window !== "undefined" ? window.localStorage.getItem(NAME_STORAGE_KEY) : null;
      if (savedName) {
        setProfile({ name: savedName });
        await loadPersonalData(savedName, { task, logs, cheers });
      }
      setLoaded(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  // ---------- load today's group feed + reactions ----------
  const loadFeed = useCallback(async () => {
    const mine = profile && shareLogs && logs[today] ? [{ name: profile.name, rank: logs[today], taskName: task.name, ts: Date.now() }] : [];
    try {
      const list = await storage.list(`feed:${today}:`);
      const keys = (list?.keys || []).filter((k) => k !== `feed:${today}:${sanitizeName(profile?.name || "")}`);
      const entries = [];
      for (const k of keys) {
        try {
          const r = await storage.get(k);
          if (r?.value) entries.push(JSON.parse(r.value));
        } catch (e) {
          /* skip unreadable entry */
        }
      }
      entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setFeed([...mine, ...entries]);
    } catch (e) {
      setFeed(mine);
    }
  }, [today, profile, logs, task, shareLogs]);

  // ---------- reactions ----------
  // key scheme: react:{ownerKey}:{date}
  const loadReactions = useCallback(async () => {
    try {
      const ownerKeys = Array.from(new Set(feed.map((f) => sanitizeName(f.name))));
      const next = {};
      for (const ownerKey of ownerKeys) {
        try {
          const r = await storage.get(`react:${ownerKey}:${today}`);
          if (r?.value) next[`${ownerKey}:${today}`] = JSON.parse(r.value);
        } catch (e) {
          /* no reactions yet for this person today */
        }
      }
      setReactions((prev) => ({ ...prev, ...next }));
    } catch (e) {
      /* keep whatever was already loaded */
    }
  }, [today, feed]);

  const loadDayReactions = useCallback(async (ownerKey, date) => {
    try {
      const r = await storage.get(`react:${ownerKey}:${date}`);
      setReactions((prev) => ({ ...prev, [`${ownerKey}:${date}`]: r?.value ? JSON.parse(r.value) : {} }));
    } catch (e) {
      setReactions((prev) => ({ ...prev, [`${ownerKey}:${date}`]: {} }));
    }
  }, []);

  const loadMyStamps = useCallback(async () => {
    if (!profile) return;
    const myKey = sanitizeName(profile.name);
    try {
      const list = await storage.list(`react:${myKey}:`);
      const keys = list?.keys || [];
      const totals = {};
      for (const k of keys) {
        try {
          const r = await storage.get(k);
          if (r?.value) {
            const doc = JSON.parse(r.value);
            for (const emoji of Object.keys(doc)) {
              totals[emoji] = (totals[emoji] || 0) + (doc[emoji]?.length || 0);
            }
          }
        } catch (e) {
          /* skip unreadable day */
        }
      }
      setMyStamps(totals);
    } catch (e) {
      setMyStamps({});
    }
  }, [profile]);

  // ---------- everyone's real continuation, visible as a group overview ----------
  const streakFromLogDict = (dict) => {
    let s = 0;
    for (let i = 0; ; i++) {
      const d = daysAgoStr(i);
      if (dict[d]) s++;
      else break;
    }
    return s;
  };

  const loadMemberStreaks = useCallback(async () => {
    const mine =
      profile && shareLogs
        ? [{ name: profile.name, streak: streakFromLogDict(logs), total: Object.keys(logs).length, rank: logs[today] || null }]
        : [];
    try {
      const list = await storage.list("memberlog:");
      const keys = (list?.keys || []).filter((k) => k !== `memberlog:${sanitizeName(profile?.name || "")}`);
      const others = [];
      for (const k of keys) {
        try {
          const r = await storage.get(k);
          if (r?.value) {
            const doc = JSON.parse(r.value);
            const dict = doc.logs || {};
            others.push({ name: doc.name, streak: streakFromLogDict(dict), total: Object.keys(dict).length, rank: dict[today] || null });
          }
        } catch (e) {
          /* skip unreadable member */
        }
      }
      setMemberStreaks([...mine, ...others]);
    } catch (e) {
      setMemberStreaks(mine);
    }
  }, [today, profile, logs, shareLogs]);

  // ---------- teammate calendars, for the "みんな" calendar view ----------
  const loadTeammateLogs = useCallback(
    async (member) => {
      const ownerKey = sanitizeName(member.name);
      if (teammateLogsCache[ownerKey]) return; // already cached
      try {
        const r = await storage.get(`memberlog:${ownerKey}`);
        const dict = r?.value ? JSON.parse(r.value).logs || {} : {};
        setTeammateLogsCache((c) => ({ ...c, [ownerKey]: dict }));
      } catch (e) {
        setTeammateLogsCache((c) => ({ ...c, [ownerKey]: {} }));
      }
    },
    [teammateLogsCache]
  );

  useEffect(() => {
    if (loaded) {
      loadFeed();
      loadMemberStreaks();
      loadMyStamps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, logs, profile, shareLogs]);

  useEffect(() => {
    loadReactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  // ---------- "みんな" calendar mode: auto-pick a member and fetch their log ----------
  useEffect(() => {
    if (calendarMode !== "all" || memberStreaks.length === 0) return;
    const stillValid = memberStreaks.some((m) => sanitizeName(m.name) === selectedMemberKey);
    if (!selectedMemberKey || !stillValid) {
      const nonSelf = memberStreaks.find((m) => !profile || m.name !== profile.name);
      const chosen = nonSelf || memberStreaks[0];
      setSelectedMemberKey(sanitizeName(chosen.name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMode, memberStreaks]);

  useEffect(() => {
    if (calendarMode !== "all" || !selectedMemberKey) return;
    const member = memberStreaks.find((m) => sanitizeName(m.name) === selectedMemberKey);
    if (member) loadTeammateLogs(member);
    setSelectedDay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMode, selectedMemberKey, memberStreaks]);

  const saveTask = async (next) => {
    setTask(next);
    if (!profile) return;
    try {
      await storage.set(taskKey(sanitizeName(profile.name)), JSON.stringify(next));
    } catch (e) {
      showToast("保存に失敗しました");
    }
  };

  const saveLogs = async (next) => {
    setLogs(next);
    if (!profile) return;
    try {
      await storage.set(logKey(sanitizeName(profile.name)), JSON.stringify(next));
    } catch (e) {
      showToast("保存に失敗しました");
    }
  };

  const saveCheers = async (next) => {
    setCheers(next);
    if (!profile) return;
    try {
      await storage.set(cheerKey(sanitizeName(profile.name)), JSON.stringify(next));
    } catch (e) {
      showToast("保存に失敗しました");
    }
  };

  const saveProfile = async (next) => {
    setProfile(next);
    if (typeof window !== "undefined") window.localStorage.setItem(NAME_STORAGE_KEY, next.name);
    await loadPersonalData(next.name, { task, logs, cheers });
  };

  const saveReactionSet = async (nextArr) => {
    setReactionSet(nextArr);
    if (!profile) return;
    try {
      await storage.set(reactionSetKey(sanitizeName(profile.name)), JSON.stringify(nextArr));
    } catch (e) {
      /* silently keep in-memory copy */
    }
  };

  const saveShareLogs = (next) => {
    // Purely a local, in-memory preference: it only gates what checkIn()
    // sends to the shared feed/memberlog going forward.
    setShareLogs(next);
    showToast(next ? "グループに共有します😊" : "共有をやめました。記録はあなただけに残ります");
  };

  const checkIn = async (rank, targetDate = today) => {
    const isToday = targetDate === today;
    const nextLogs = { ...logs, [targetDate]: rank };
    saveLogs(nextLogs);
    showToast(isToday ? RANK_META[rank].emoji + " 今日も記録できました" : RANK_META[rank].emoji + ` ${targetDate.slice(5)} の種まきを記録しました`);

    if (!profile) return; // no name yet — feed post happens once name is set
    if (!shareLogs) return; // sharing is turned off — keep this check-in local only

    try {
      // memberlog always mirrors the full log dict, so past-day backfills
      // are reflected in everyone's streak/calendar view too.
      await storage.set(`memberlog:${sanitizeName(profile.name)}`, JSON.stringify({ name: profile.name, logs: nextLogs }));
      if (isToday) {
        const entry = { name: profile.name, rank, taskName: task.name, ts: Date.now() };
        await storage.set(`feed:${today}:${sanitizeName(profile.name)}`, JSON.stringify(entry));
        loadFeed();
      }
      loadMemberStreaks();
    } catch (e) {
      showToast("みんなの記録への共有に失敗しました");
    }
  };

  const clearDay = async (targetDate) => {
    const nextLogs = { ...logs };
    delete nextLogs[targetDate];
    saveLogs(nextLogs);
    showToast("記録を取り消しました");

    if (!profile || !shareLogs) return;
    const isToday = targetDate === today;
    try {
      await storage.set(`memberlog:${sanitizeName(profile.name)}`, JSON.stringify({ name: profile.name, logs: nextLogs }));
      if (isToday) {
        await storage.delete(`feed:${today}:${sanitizeName(profile.name)}`);
        loadFeed();
      }
      loadMemberStreaks();
    } catch (e) {
      showToast("取り消しの共有に失敗しました");
    }
  };

  const toggleReaction = async (ownerName, date, emoji) => {
    if (!profile) {
      setShowNameEdit(true);
      return;
    }
    const ownerKey = sanitizeName(ownerName);
    const stateKey = `${ownerKey}:${date}`;
    const current = reactions[stateKey] || {};
    const list = current[emoji] || [];
    const already = list.includes(profile.name);
    const nextList = already ? list.filter((n) => n !== profile.name) : [...list, profile.name];
    const nextDoc = { ...current, [emoji]: nextList };
    setReactions((r) => ({ ...r, [stateKey]: nextDoc }));

    try {
      await storage.set(`react:${ownerKey}:${date}`, JSON.stringify(nextDoc));
      if (ownerKey === sanitizeName(profile.name)) loadMyStamps();
    } catch (e) {
      showToast("リアクションの送信に失敗しました");
    }
  };

  const addCheer = () => {
    if (!cheerDraft.trim()) return;
    const next = [{ date: today, text: cheerDraft.trim() }, ...cheers].slice(0, 30);
    saveCheers(next);
    setCheerDraft("");
    showToast("😊 自分に拍手を送りました");
  };

  // ---------- streak calc ----------
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = daysAgoStr(i);
    if (logs[d]) streak++;
    else break;
  }

  const totalDone = Object.keys(logs).length;
  const bloomCount = Object.values(logs).filter((r) => r === "bloom").length;
  const bloomCycles = bloomCyclesCompleted(totalDone);

  // ---------- calendar grid for the current viewed month ----------
  const now = new Date();
  const viewedDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const viewYear = viewedDate.getFullYear();
  const viewMonth = viewedDate.getMonth(); // 0-indexed
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const calendarCells = [];
  for (let i = 0; i < firstWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  const monthLabel = `${viewYear}年 ${viewMonth + 1}月`;
  const isCurrentMonth = monthOffset === 0;

  const selectedMember = calendarMode === "all" ? memberStreaks.find((m) => sanitizeName(m.name) === selectedMemberKey) : null;
  const displayLogs = calendarMode === "self" ? logs : teammateLogsCache[selectedMemberKey] || {};
  const calendarOwnerKey = calendarMode === "self" ? (profile ? sanitizeName(profile.name) : null) : selectedMemberKey;
  const calendarOwnerName = calendarMode === "self" ? profile?.name : selectedMember?.name;

  const todayRank = logs[today];

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF6EE] text-[#6B6459] text-sm">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAF6EE] text-[#34302A]" style={{ fontFamily: "'Zen Kaku Gothic New', sans-serif" }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap"
        rel="stylesheet"
      />

      <div className="max-w-md mx-auto px-5 pt-10 pb-28">
        {/* ---------- hero ---------- */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2.5 mb-2.5">
            <span className="h-px w-6" style={{ background: "#C9BFA5" }} />
            <span className="text-[10px] text-[#B5651D]" style={{ fontFamily: "'Shippori Mincho', serif", letterSpacing: "0.35em" }}>
              グループ2
            </span>
            <span className="h-px w-6" style={{ background: "#C9BFA5" }} />
          </div>
          <h1 className="text-[20px] mb-1.5" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 700, letterSpacing: "0.08em" }}>
            続ける手帳
          </h1>
          <p className="text-xs text-[#6B6459] leading-relaxed">できる日もできない日も、種をまけば続いている。</p>
        </div>

        {/* ---------- profile badge ---------- */}
        <button
          onClick={() => {
            setNameDraft(profile?.name || "");
            setShowNameEdit(true);
          }}
          className="w-full flex items-center justify-between rounded-[14px] bg-white border border-[rgba(180,150,120,0.08)] shadow-[0_2px_14px_rgba(90,70,50,0.07)] px-4 py-3 mb-3.5"
        >
          <span className="flex items-center gap-2 text-[12px]">
            <Users size={15} className="text-[#8C9574]" />
            {profile ? (
              <span>
                <b>{profile.name}</b> として記録しています
              </span>
            ) : (
              <span className="text-[#6B6459]">タップして名前を登録してください</span>
            )}
          </span>
          <span className="text-[11px] text-[#8C9574]">{profile ? "変更する" : "登録する"}</span>
        </button>

        {showNameEdit && (
          <div className="rounded-[16px] bg-white border border-[#E4DBCB] px-4 py-4 mb-3.5">
            <label className="text-[10.5px] text-[#6B6459] block mb-1.5">グループで表示する名前</label>
            <div className="flex gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="ニックネームを入力"
                className="flex-1 text-[12px] px-3 py-2 rounded-[10px] border border-[#E4DBCB] bg-[#FAF6EE] outline-none"
              />
              <button
                onClick={() => {
                  if (!nameDraft.trim()) return;
                  saveProfile({ name: nameDraft.trim() });
                  setShowNameEdit(false);
                }}
                className="px-4 rounded-[10px] text-[12px]"
                style={{ background: "#34302A", color: "#FAF6EE" }}
              >
                決定
              </button>
            </div>
          </div>
        )}

        {activeTab === "record" && (
          <>
            {/* ---------- growth stem signature ---------- */}
            <div className="rounded-[20px] bg-white shadow-[0_2px_14px_rgba(90,70,50,0.07)] border border-[rgba(180,150,120,0.08)] px-5 py-5 mb-3.5">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[10px] text-[#6B6459] tracking-wide mb-1">現在の記録</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-[28px]" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 700, color: "#B5651D" }}>
                      {streak}
                    </span>
                    <span className="text-sm text-[#6B6459]">日</span>
                  </div>
                  {profile && Object.keys(myStamps).length > 0 && (
                    <div className="flex items-center gap-1 mt-2" title="もらったスタンプ">
                      {Object.entries(myStamps).map(([emoji, count]) => (
                        <div key={emoji} className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5" style={{ background: "#F3E3D3" }}>
                          <span className="text-[10px] leading-none">{emoji}</span>
                          <span className="text-[9px] font-medium leading-none" style={{ color: "#B5651D" }}>
                            {count}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <GrowthStem totalDone={totalDone} width={46} height={58} />
              </div>
              <div className="flex gap-3 mt-5 pt-4 border-t border-dashed border-[#E4DBCB]">
                <Stat label="総記録日数" value={totalDone} />
                <Stat label="花が咲いた日" value={bloomCount} emoji="🌸" />
                <Stat label="今月の開花" value={bloomCycles} emoji="✨" unit="回" />
              </div>
            </div>

            {/* ---------- today check-in ---------- */}
            <div className="rounded-[20px] bg-white shadow-[0_2px_14px_rgba(90,70,50,0.07)] border border-[rgba(180,150,120,0.08)] px-4 py-4 mb-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-[13px]" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 600 }}>
                  今日の「{task.name}」を記録しよう！
                </h2>
                <button
                  onClick={() => setShowSettings((s) => !s)}
                  className="text-[#6B6459] p-1.5 rounded-full active:bg-[#F1EADB]"
                  aria-label="タスクの設定を編集する"
                >
                  <Settings2 size={14} />
                </button>
              </div>

              {showSettings ? (
                <TaskEditor task={task} onSave={(t) => { saveTask(t); setShowSettings(false); }} />
              ) : (
                <div className="space-y-2">
                  {Object.keys(RANK_META).map((rank) => {
                    const meta = RANK_META[rank];
                    const active = todayRank === rank;
                    return (
                      <button
                        key={rank}
                        onClick={() => checkIn(rank)}
                        className="w-full flex items-center gap-3 rounded-[14px] px-4 py-3 text-left transition"
                        style={{
                          background: active ? meta.bg : "#FAF6EE",
                          border: active ? `1.5px solid ${meta.color}` : "1px solid #E4DBCB",
                        }}
                      >
                        <span className="text-xl">{meta.emoji}</span>
                        <span className="flex-1">
                          <span className="block text-[12px] font-medium" style={{ color: active ? meta.color : "#34302A" }}>
                            {meta.label}
                          </span>
                          <span className="block text-[11px] text-[#6B6459] mt-0.5">{task.ranks[rank]}</span>
                        </span>
                        {active && <Check size={14} color={meta.color} />}
                      </button>
                    );
                  })}
                  <p className="text-[9px] text-[#6B6459] pt-1 leading-relaxed">
                    どのランクでも、選んだ時点で「続いてる日」になり、下のみんなの記録にも並びます。
                  </p>
                </div>
              )}
            </div>

            {/* ---------- today's note ---------- */}
            <div className="rounded-[20px] bg-white shadow-[0_2px_14px_rgba(90,70,50,0.07)] border border-[rgba(180,150,120,0.08)] px-4 py-4 mb-3.5">
              <h2 className="text-[13px] mb-2.5" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 600 }}>
                今日の一言
              </h2>
              <div className="flex gap-2 mb-2.5">
                <input
                  value={cheerDraft}
                  onChange={(e) => setCheerDraft(e.target.value)}
                  placeholder="今日の自分に、ひとこと"
                  className="flex-1 text-[12px] px-3 py-2 rounded-[10px] border border-[#E4DBCB] bg-[#FAF6EE] outline-none"
                />
                <button onClick={addCheer} className="px-4 rounded-[10px] text-[12px] flex items-center gap-1" style={{ background: "#34302A", color: "#FAF6EE" }}>
                  <Sparkles size={13} /> 送る
                </button>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {cheers.length === 0 && (
                  <p className="text-[11px] text-[#6B6459]">まだ何も記録されていません。続いてる自分に、ひとこと残してみてください😊</p>
                )}
                {cheers.map((c, i) => (
                  <div key={i} className="text-[11.5px] bg-[#FAF6EE] rounded-[10px] px-3 py-2">
                    <span className="text-[#6B6459] text-[10px] mr-2">{c.date}</span>
                    {c.text}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === "calendar" && (
          <>
            {/* ---------- seed-planting calendar ---------- */}
            <div className="rounded-[20px] bg-white shadow-[0_2px_14px_rgba(90,70,50,0.07)] border border-[rgba(180,150,120,0.08)] px-4 py-4 mb-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[13px]" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 600 }}>
                    種まきカレンダー
                  </h2>
                  <button
                    onClick={() => saveShareLogs(!shareLogs)}
                    className="p-1.5 rounded-full"
                    style={{ background: shareLogs ? "#E6E9DC" : "#F1EADB", color: shareLogs ? "#8C9574" : "#6B6459" }}
                    title={shareLogs ? "グループに共有中：タップで非共有にする" : "非共有：タップでグループに共有する"}
                    aria-label="グループへの共有を切り替える"
                  >
                    {shareLogs ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#6B6459]">{monthLabel}</span>
                  <button onClick={() => setMonthOffset((o) => o - 1)} className="p-1.5 rounded-full text-[#6B6459] active:bg-[#F1EADB]" aria-label="前の月を見る">
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    onClick={() => setMonthOffset((o) => Math.min(0, o + 1))}
                    className="p-1.5 rounded-full text-[#6B6459] active:bg-[#F1EADB] disabled:opacity-30"
                    disabled={isCurrentMonth}
                    aria-label="次の月を見る"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>

              {/* self / all toggle */}
              <div className="flex rounded-full p-0.5 mb-3 text-[11px]" style={{ background: "#F1EADB" }}>
                {[
                  { key: "self", label: "自分" },
                  { key: "all", label: "みんな" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setCalendarMode(opt.key);
                      setSelectedDay(null);
                    }}
                    className="flex-1 py-1.5 rounded-full transition-all"
                    style={{
                      background: calendarMode === opt.key ? "#FFFFFF" : "transparent",
                      color: calendarMode === opt.key ? "#B5651D" : "#6B6459",
                      fontWeight: calendarMode === opt.key ? 600 : 400,
                      boxShadow: calendarMode === opt.key ? "0 1px 4px rgba(181,101,29,0.18)" : "none",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {calendarMode === "all" && (
                <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
                  {memberStreaks.map((m) => {
                    const key = sanitizeName(m.name);
                    const active = key === selectedMemberKey;
                    const isMe = profile && m.name === profile.name;
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedMemberKey(key)}
                        className="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] whitespace-nowrap"
                        style={{
                          background: active ? "#F3E3D3" : "#FAF6EE",
                          border: active ? "1.5px solid #B5651D" : "1px solid #E4DBCB",
                          color: active ? "#B5651D" : "#6B6459",
                        }}
                      >
                        {isMe ? "あなた" : m.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {calendarMode === "all" && !calendarOwnerKey && (
                <p className="text-[11.5px] text-[#6B6459] mb-2">メンバーを選ぶとカレンダーが表示されます</p>
              )}

              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
                  <div key={w} className="text-center text-[9.5px] text-[#6B6459]">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {calendarCells.map((d, i) => {
                  if (!d) return <div key={"blank" + i} />;
                  const rank = displayLogs[d];
                  const meta = rank ? RANK_META[rank] : null;
                  const isToday = d === today;
                  const isPast = d <= today;
                  const dayNum = parseInt(d.slice(-2), 10);
                  const tappable = calendarMode === "all" ? !!meta && !!calendarOwnerKey : isPast && !!profile;
                  const isSelected = selectedDay && selectedDay.date === d && selectedDay.ownerKey === calendarOwnerKey;
                  return (
                    <button
                      key={d}
                      title={d}
                      disabled={!tappable}
                      onClick={() => {
                        if (!tappable) return;
                        if (isSelected) {
                          setSelectedDay(null);
                          return;
                        }
                        setSelectedDay({ ownerKey: calendarOwnerKey, ownerName: calendarOwnerName, date: d });
                        if (calendarMode === "all" && meta) loadDayReactions(calendarOwnerKey, d);
                      }}
                      className="aspect-square rounded-[7px] flex flex-col items-center justify-center"
                      style={{
                        background: meta ? meta.bg : "#F1EADB",
                        border: isSelected ? "1.5px solid #B5651D" : isToday ? "1.5px solid #34302A" : "1px solid transparent",
                        cursor: tappable ? "pointer" : "default",
                      }}
                    >
                      <span className="text-[8.5px] text-[#6B6459] leading-none mb-0.5">{dayNum}</span>
                      <span className="text-[12px] leading-none">{meta ? meta.emoji : ""}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-3 mt-3 text-[10px] text-[#6B6459]">
                {Object.keys(RANK_META).map((r) => (
                  <span key={r} className="flex items-center gap-1">
                    <span>{RANK_META[r].emoji}</span>
                    {RANK_META[r].label.replace("日", "")}
                  </span>
                ))}
              </div>

              <p className="text-[10px] text-[#6B6459] mt-2">
                {calendarMode === "all" ? "記録がある日をタップすると、その日にスタンプを送れます" : "過去の日をタップすると、その日の記録を追加・変更できます"}
              </p>

              {selectedDay &&
                (() => {
                  if (calendarMode === "self") {
                    const currentRank = displayLogs[selectedDay.date];
                    return (
                      <div className="mt-3 rounded-[12px] bg-[#FAF6EE] border border-[#E9C9A6] px-3.5 py-3">
                        <div className="text-[11.5px] font-medium mb-2">
                          {selectedDay.date} {currentRank ? "の記録を変更する" : "を記録する"}
                        </div>
                        <div className="space-y-1.5">
                          {Object.keys(RANK_META).map((rank) => {
                            const meta = RANK_META[rank];
                            const active = currentRank === rank;
                            return (
                              <button
                                key={rank}
                                onClick={() => {
                                  checkIn(rank, selectedDay.date);
                                  setSelectedDay(null);
                                }}
                                className="w-full flex items-center gap-2 rounded-[10px] px-3 py-2 text-left"
                                style={{
                                  background: active ? meta.bg : "#FFFFFF",
                                  border: active ? `1.5px solid ${meta.color}` : "1px solid #E4DBCB",
                                }}
                              >
                                <span>{meta.emoji}</span>
                                <span className="text-[11.5px]" style={{ color: active ? meta.color : "#34302A" }}>
                                  {meta.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {currentRank && (
                          <button
                            onClick={() => {
                              clearDay(selectedDay.date);
                              setSelectedDay(null);
                            }}
                            className="w-full mt-2 py-2 rounded-[10px] text-[11.5px]"
                            style={{ background: "#FFFFFF", border: "1px solid #E4DBCB", color: "#9C9280" }}
                          >
                            記録を取り消す
                          </button>
                        )}
                      </div>
                    );
                  }

                  const dayRank = (teammateLogsCache[selectedDay.ownerKey] || {})[selectedDay.date];
                  const dayMeta = dayRank ? RANK_META[dayRank] : null;
                  if (!dayMeta) return null;

                  return (
                    <div className="mt-3 rounded-[12px] bg-[#FAF6EE] border border-[#E9C9A6] px-3.5 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11.5px] font-medium">{selectedDay.ownerName}</span>
                        <span className="text-[10.5px] text-[#6B6459]">{selectedDay.date}</span>
                        <span className="text-[10px] text-[#6B6459] ml-auto">
                          {dayMeta.emoji} {dayMeta.label}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        {reactionSet.map((emoji) => {
                          const doc = reactions[`${selectedDay.ownerKey}:${selectedDay.date}`] || {};
                          const names = doc[emoji] || [];
                          const mine = profile && names.includes(profile.name);
                          return (
                            <button
                              key={emoji}
                              onClick={() => toggleReaction(selectedDay.ownerName, selectedDay.date, emoji)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px]"
                              style={{
                                background: mine ? "#E6E9DC" : "#F1EADB",
                                border: mine ? "1.5px solid #8C9574" : "1px solid #E4DBCB",
                              }}
                            >
                              <span>{emoji}</span>
                              {names.length > 0 && <span className="text-[10.5px] text-[#6B6459]">{names.length}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
            </div>
          </>
        )}

        {activeTab === "group" && (
          <>
            {/* ---------- everyone's real continuation ---------- */}
            <div className="rounded-[20px] bg-white shadow-[0_2px_14px_rgba(90,70,50,0.07)] border border-[rgba(180,150,120,0.08)] px-4 py-4 mb-3.5">
              <div className="flex items-center gap-2 mb-2.5">
                <Users size={15} className="text-[#8C9574]" />
                <h2 className="text-[13px]" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 600 }}>
                  みんなの継続
                </h2>
              </div>
              <div className="space-y-2">
                {memberStreaks.length === 0 && (
                  <p className="text-[11.5px] text-[#6B6459]">まだ誰も記録していません。名前を登録して、最初のひとりになってみませんか？😊</p>
                )}
                {memberStreaks.map((m, i) => {
                  const meta = m.rank ? RANK_META[m.rank] : null;
                  return (
                    <div key={m.name + i} className="flex items-center gap-3 rounded-[12px] px-3 py-2.5" style={{ background: "#FAF6EE" }}>
                      <GrowthStem totalDone={m.total ?? m.streak} width={26} height={32} />
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-medium">{m.name}</span>
                          {meta && <span className="text-sm">{meta.emoji}</span>}
                        </div>
                        <div className="text-[10px] text-[#6B6459]">連続 {m.streak}日</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ---------- group feed + reactions ---------- */}
            <div className="rounded-[20px] bg-white shadow-[0_3px_18px_rgba(181,101,29,0.12)] border-[1.5px] border-[#E9C9A6] px-4 py-4 mb-3.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Users size={15} className="text-[#B5651D]" />
                  <h2 className="text-[13px]" style={{ fontFamily: "'Shippori Mincho', serif", fontWeight: 600 }}>
                    今日のみんなのスタンプ
                  </h2>
                </div>
                <button
                  onClick={() => setShowReactionEdit((s) => !s)}
                  className="text-[#B5651D] p-1.5 rounded-full active:bg-[#F3E3D3]"
                  aria-label="スタンプの種類を編集する"
                >
                  <Settings2 size={13} />
                </button>
              </div>
              <p className="text-[10px] text-[#6B6459] mb-2.5">絵文字をタップすると、その人にスタンプ（リアクション）を送れます👇</p>

              {showReactionEdit && (
                <div className="rounded-[12px] bg-[#FAF6EE] border border-[#E9C9A6] px-3 py-3 mb-2.5">
                  <label className="text-[10px] text-[#6B6459] block mb-1.5">使いたいスタンプを、間にスペースを空けて入力（最大4つ）</label>
                  <div className="flex gap-2">
                    <input
                      value={reactionDraft}
                      onChange={(e) => setReactionDraft(e.target.value)}
                      placeholder="👏 👍 ❤️‍🔥 😊"
                      className="flex-1 text-[14px] px-3 py-2 rounded-[10px] border border-[#E4DBCB] bg-white outline-none"
                    />
                    <button
                      onClick={() => {
                        const parsed = reactionDraft.split(/\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
                        if (parsed.length === 0) return;
                        saveReactionSet(parsed);
                        setShowReactionEdit(false);
                      }}
                      className="px-4 rounded-[10px] text-[12px]"
                      style={{ background: "#34302A", color: "#FAF6EE" }}
                    >
                      決定
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2.5">
                {feed.length === 0 && (
                  <p className="text-[11.5px] text-[#6B6459]">今日はまだ誰も記録していません。最初の種をまいてみませんか？😊</p>
                )}
                {feed.map((entry, i) => {
                  const meta = RANK_META[entry.rank] || RANK_META.seed;
                  const ownerKey = sanitizeName(entry.name);
                  const entryReactions = reactions[`${ownerKey}:${today}`] || {};
                  return (
                    <div key={ownerKey + i} className="rounded-[14px] px-3.5 py-3" style={{ background: "#FAF6EE", border: "1px solid #E4DBCB" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{meta.emoji}</span>
                        <span className="text-[12px] font-medium">{entry.name}</span>
                        {profile && entry.name === profile.name && (
                          <span className="text-[9px] text-[#8C9574] bg-[#E6E9DC] px-1.5 py-0.5 rounded-full">あなた</span>
                        )}
                        <span className="text-[10px] text-[#6B6459]">{meta.label}</span>
                      </div>
                      <div className="flex gap-1.5 pl-6">
                        {reactionSet.map((emoji) => {
                          const names = entryReactions[emoji] || [];
                          const mine = profile && names.includes(profile.name);
                          return (
                            <button
                              key={emoji}
                              onClick={() => toggleReaction(entry.name, today, emoji)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[13px]"
                              style={{
                                background: mine ? "#E6E9DC" : "#F1EADB",
                                border: mine ? "1.5px solid #8C9574" : "1px solid #E4DBCB",
                              }}
                            >
                              <span>{emoji}</span>
                              {names.length > 0 && <span className="text-[11px] text-[#6B6459]">{names.length}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!profile && (
                <p className="text-[11px] text-[#B5651D] mt-3">※名前を登録すると、あなたもリアクションを送れます（上の「登録する」から）</p>
              )}
            </div>

            {/* ---------- compare with the group ---------- */}
            <div className="rounded-[20px] bg-white shadow-[0_2px_14px_rgba(90,70,50,0.07)] border border-[rgba(180,150,120,0.08)] px-4 py-4 mb-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11.5px] font-medium">みんなの記録と比べる</div>
                  <div className="text-[10px] text-[#6B6459]">比べたくない時は、いつでも隠せます</div>
                </div>
                <button
                  onClick={() => setShowCompare((s) => !s)}
                  className="p-2 rounded-full"
                  style={{ background: showCompare ? "#E6E9DC" : "#F1EADB", color: showCompare ? "#8C9574" : "#6B6459" }}
                  aria-label="他の人との比較表示を切り替える"
                >
                  {showCompare ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
              {showCompare && (
                <div className="mt-3 text-[11px] text-[#6B6459] bg-[#FAF6EE] rounded-[10px] px-3 py-2.5">
                  {memberStreaks.length === 0 ? (
                    "まだ比べられる記録がありません"
                  ) : (
                    <>
                      グループ平均 連続{" "}
                      <b className="text-[#34302A]">{(memberStreaks.reduce((sum, m) => sum + m.streak, 0) / memberStreaks.length).toFixed(1)}</b>
                      日／総記録日数平均{" "}
                      <b className="text-[#34302A]">{Math.round(memberStreaks.reduce((sum, m) => sum + (m.total ?? m.streak), 0) / memberStreaks.length)}</b>
                      日
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        <p className="text-center text-[10px] text-[#6B6459] flex items-center justify-center gap-1 mt-1">
          <Flame size={11} /> 花が咲かない日があっても、種はまけている
        </p>
      </div>

      {/* ---------- bottom tab bar ---------- */}
      <div className="fixed bottom-0 left-0 right-0 flex border-t" style={{ background: "#FFFFFF", borderColor: "#E4DBCB" }}>
        <div className="max-w-md mx-auto w-full flex">
          {[
            { key: "record", label: "きろく", emoji: "🌱" },
            { key: "calendar", label: "カレンダー", emoji: "🗓" },
            { key: "group", label: "みんな", emoji: "👥" },
          ].map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex-1 flex flex-col items-center gap-0.5 py-2.5"
                style={{ color: active ? "#B5651D" : "#9C9280" }}
              >
                <span className="text-[15px] leading-none">{tab.emoji}</span>
                <span className="text-[10px] leading-none" style={{ fontWeight: active ? 700 : 400 }}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="fixed left-1/2 bottom-20 -translate-x-1/2 px-5 py-3 rounded-full text-[12px] transition-all"
        style={{ background: "#34302A", color: "#FAF6EE", opacity: toast ? 1 : 0, transform: `translate(-50%, ${toast ? "0" : "10px"})`, pointerEvents: "none" }}
      >
        {toast}
      </div>
    </div>
  );
}

function Stat({ label, value, emoji, unit = "日" }) {
  return (
    <div className="flex-1">
      <div className="text-[10px] text-[#6B6459] mb-0.5">{label}</div>
      <div className="text-[13px] font-medium">
        {emoji && <span className="mr-1">{emoji}</span>}
        {value}
        <span className="text-[10.5px] text-[#6B6459] ml-0.5">{unit}</span>
      </div>
    </div>
  );
}

function TaskEditor({ task, onSave }) {
  const [draft, setDraft] = useState(task);
  return (
    <div className="space-y-2.5">
      <div>
        <label className="text-[10.5px] text-[#6B6459] block mb-1">続けたいこと</label>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="w-full text-[12px] px-3 py-2 rounded-[10px] border border-[#E4DBCB] bg-[#FAF6EE] outline-none"
        />
      </div>
      {Object.keys(RANK_META).map((rank) => (
        <div key={rank}>
          <label className="text-[10.5px] text-[#6B6459] block mb-1">
            {RANK_META[rank].emoji} {RANK_META[rank].label}の基準
          </label>
          <input
            value={draft.ranks[rank]}
            onChange={(e) => setDraft({ ...draft, ranks: { ...draft.ranks, [rank]: e.target.value } })}
            className="w-full text-[12px] px-3 py-2 rounded-[10px] border border-[#E4DBCB] bg-[#FAF6EE] outline-none"
          />
        </div>
      ))}
      <button onClick={() => onSave(draft)} className="w-full mt-1 py-2.5 rounded-[12px] text-[12px]" style={{ background: "#34302A", color: "#FAF6EE" }}>
        保存する
      </button>
    </div>
  );
}

function GrowthStem({ totalDone = 0, width = 56, height: svgHeight = 70 }) {
  const scale = svgHeight / 70;
  const cx = width / 2;
  const base = 65 * scale;
  const BASE_GAP = 6;
  const SEGMENT = 9;
  const TIP_CLEARANCE = 12;

  const monthPos = monthPositionFromTotal(totalDone);
  const completedBlooms = Math.floor(monthPos / 10);
  const cycleProgress = monthPos % 10;

  const tipStage = cycleProgress <= 0 ? 0 : cycleProgress === 1 ? 1 : cycleProgress === 2 ? 2 : cycleProgress <= 4 ? 3 : 4;
  const tipHasFirstLeaf = tipStage >= 1;
  const tipHasSecondLeaf = tipStage >= 2;
  const tipIsBud = tipStage >= 3;
  const tipR = tipIsBud ? (tipStage === 4 ? 5.5 : 4.5) : 3.5;
  const tipColor = tipIsBud ? "#D9A876" : "#C9BFA5";

  const mainHeight = (BASE_GAP + completedBlooms * SEGMENT + TIP_CLEARANCE + tipStage * 1.6) * scale;
  const tipY = base - mainHeight;

  return (
    <svg width={width} height={svgHeight} viewBox={`0 0 ${width} ${svgHeight}`} fill="none">
      <line x1={cx} y1={base} x2={cx} y2={tipY} stroke="#8C9574" strokeWidth={2.2 * scale} strokeLinecap="round" />

      {Array.from({ length: completedBlooms }).map((_, i) => {
        const branchY = base - (BASE_GAP + (i + 1) * SEGMENT) * scale;
        const side = i % 2 === 0 ? 1 : -1;
        const tipX = cx + side * 12 * scale;
        const branchTipY = branchY - 6 * scale;
        return (
          <g key={i}>
            <path
              d={`M${cx} ${branchY} Q ${cx + side * 8 * scale} ${branchY - 2 * scale}, ${tipX} ${branchTipY}`}
              stroke="#8C9574"
              strokeWidth={1.8 * scale}
              fill="none"
              strokeLinecap="round"
            />
            <text x={tipX} y={branchTipY} textAnchor="middle" dominantBaseline="central" fontSize={14 * scale} fill="#000000">
              🌸
            </text>
          </g>
        );
      })}

      {tipHasFirstLeaf && (
        <path
          d={`M${cx} ${tipY + 6 * scale} C ${cx - 5 * scale} ${tipY + 3 * scale}, ${cx - 8 * scale} ${tipY + 4 * scale}, ${cx - 9 * scale} ${tipY - 1 * scale}`}
          stroke="#8C9574"
          strokeWidth={1.8 * scale}
          fill="none"
          strokeLinecap="round"
        />
      )}
      {tipHasSecondLeaf && (
        <path
          d={`M${cx} ${tipY + 10 * scale} C ${cx + 6 * scale} ${tipY + 4 * scale}, ${cx + 9 * scale} ${tipY + 3 * scale}, ${cx + 10 * scale} ${tipY - 1 * scale}`}
          stroke="#8C9574"
          strokeWidth={1.8 * scale}
          fill="none"
          strokeLinecap="round"
        />
      )}
      <circle cx={cx} cy={tipY} r={tipR * scale} fill={tipColor} />
    </svg>
  );
}

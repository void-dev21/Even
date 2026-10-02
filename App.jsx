import React, { useState, useEffect, useMemo } from "react";
import {
  Plus,
  X,
  ArrowRight,
  Users,
  RefreshCw,
  ScrollText,
  Pencil,
  Check,
  Download,
  Search,
  Divide,
  AlertCircle,
  WifiOff,
  LogOut,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import AuthScreen from "./AuthScreen";

const FONT_DISPLAY = "'Fraunces', 'Iowan Old Style', Georgia, serif";
const FONT_MONO = "'IBM Plex Mono', 'SF Mono', Consolas, monospace";
const FONT_BODY = "'Fraunces', Georgia, serif";

const INK = "#20303A";
const PAPER = "#F6F1E4";
const PAPER_DIM = "#EEE6D2";
const BRASS = "#B4863A";
const AMBER = "#A9782E";
const OWES = "#A24632";
const OWED = "#3E6B4F";
const LINE = "#D8CDB0";
const MUTED = "#6E6355";

function fmtMoney(n) {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(n).toFixed(2);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function monthKey(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function csvEscape(s) {
  const str = String(s ?? "");
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function normalizeEntry(row) {
  return {
    id: row.id,
    from: row.from_name,
    to: row.to_name,
    amount: Number(row.amount),
    note: row.note || "",
    ts: new Date(row.ts).getTime(),
    addedByUid: row.added_by,
    addedBy: row.added_by_name || "",
    confirmed: !!row.confirmed,
    confirmedByUid: row.confirmed_by,
    confirmedBy: row.confirmed_by_name || "",
    editedAt: row.edited_at ? new Date(row.edited_at).getTime() : null,
  };
}

function normalizeMember(row) {
  return {
    name: row.name,
    userId: row.user_id,
    addedBy: row.added_by,
    addedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
    isGuest: !row.user_id,
  };
}

function simplifyDebts(nets) {
  const creditors = [];
  const debtors = [];
  Object.entries(nets).forEach(([name, amt]) => {
    const r = Math.round(amt * 100) / 100;
    if (r > 0.004) creditors.push({ name, amt: r });
    else if (r < -0.004) debtors.push({ name, amt: -r });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const result = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    result.push({ from: debtors[i].name, to: creditors[j].name, amount: Math.round(pay * 100) / 100 });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt < 0.005) i++;
    if (creditors[j].amt < 0.005) j++;
  }
  return result;
}

export default function EvenApp() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [members, setMembers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [newMember, setNewMember] = useState("");

  const [payer, setPayer] = useState("");
  const [ower, setOwer] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitPayer, setSplitPayer] = useState("");
  const [splitParticipants, setSplitParticipants] = useState([]);
  const [splitAmount, setSplitAmount] = useState("");
  const [splitNote, setSplitNote] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");

  const [search, setSearch] = useState("");
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [totalsOpen, setTotalsOpen] = useState(false);

  // ---------- auth session ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // First login after an email-confirm signup: create the member row we deferred.
  useEffect(() => {
    (async () => {
      if (!session) return;
      let pendingName = null;
      try {
        pendingName = sessionStorage.getItem("even-pending-name");
      } catch {
        /* ignore */
      }
      if (!pendingName) return;
      const { data: existing } = await supabase.from("members").select("name").eq("user_id", session.user.id).maybeSingle();
      if (!existing) {
        await supabase.from("members").insert({ name: pendingName, user_id: session.user.id, added_by: session.user.id });
      }
      try {
        sessionStorage.removeItem("even-pending-name");
      } catch {
        /* ignore */
      }
    })();
  }, [session]);

  const myMember = useMemo(() => (session ? members.find((m) => m.userId === session.user.id) : null), [members, session]);
  const myName = myMember?.name || "";

  // ---------- initial load ----------
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const [{ data: memberRows, error: mErr }, { data: entryRows, error: eErr }] = await Promise.all([
          supabase.from("members").select("*"),
          supabase.from("entries").select("*").order("ts", { ascending: false }),
        ]);
        if (mErr || eErr) throw mErr || eErr;
        setMembers((memberRows || []).map(normalizeMember));
        setEntries((entryRows || []).map(normalizeEntry));
      } catch (e) {
        setError("Couldn't reach the database: " + (e.message || "unknown error"));
      } finally {
        setLoaded(true);
      }
    })();
  }, [session]);

  // ---------- realtime sync ----------
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("even-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setMembers((prev) => (prev.some((m) => m.name === payload.new.name) ? prev : [...prev, normalizeMember(payload.new)]));
        } else if (payload.eventType === "DELETE") {
          setMembers((prev) => prev.filter((m) => m.name !== payload.old.name));
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setEntries((prev) => (prev.some((e) => e.id === payload.new.id) ? prev : [normalizeEntry(payload.new), ...prev]));
        } else if (payload.eventType === "UPDATE") {
          setEntries((prev) => prev.map((e) => (e.id === payload.new.id ? normalizeEntry(payload.new) : e)));
        } else if (payload.eventType === "DELETE") {
          setEntries((prev) => prev.filter((e) => e.id !== payload.old.id));
        }
      })
      .subscribe((status) => {
        setOffline(status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  const nets = useMemo(() => {
    const n = {};
    members.forEach((m) => (n[m.name] = 0));
    entries.forEach((e) => {
      n[e.to] = (n[e.to] || 0) + e.amount;
      n[e.from] = (n[e.from] || 0) - e.amount;
    });
    return n;
  }, [members, entries]);

  const settlements = useMemo(() => simplifyDebts(nets), [nets]);

  const monthlyTotals = useMemo(() => {
    const map = {};
    entries.forEach((e) => {
      const k = monthKey(e.ts);
      map[k] = (map[k] || 0) + e.amount;
    });
    return Object.entries(map);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    return entries.filter(
      (e) => e.from.toLowerCase().includes(q) || e.to.toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q)
    );
  }, [entries, search]);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  // ---------- members ----------
  const addMember = async () => {
    const name = newMember.trim();
    if (!name || members.some((m) => m.name === name) || !session) return;
    const record = { name, user_id: null, added_by: session.user.id, added_at: new Date().toISOString() };
    setMembers((prev) => [...prev, normalizeMember(record)]);
    setNewMember("");
    const { error: err } = await supabase.from("members").insert({ name, added_by: session.user.id });
    if (err) {
      setError("Couldn't add that guest: " + err.message);
      setMembers((prev) => prev.filter((m) => m.name !== name));
    }
  };

  const askRemoveMember = (member) => {
    const involved = entries.filter((e) => e.from === member.name || e.to === member.name).length;
    const isSelf = member.userId === session?.user.id;
    const canRemove = isSelf || (member.isGuest && member.addedBy === session?.user.id);
    setConfirmDialog({
      type: "member",
      key: member.name,
      canRemove,
      label: !canRemove
        ? `${member.name} has their own account, so only they can remove themselves.`
        : involved
        ? `Remove ${member.name}? This also deletes ${involved} ledger ${involved === 1 ? "entry" : "entries"} involving them.`
        : `Remove ${member.name} from the group?`,
    });
  };

  const confirmRemoveMember = async (name) => {
    const { error: err } = await supabase.from("members").delete().eq("name", name);
    if (err) {
      setError("Couldn't remove that member: " + err.message);
      return;
    }
    setMembers((prev) => prev.filter((m) => m.name !== name));
    setEntries((prev) => prev.filter((e) => e.from !== name && e.to !== name));
    if (payer === name) setPayer("");
    if (ower === name) setOwer("");
    setSplitParticipants((p) => p.filter((n) => n !== name));
    if (splitPayer === name) setSplitPayer("");
  };

  // ---------- entries ----------
  const buildRow = (from, to, amt, noteText) => ({
    from_name: from,
    to_name: to,
    amount: Math.round(amt * 100) / 100,
    note: noteText.trim(),
    ts: new Date().toISOString(),
    added_by: session.user.id,
    added_by_name: myName,
    confirmed: false,
  });

  const addEntry = async () => {
    if (!payer || !ower || payer === ower || !session) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    const row = buildRow(ower, payer, amt, note);
    const { data, error: err } = await supabase.from("entries").insert(row).select().single();
    if (err) {
      setError("Couldn't save that entry: " + err.message);
      return;
    }
    setEntries((prev) => [normalizeEntry(data), ...prev]);
    setAmount("");
    setNote("");
  };

  const addSplitEntries = async () => {
    if (!splitPayer || splitParticipants.length === 0 || !session) return;
    const amt = parseFloat(splitAmount);
    if (!amt || amt <= 0) return;
    const owers = splitParticipants.filter((n) => n !== splitPayer);
    if (owers.length === 0) return;
    const shareCount = splitParticipants.length;
    const rawShare = amt / shareCount;
    const share = Math.round(rawShare * 100) / 100;

    const rows = owers.map((name) => buildRow(name, splitPayer, share, splitNote));

    const shouldOwe = Math.round((amt - rawShare) * 100) / 100;
    const owedTotal = Math.round(share * owers.length * 100) / 100;
    const diff = Math.round((shouldOwe - owedTotal) * 100) / 100;
    if (rows.length && Math.abs(diff) >= 0.01) {
      rows[rows.length - 1].amount = Math.round((rows[rows.length - 1].amount + diff) * 100) / 100;
    }

    const { data, error: err } = await supabase.from("entries").insert(rows).select();
    if (err) {
      setError("Couldn't save the split: " + err.message);
      return;
    }
    setEntries((prev) => [...(data || []).map(normalizeEntry), ...prev]);
    setSplitAmount("");
    setSplitNote("");
    setSplitParticipants([]);
    setSplitPayer("");
    setSplitOpen(false);
  };

  const askRemoveEntry = (entry) => {
    const canRemove = entry.addedByUid === session?.user.id;
    setConfirmDialog({
      type: "entry",
      key: entry.id,
      canRemove,
      label: !canRemove
        ? `Only ${entry.addedBy || "whoever added this"} can remove this entry.`
        : `Remove the ${fmtMoney(entry.amount)} entry (${entry.from} → ${entry.to})?`,
    });
  };

  const confirmRemoveEntry = async (id) => {
    const { error: err } = await supabase.from("entries").delete().eq("id", id);
    if (err) {
      setError("Couldn't delete that entry: " + err.message);
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setEditAmount(String(entry.amount));
    setEditNote(entry.note || "");
  };

  const saveEdit = async (entry) => {
    const amt = parseFloat(editAmount);
    if (!amt || amt <= 0) return;
    const { data, error: err } = await supabase
      .from("entries")
      .update({ amount: Math.round(amt * 100) / 100, note: editNote.trim(), edited_at: new Date().toISOString() })
      .eq("id", entry.id)
      .select()
      .single();
    if (err) {
      setError("Couldn't save that edit: " + err.message);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? normalizeEntry(data) : e)));
    setEditingId(null);
  };

  const toggleConfirm = async (entry) => {
    const nowConfirmed = !entry.confirmed;
    const { data, error: err } = await supabase
      .from("entries")
      .update({
        confirmed: nowConfirmed,
        confirmed_by: nowConfirmed ? session.user.id : null,
        confirmed_by_name: nowConfirmed ? myName : "",
      })
      .eq("id", entry.id)
      .select()
      .single();
    if (err) {
      setError("Couldn't sync the confirmation: " + err.message);
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? normalizeEntry(data) : e)));
  };

  const exportCsv = () => {
    const header = ["From", "To", "Amount", "Note", "Date", "Added by", "Confirmed"];
    const rows = entries.map((e) => [
      e.from,
      e.to,
      e.amount.toFixed(2),
      e.note || "",
      new Date(e.ts).toISOString(),
      e.addedBy || "",
      e.confirmed ? "yes" : "no",
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "even-ledger.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const toggleSplitParticipant = (name) => {
    setSplitParticipants((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  if (session === undefined) {
    return (
      <div style={{ ...wrap, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: 15 }}>Loading…</div>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!loaded) {
    return (
      <div style={{ ...wrap, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ color: MUTED, fontFamily: FONT_BODY, fontSize: 15 }}>Opening the ledger…</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <style>{`
        .even-input {
          font-family: ${FONT_BODY};
          background: transparent;
          border: none;
          border-bottom: 1.5px solid ${LINE};
          padding: 8px 2px;
          font-size: 15px;
          color: ${INK};
          outline: none;
          transition: border-color 0.15s ease;
        }
        .even-input:focus { border-color: ${BRASS}; }
        .even-input::placeholder { color: #A69B87; }
        .even-select {
          font-family: ${FONT_BODY};
          background: ${PAPER};
          border: none;
          border-bottom: 1.5px solid ${LINE};
          padding: 8px 2px;
          font-size: 15px;
          color: ${INK};
          outline: none;
        }
        .even-btn {
          font-family: ${FONT_BODY};
          font-size: 14px;
          border: 1.5px solid ${INK};
          background: ${INK};
          color: ${PAPER};
          padding: 9px 16px;
          border-radius: 3px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: transform 0.1s ease, opacity 0.15s ease;
        }
        .even-btn:hover { opacity: 0.85; }
        .even-btn:active { transform: scale(0.98); }
        .even-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .even-btn-ghost {
          font-family: ${FONT_BODY};
          font-size: 13px;
          border: 1.5px solid ${LINE};
          background: transparent;
          color: ${INK};
          padding: 7px 13px;
          border-radius: 3px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .even-btn-ghost:hover { border-color: ${BRASS}; color: ${BRASS}; }
        .even-btn-danger {
          font-family: ${FONT_BODY};
          font-size: 14px;
          border: 1.5px solid ${OWES};
          background: ${OWES};
          color: ${PAPER};
          padding: 9px 16px;
          border-radius: 3px;
          cursor: pointer;
        }
        .even-btn-danger:disabled { opacity: 0.35; cursor: not-allowed; }
        .even-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1.5px solid ${LINE};
          padding: 5px 10px 5px 12px;
          border-radius: 20px;
          font-size: 14px;
          color: ${INK};
        }
        .even-x {
          background: none;
          border: none;
          cursor: pointer;
          color: ${MUTED};
          display: flex;
          padding: 2px;
        }
        .even-x:hover { color: ${OWES}; }
        .even-icon-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: ${MUTED};
          display: flex;
          padding: 3px;
        }
        .even-icon-btn:hover { color: ${BRASS}; }
        .even-row { border-top: 1px solid ${LINE}; padding: 14px 0; }
        .even-row:last-child { border-bottom: 1px solid ${LINE}; }
        .even-checkbox-row {
          display: flex;
          align-items: center;
          gap: 7px;
          font-family: ${FONT_BODY};
          font-size: 14px;
          color: ${INK};
          padding: 4px 0;
          cursor: pointer;
        }
      `}</style>

      <header style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 600,
              fontOpticalSizing: "auto",
              fontSize: 40,
              margin: 0,
              color: INK,
              letterSpacing: "-0.01em",
            }}
          >
            Even
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: MUTED, fontFamily: FONT_BODY, fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
              {offline && <WifiOff size={13} color={OWES} />}
              {offline ? "reconnecting…" : `signed in as ${myName || "…"}`}
            </span>
            <button className="even-btn-ghost" onClick={logout}>
              <LogOut size={13} /> Log out
            </button>
          </div>
        </div>
      </header>

      {error && <div style={{ marginBottom: 20, fontSize: 13, color: OWES, fontFamily: FONT_BODY }}>{error}</div>}

      <section style={{ marginBottom: 36 }}>
        <SectionLabel icon={<Users size={14} />} text="Who's in" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, marginBottom: 14 }}>
          {members.length === 0 && (
            <span style={{ color: MUTED, fontSize: 14, fontFamily: FONT_BODY, fontStyle: "italic" }}>
              You're the first one here — add a guest below, or invite friends to sign up.
            </span>
          )}
          {members.map((m) => (
            <span key={m.name} className="even-chip">
              {m.name}
              {m.isGuest && <span style={{ fontSize: 11, color: MUTED }}>guest</span>}
              <button className="even-x" onClick={() => askRemoveMember(m)} aria-label={`Remove ${m.name}`}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", maxWidth: 340, flexWrap: "wrap" }}>
          <input
            className="even-input"
            style={{ flex: 1, minWidth: 160 }}
            placeholder="Add a guest without an account"
            value={newMember}
            onChange={(e) => setNewMember(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
          />
          <button className="even-btn" onClick={addMember} disabled={!newMember.trim()}>
            <Plus size={14} /> Add
          </button>
        </div>
        <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT_BODY, marginTop: 8, fontStyle: "italic" }}>
          Friends with their own account show up automatically once they sign up.
        </div>
      </section>

      {members.length > 0 && (
        <section style={{ marginBottom: 36 }}>
          <SectionLabel icon={<ScrollText size={14} />} text="Where things stand" />
          <div style={{ marginTop: 8 }}>
            {members.map((m) => {
              const val = Math.round((nets[m.name] || 0) * 100) / 100;
              const color = val > 0.004 ? OWED : val < -0.004 ? OWES : MUTED;
              const label = val > 0.004 ? "is owed" : val < -0.004 ? "owes" : "is settled up";
              return (
                <div key={m.name} className="even-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: FONT_BODY, fontSize: 16, color: INK }}>
                    {m.name} <span style={{ color: MUTED, fontSize: 14 }}>{label}</span>
                  </span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 16, color, fontWeight: 500 }}>
                    {val === 0 ? "—" : fmtMoney(Math.abs(val))}
                  </span>
                </div>
              );
            })}
          </div>

          {settlements.length > 0 && (
            <div style={{ marginTop: 20, padding: "14px 16px", background: PAPER_DIM, borderRadius: 4 }}>
              <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT_BODY, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <RefreshCw size={12} /> Simplest way to settle up
              </div>
              {settlements.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: FONT_BODY, fontSize: 14, color: INK, padding: "3px 0" }}>
                  <span>{s.from}</span>
                  <ArrowRight size={13} color={MUTED} />
                  <span>{s.to}</span>
                  <span style={{ marginLeft: "auto", fontFamily: FONT_MONO, fontSize: 14 }}>{fmtMoney(s.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {members.length >= 2 && (
        <section style={{ marginBottom: 20 }}>
          <SectionLabel icon={<Plus size={14} />} text="Add to the tab" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", marginTop: 14 }}>
            <Field label="Who paid">
              <select className="even-select" value={payer} onChange={(e) => setPayer(e.target.value)}>
                <option value="">choose</option>
                {members.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Who owes them">
              <select className="even-select" value={ower} onChange={(e) => setOwer(e.target.value)}>
                <option value="">choose</option>
                {members
                  .filter((m) => m.name !== payer)
                  .map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Amount">
              <input
                className="even-input"
                style={{ width: 100 }}
                placeholder="0.00"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && addEntry()}
              />
            </Field>
            <Field label="For (optional)">
              <input
                className="even-input"
                style={{ width: 160 }}
                placeholder="dinner, gas, rent…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addEntry()}
              />
            </Field>
            <button className="even-btn" onClick={addEntry} disabled={!payer || !ower || payer === ower || !parseFloat(amount || "0")}>
              <Plus size={14} /> Add
            </button>
          </div>

          <button className="even-btn-ghost" style={{ marginTop: 14 }} onClick={() => setSplitOpen((v) => !v)}>
            <Divide size={13} /> {splitOpen ? "Close split" : "Split an expense between several people"}
          </button>

          {splitOpen && (
            <div style={{ marginTop: 16, padding: "16px 18px", background: PAPER_DIM, borderRadius: 4 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
                <Field label="Who paid">
                  <select className="even-select" value={splitPayer} onChange={(e) => setSplitPayer(e.target.value)}>
                    <option value="">choose</option>
                    {members.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Total amount">
                  <input
                    className="even-input"
                    style={{ width: 100 }}
                    placeholder="0.00"
                    inputMode="decimal"
                    value={splitAmount}
                    onChange={(e) => setSplitAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                </Field>
                <Field label="For (optional)">
                  <input
                    className="even-input"
                    style={{ width: 160 }}
                    placeholder="groceries, trip…"
                    value={splitNote}
                    onChange={(e) => setSplitNote(e.target.value)}
                  />
                </Field>
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 11, color: MUTED, fontFamily: FONT_BODY }}>Split between</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {members.map((m) => (
                    <label key={m.name} className="even-checkbox-row" style={{ marginRight: 16 }}>
                      <input type="checkbox" checked={splitParticipants.includes(m.name)} onChange={() => toggleSplitParticipant(m.name)} />
                      {m.name}
                    </label>
                  ))}
                </div>
              </div>

              {splitParticipants.length > 0 && parseFloat(splitAmount || "0") > 0 && (
                <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT_BODY, marginTop: 10 }}>
                  {fmtMoney(parseFloat(splitAmount) / splitParticipants.length)} per person ·{" "}
                  {Math.max(splitParticipants.length - (splitPayer ? 1 : 0), 0)} new{" "}
                  {splitParticipants.length - (splitPayer ? 1 : 0) === 1 ? "entry" : "entries"}
                </div>
              )}

              <button
                className="even-btn"
                style={{ marginTop: 14 }}
                onClick={addSplitEntries}
                disabled={!splitPayer || splitParticipants.length < 2 || !splitParticipants.includes(splitPayer) || !parseFloat(splitAmount || "0")}
              >
                <Divide size={14} /> Split it
              </button>
            </div>
          )}
        </section>
      )}

      {entries.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <button className="even-btn-ghost" onClick={() => setTotalsOpen((v) => !v)}>
            {totalsOpen ? "Hide" : "Show"} monthly totals
          </button>
          {totalsOpen && (
            <div style={{ marginTop: 12 }}>
              {monthlyTotals.map(([month, total]) => (
                <div key={month} style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT_BODY, fontSize: 14, color: INK, padding: "4px 0" }}>
                  <span>{month}</span>
                  <span style={{ fontFamily: FONT_MONO }}>{fmtMoney(total)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {entries.length > 0 && (
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <SectionLabel icon={<ScrollText size={14} />} text="The ledger" />
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ position: "relative" }}>
                <Search size={13} style={{ position: "absolute", left: 6, top: 10, color: MUTED }} />
                <input className="even-input" style={{ paddingLeft: 22, width: 140 }} placeholder="search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="even-btn-ghost" onClick={exportCsv}>
                <Download size={13} /> Export CSV
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            {filteredEntries.length === 0 && (
              <div style={{ padding: "16px 0", color: MUTED, fontFamily: FONT_BODY, fontSize: 14, fontStyle: "italic" }}>No entries match "{search}".</div>
            )}
            {filteredEntries.map((e) => {
              const isOwner = e.addedByUid === session.user.id;
              const canConfirm = !e.confirmed && myName && e.from === myName;
              const isEditing = editingId === e.id;
              return (
                <div key={e.id} className="even-row">
                  {isEditing ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: INK, minWidth: 140 }}>
                        <strong>{e.from}</strong> owes <strong>{e.to}</strong>
                      </div>
                      <Field label="Amount">
                        <input
                          className="even-input"
                          style={{ width: 90 }}
                          value={editAmount}
                          onChange={(ev) => setEditAmount(ev.target.value.replace(/[^0-9.]/g, ""))}
                          onKeyDown={(ev) => ev.key === "Enter" && saveEdit(e)}
                        />
                      </Field>
                      <Field label="Note">
                        <input className="even-input" style={{ width: 160 }} value={editNote} onChange={(ev) => setEditNote(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && saveEdit(e)} />
                      </Field>
                      <button className="even-btn-ghost" onClick={() => saveEdit(e)}>
                        <Check size={13} /> Save
                      </button>
                      <button className="even-x" onClick={() => setEditingId(null)}>
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, fontFamily: FONT_BODY, fontSize: 15, color: INK }}>
                        <strong>{e.from}</strong> owes <strong>{e.to}</strong>
                        {e.note ? <span style={{ color: MUTED }}> · {e.note}</span> : null}
                        <div style={{ fontSize: 12, color: MUTED, marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                          <span>{fmtDate(e.ts)}</span>
                          {e.addedBy && <span>· added by {e.addedBy}</span>}
                          {e.editedAt && <span>· edited</span>}
                          {!e.confirmed ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: AMBER }}>
                              <AlertCircle size={11} /> awaiting confirmation from {e.from}
                            </span>
                          ) : (
                            <span style={{ color: OWED }}>· confirmed{e.confirmedBy ? ` by ${e.confirmedBy}` : ""}</span>
                          )}
                        </div>
                      </div>
                      {canConfirm && (
                        <button className="even-btn-ghost" onClick={() => toggleConfirm(e)}>
                          <Check size={13} /> Confirm
                        </button>
                      )}
                      <span style={{ fontFamily: FONT_MONO, fontSize: 15, color: INK }}>{fmtMoney(e.amount)}</span>
                      {isOwner && (
                        <button className="even-icon-btn" onClick={() => startEdit(e)} aria-label="Edit entry">
                          <Pencil size={14} />
                        </button>
                      )}
                      <button className="even-x" onClick={() => askRemoveEntry(e)} aria-label="Remove entry">
                        <X size={15} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <footer style={{ marginTop: 48, fontSize: 12, color: MUTED, fontFamily: FONT_BODY, fontStyle: "italic" }}>
        Signed-in members only. Only the person who logs an entry can edit or delete it — only the person who owes it can confirm it.
      </footer>

      {confirmDialog && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(32,48,58,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
          onClick={() => setConfirmDialog(null)}
        >
          <div style={{ background: PAPER, borderRadius: 6, padding: "22px 24px", maxWidth: 360, boxShadow: "0 8px 30px rgba(0,0,0,0.25)" }} onClick={(ev) => ev.stopPropagation()}>
            <div style={{ fontFamily: FONT_BODY, fontSize: 15, color: INK, marginBottom: 18, lineHeight: 1.5 }}>{confirmDialog.label}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="even-btn-ghost" onClick={() => setConfirmDialog(null)}>
                {confirmDialog.canRemove ? "Cancel" : "Okay"}
              </button>
              {confirmDialog.canRemove && (
                <button
                  className="even-btn-danger"
                  onClick={async () => {
                    const { type, key } = confirmDialog;
                    setConfirmDialog(null);
                    if (type === "member") await confirmRemoveMember(key);
                    if (type === "entry") await confirmRemoveEntry(key);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ icon, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: BRASS, fontFamily: FONT_BODY, fontSize: 13, fontStyle: "italic" }}>
      {icon}
      {text}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: MUTED, fontFamily: FONT_BODY }}>{label}</label>
      {children}
    </div>
  );
}

const wrap = {
  maxWidth: 640,
  margin: "0 auto",
  padding: "40px 24px 60px",
  background: PAPER,
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
};

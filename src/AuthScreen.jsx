import React, { useState } from "react";
import { supabase } from "./supabaseClient";

const INK = "#20303A";
const PAPER = "#F6F1E4";
const BRASS = "#B4863A";
const OWES = "#A24632";
const LINE = "#D8CDB0";
const MUTED = "#6E6355";
const FONT_BODY = "'Fraunces', Georgia, serif";
const FONT_DISPLAY = "'Fraunces', 'Iowan Old Style', Georgia, serif";

export default function AuthScreen() {
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        const name = displayName.trim();
        if (!name) {
          setError("Pick a display name so your friends know who's who.");
          setBusy(false);
          return;
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;

        if (data.session && data.user) {
          // Email confirmation is off in this project, so we're already logged in —
          // create the member row right away.
          const { error: memberError } = await supabase.from("members").insert({
            name,
            user_id: data.user.id,
            added_by: data.user.id,
          });
          if (memberError) throw memberError;
        } else {
          // Email confirmation is required. Stash the chosen name so App.jsx can
          // create the member row the first time this person actually logs in.
          try {
            sessionStorage.setItem("even-pending-name", name);
          } catch {
            /* ignore */
          }
          setInfo("Check your email to confirm your account, then log in below.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: PAPER, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form onSubmit={submit} style={{ width: "100%", maxWidth: 340 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 36, color: INK, margin: 0, marginBottom: 6 }}>Even</h1>
        <p style={{ fontFamily: FONT_BODY, fontSize: 14, color: MUTED, marginTop: 0, marginBottom: 28, fontStyle: "italic" }}>
          a shared tab between friends
        </p>

        {mode === "signup" && (
          <FieldInput label="Your name" value={displayName} onChange={setDisplayName} placeholder="What your friends call you" />
        )}
        <FieldInput label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
        <FieldInput label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 6 characters" />

        {error && <div style={{ color: OWES, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {info && <div style={{ color: BRASS, fontFamily: FONT_BODY, fontSize: 13, marginBottom: 14 }}>{info}</div>}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            fontFamily: FONT_BODY,
            fontSize: 15,
            border: `1.5px solid ${INK}`,
            background: INK,
            color: PAPER,
            padding: "10px 16px",
            borderRadius: 3,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            marginBottom: 14,
          }}
        >
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signup" ? "login" : "signup");
            setError("");
            setInfo("");
          }}
          style={{
            width: "100%",
            background: "none",
            border: "none",
            fontFamily: FONT_BODY,
            fontSize: 13,
            color: MUTED,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

function FieldInput({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, color: MUTED, fontFamily: FONT_BODY, marginBottom: 4 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        style={{
          width: "100%",
          fontFamily: FONT_BODY,
          background: "transparent",
          border: "none",
          borderBottom: `1.5px solid ${LINE}`,
          padding: "8px 2px",
          fontSize: 15,
          color: INK,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

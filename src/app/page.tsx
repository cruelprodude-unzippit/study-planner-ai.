"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Camera,
  BookOpen,
  CheckCircle,
  XCircle,
  Sparkles,
  LogOut,
  ArrowLeft,
  Lock,
  FileText,
} from "lucide-react";

type Question = {
  question: string;
  options: string[];
  correct_index: number;
  exact_source_quote: string;
};

type StudyDeck = {
  id: string;
  topic_title: string;
  clean_notes: string[];
  questions: Question[];
  created_at: string;
};

type Profile = {
  id: string;
  email: string | null;
  scans_used: number;
  is_pro: boolean;
  streak_days: number;
};

export default function HomePage() {
  const supabase = useMemo(() => {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key"
    );
  }, []);

  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [decks, setDecks] = useState<StudyDeck[]>([]);
  const [activeDeck, setActiveDeck] = useState<StudyDeck | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);

  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [loggedMistakes, setLoggedMistakes] = useState<Record<number, string>>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      setSessionToken(session?.access_token ?? null);
      setUserId(session?.user?.id ?? null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionToken(session?.access_token ?? null);
      setUserId(session?.user?.id ?? null);
      setAuthLoading(false);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    loadUserData(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadUserData(uid: string) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .single();

    if (prof) {
      setProfile(prof as Profile);
    }

    const { data: deckRows } = await supabase
      .from("study_decks")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (deckRows) {
      setDecks(deckRows as StudyDeck[]);
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setAuthMessage(error.message);
      } else if (data.user && !data.session) {
        setAuthMessage("Account created! Check your email inbox to confirm, then sign in.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthMessage(error.message);
      }
    }
    setAuthBusy(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setDecks([]);
    setActiveDeck(null);
  }

  function compressImage(file: File): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxDim = 1280;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Could not process image"));
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          resolve({ base64: dataUrl, mimeType: "image/jpeg" });
        };
        img.onerror = () => reject(new Error("Invalid image file"));
        img.src = ev.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !sessionToken) return;

    setScanError("");
    setShowPaywall(false);
    setScanning(true);

    try {
      const { base64, mimeType } = await compressImage(file);

      const res = await fetch("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });

      const data = await res.json();

      if (res.status === 402 || data.error === "PAYWALL_LIMIT") {
        setShowPaywall(true);
        setScanning(false);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to scan image");
      }

      const newDeck = data.deck as StudyDeck;
      setDecks((prev) => [newDeck, ...prev]);
      setProfile((prev) =>
        prev ? { ...prev, scans_used: data.scans_used ?? prev.scans_used + 1 } : prev
      );
      openDeck(newDeck);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Scan failed. Try again.");
    } finally {
      setScanning(false);
      e.target.value = "";
    }
  }

  function openDeck(deck: StudyDeck) {
    setSelectedAnswers({});
    setLoggedMistakes({});
    setActiveDeck(deck);
  }

  async function handleLogMistake(
    qIndex: number,
    question: Question,
    errorType: "Forgot Term" | "Mixed Concepts" | "Misread Question"
  ) {
    if (!userId || !activeDeck) return;
    setLoggedMistakes((prev) => ({ ...prev, [qIndex]: errorType }));

    await supabase.from("mistake_logs").insert({
      user_id: userId,
      deck_id: activeDeck.id,
      question_text: question.question,
      exact_quote: question.exact_source_quote,
      error_type: errorType,
    });
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-400">Loading Study Planner AI...</p>
      </div>
    );
  }

  if (!sessionToken || !userId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10">
        <div className="rounded-2xl border border-white/10 bg-[#2D2D2D] p-6 shadow-xl">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#92A9E1]/20 text-[#92A9E1]">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Study Planner AI</h1>
              <p className="text-xs text-gray-400">Turn textbook pages into notes & quizzes</p>
            </div>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-white/10 bg-[#222222] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#92A9E1]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-300">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full rounded-xl border border-white/10 bg-[#222222] px-3.5 py-2.5 text-sm text-white outline-none focus:border-[#92A9E1]"
              />
            </div>

            {authMessage && (
              <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-300">
                {authMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={authBusy}
              className="w-full rounded-xl bg-[#92A9E1] py-3 text-sm font-semibold text-[#181818] transition active:scale-[0.99] disabled:opacity-50"
            >
              {authBusy ? "Please wait..." : isSignUp ? "Create Free Account" : "Sign In"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setAuthMessage("");
            }}
            className="mt-4 w-full text-center text-xs text-gray-400 hover:text-white"
          >
            {isSignUp
              ? "Already have an account? Sign In"
              : "New here? Create a Free Account"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 pb-16 pt-5">
      {/* Top Bar */}
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-[#92A9E1]" />
          <span className="font-bold text-white">Study Planner AI</span>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="rounded-full border border-white/10 bg-[#2D2D2D] px-3 py-1 text-xs font-medium text-[#92A9E1]">
            {profile?.is_pro
              ? "Pro Unlimited"
              : `${profile?.scans_used ?? 0}/2 Free Scans`}
          </span>

          <button
            onClick={handleSignOut}
            title="Sign out"
            className="rounded-lg border border-white/10 bg-[#2D2D2D] p-2 text-gray-400 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Active Study Deck View */}
      {activeDeck ? (
        <div className="space-y-6">
          <button
            onClick={() => setActiveDeck(null)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#92A9E1]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Decks
          </button>

          <div>
            <h1 className="text-2xl font-bold text-white">{activeDeck.topic_title}</h1>
            <p className="mt-1 text-xs text-gray-400">
              {new Date(activeDeck.created_at).toLocaleDateString()}
            </p>
          </div>

          {/* Study Notes */}
          <section className="rounded-2xl border border-white/10 bg-[#2D2D2D] p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#92A9E1]">
              <FileText className="h-4 w-4" />
              <span>Key Study Notes</span>
            </div>
            <ul className="space-y-2.5 text-sm leading-relaxed text-gray-200">
              {activeDeck.clean_notes?.map((note, idx) => (
                <li key={idx} className="flex gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#92A9E1]" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Interactive Quiz */}
          <section className="space-y-4">
            <h2 className="text-base font-bold text-white">Practice Quiz</h2>

            {activeDeck.questions?.map((q, qIdx) => {
              const picked = selectedAnswers[qIdx];
              const hasAnswered = picked !== undefined;
              const isCorrect = picked === q.correct_index;

              return (
                <div
                  key={qIdx}
                  className="rounded-2xl border border-white/10 bg-[#2D2D2D] p-5"
                >
                  <p className="mb-3.5 text-sm font-semibold text-white">
                    {qIdx + 1}. {q.question}
                  </p>

                  <div className="space-y-2">
                    {q.options?.map((opt, optIdx) => {
                      let style =
                        "border-white/10 bg-[#222222] text-gray-200 hover:border-white/25";

                      if (hasAnswered) {
                        if (optIdx === q.correct_index) {
                          style = "border-emerald-500/60 bg-emerald-500/15 text-emerald-200";
                        } else if (optIdx === picked) {
                          style = "border-rose-500/60 bg-rose-500/15 text-rose-200";
                        } else {
                          style = "border-white/5 bg-[#222222]/60 text-gray-500";
                        }
                      }

                      return (
                        <button
                          key={optIdx}
                          disabled={hasAnswered}
                          onClick={() =>
                            setSelectedAnswers((prev) => ({ ...prev, [qIdx]: optIdx }))
                          }
                          className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm transition ${style}`}
                        >
                          <span>{opt}</span>
                          {hasAnswered && optIdx === q.correct_index && (
                            <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                          )}
                          {hasAnswered &&
                            optIdx === picked &&
                            optIdx !== q.correct_index && (
                              <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
                            )}
                        </button>
                      );
                    })}
                  </div>

                  {hasAnswered && (
                    <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
                      <div className="rounded-xl bg-[#222222] p-3 text-xs text-gray-300">
                        <span className="font-semibold text-[#92A9E1]">
                          Textbook Proof:{" "}
                        </span>
                        &ldquo;{q.exact_source_quote}&rdquo;
                      </div>

                      {!isCorrect && (
                        <div>
                          <p className="mb-1.5 text-xs text-gray-400">
                            Log why you missed this:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                "Forgot Term",
                                "Mixed Concepts",
                                "Misread Question",
                              ] as const
                            ).map((tag) => {
                              const selectedTag = loggedMistakes[qIdx] === tag;
                              return (
                                <button
                                  key={tag}
                                  onClick={() => handleLogMistake(qIdx, q, tag)}
                                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                                    selectedTag
                                      ? "border-[#92A9E1] bg-[#92A9E1]/20 text-[#92A9E1]"
                                      : "border-white/10 bg-[#222222] text-gray-300"
                                  }`}
                                >
                                  {selectedTag ? `Saved: ${tag}` : tag}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      ) : (
        /* Dashboard View */
        <div className="space-y-6">
          {/* Scanner Card */}
          <div className="rounded-2xl border border-white/10 bg-[#2D2D2D] p-6 text-center shadow-lg">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#92A9E1]/15 text-[#92A9E1]">
              <Sparkles className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold text-white">Scan a Textbook Page</h1>
            <p className="mx-auto mt-1 max-w-xs text-xs text-gray-400">
              Take a photo or upload a page to instantly generate 5 key notes and a
              fact-checked quiz.
            </p>

            <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#92A9E1] px-5 py-3.5 text-sm font-semibold text-[#181818] transition active:scale-[0.99]">
              <Camera className="h-4 w-4" />
              <span>{scanning ? "Scanning with AI..." : "Take Photo / Upload Page"}</span>
              <input
                type="file"
                accept="image/*"
                disabled={scanning}
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            {scanError && (
              <p className="mt-3 rounded-xl bg-rose-500/15 p-2.5 text-xs text-rose-300">
                {scanError}
              </p>
            )}

            {showPaywall && (
              <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-left">
                <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
                  <Lock className="h-4 w-4" />
                  <span>Free Scan Limit Reached (2/2)</span>
                </div>
                <p className="mt-1 text-xs text-amber-200/80">
                  You have used your 2 free textbook scans. Upgrade to Pro for unlimited
                  scans and quizzes.
                </p>
              </div>
            )}
          </div>

          {/* Saved Decks */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-gray-300">
              Your Study Decks ({decks.length})
            </h2>

            {decks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-gray-500">
                No study decks yet. Scan your first textbook page above!
              </div>
            ) : (
              <div className="space-y-2.5">
                {decks.map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => openDeck(deck)}
                    className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-[#2D2D2D] p-4 text-left transition hover:border-[#92A9E1]/50"
                  >
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {deck.topic_title}
                      </h3>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {deck.clean_notes?.length || 0} notes •{" "}
                        {deck.questions?.length || 0} quiz questions
                      </p>
                    </div>
                    <span className="text-xs font-medium text-[#92A9E1]">Study →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

"use client";

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [decks, setDecks] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<"dashboard" | "decks" | "analytics">("dashboard");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser(data.user);
        fetchDecks(data.user.id);
      }
    });
  }, []);

  const fetchDecks = async (userId: string) => {
    const { data } = await supabase
      .from("study_decks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (data) setDecks(data);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert("Account created! Check your email or log in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.reload();
      }
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScanUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setErrorMsg("");
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;

        const res = await fetch("/api/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Scan failed");

        setDecks([data.deck, ...decks]);
        setActiveTab("decks");
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setScanning(false);
    }
  };

  if (!user) {
    return (
      <main className="min-h-screen bg-[#2D2D2D] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#242424] border border-[#3A3A3A] p-8 rounded-2xl shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-[#92A9E1]/20 flex items-center justify-center text-[#92A9E1] font-bold text-xl">⚡</div>
            <div>
              <h1 className="text-xl font-bold tracking-wide">Study Planner AI</h1>
              <p className="text-xs text-gray-400">Next-Gen Academic Engine</p>
            </div>
          </div>

          {errorMsg && <div className="mb-4 p-3 bg-red-950/50 border border-red-800 text-red-200 text-xs rounded-lg">{errorMsg}</div>}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#1D1D1D] border border-[#3A3A3A] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#92A9E1]"
                placeholder="name@example.com"
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1D1D1D] border border-[#3A3A3A] rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#92A9E1]"
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#92A9E1] hover:bg-[#7D94CC] text-[#1D1D1D] font-semibold py-3 rounded-xl transition shadow-lg text-sm"
            >
              {loading ? "Processing..." : isSignUp ? "Create Free Account" : "Sign In to Dashboard"}
            </button>
          </form>

          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full mt-4 text-xs text-gray-400 hover:text-[#92A9E1] transition text-center"
          >
            {isSignUp ? "Already have an account? Sign In" : "New here? Create an account"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#2D2D2D] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#242424] border-r border-[#3A3A3A] p-6 hidden md:flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <div className="w-9 h-9 rounded-xl bg-[#92A9E1]/20 flex items-center justify-center text-[#92A9E1] font-bold">⚡</div>
            <span className="font-bold tracking-tight text-sm">StudyPlanner AI</span>
          </div>

          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === "dashboard" ? "bg-[#92A9E1] text-[#1D1D1D]" : "text-gray-400 hover:bg-[#333] hover:text-white"}`}
            >
              🚀 Scan & Generate
            </button>
            <button
              onClick={() => setActiveTab("decks")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === "decks" ? "bg-[#92A9E1] text-[#1D1D1D]" : "text-gray-400 hover:bg-[#333] hover:text-white"}`}
            >
              📚 Study Decks ({decks.length})
            </button>
            <button
              onClick={() => setActiveTab("analytics")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${activeTab === "analytics" ? "bg-[#92A9E1] text-[#1D1D1D]" : "text-gray-400 hover:bg-[#333] hover:text-white"}`}
            >
              📊 Analytics & Usage
            </button>
          </nav>
        </div>

        <div className="pt-4 border-t border-[#3A3A3A]">
          <div className="text-xs text-gray-400 truncate mb-2">{user.email}</div>
          <button
            onClick={() => supabase.auth.signOut().then(() => window.location.reload())}
            className="w-full text-left text-xs text-red-400 hover:text-red-300 py-1"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 border-b border-[#3A3A3A] bg-[#242424]/50 backdrop-blur px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold capitalize text-[#92A9E1]">{activeTab} Workspace</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-3 py-1 bg-[#3A3A3A] rounded-full text-gray-300">Free Tier Active</span>
          </div>
        </header>

        {/* Tab Content */}
        <div className="p-8 flex-1 overflow-y-auto">
          {errorMsg && <div className="mb-6 p-4 bg-red-950/50 border border-red-800 text-red-200 text-sm rounded-xl">{errorMsg}</div>}

          {activeTab === "dashboard" && (
            <div className="max-w-2xl mx-auto space-y-8">
              <div className="text-center space-y-2">
                <h1 className="text-3xl font-extrabold tracking-tight">Scan Any Textbook Page</h1>
                <p className="text-gray-400 text-sm">Instantly extract 5 precision study notes and fact-checked quiz questions.</p>
              </div>

              <div className="bg-[#242424] border border-[#3A3A3A] rounded-2xl p-8 text-center shadow-xl space-y-6">
                <div className="w-16 h-16 bg-[#92A9E1]/10 rounded-2xl mx-auto flex items-center justify-center text-[#92A9E1] text-2xl">📸</div>
                <div>
                  <h3 className="font-bold text-lg">Upload Chapter or Page</h3>
                  <p className="text-xs text-gray-400 mt-1">Supports PNG, JPG, or direct camera snaps</p>
                </div>

                <label className="inline-block cursor-pointer bg-[#92A9E1] hover:bg-[#7D94CC] text-[#1D1D1D] font-bold px-8 py-3 rounded-xl transition shadow-lg text-sm">
                  {scanning ? "AI Extracting Notes..." : "Select Textbook Image"}
                  <input type="file" accept="image/*" onChange={handleScanUpload} className="hidden" disabled={scanning} />
                </label>
              </div>
            </div>
          )}

          {activeTab === "decks" && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold">Your Saved Study Decks</h2>
              {decks.length === 0 ? (
                <div className="text-center py-20 text-gray-500 border border-dashed border-[#3A3A3A] rounded-2xl">
                  No decks generated yet. Head to Scan & Generate to start!
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {decks.map((deck) => (
                    <div key={deck.id} className="bg-[#242424] border border-[#3A3A3A] rounded-2xl p-6 space-y-4 shadow-lg">
                      <div className="flex justify-between items-start">
                        <h3 className="font-bold text-lg text-[#92A9E1]">{deck.topic_title}</h3>
                        <span className="text-[10px] text-gray-400">{new Date(deck.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Key Notes</h4>
                        <ul className="list-disc list-inside text-sm space-y-1 text-gray-300">
                          {deck.clean_notes?.map((note: string, idx: number) => (
                            <li key={idx} className="truncate">{note}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "analytics" && (
            <div className="max-w-xl space-y-6">
              <h2 className="text-xl font-bold">Usage & Performance</h2>
              <div className="bg-[#242424] border border-[#3A3A3A] rounded-2xl p-6 space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Total Scans Generated</span>
                  <span className="font-bold">{decks.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">API Latency Speed</span>
                  <span className="font-bold text-green-400">~2.4s (Optimized)</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">AI Engine</span>
                  <span className="font-bold text-[#92A9E1]">Gemini 3.8 Flash</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

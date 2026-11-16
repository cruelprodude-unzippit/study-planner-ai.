import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

export const maxDuration = 26;

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.8-flash-lite",
  "gemini-3.0-flash",
];

async function generateWithFallback(
  ai: GoogleGenAI,
  cleanBase64: string,
  mimeType: string,
  prompt: string
) {
  let lastError: unknown = null;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: mimeType || "image/jpeg",
              },
            },
            prompt,
          ],
          config: {
            responseMimeType: "application/json",
          },
        });

        if (res.text) {
          return res.text;
        }
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient =
          msg.includes("503") ||
          msg.includes("429") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("high demand") ||
          msg.includes("RESOURCE_EXHAUSTED");

        if (isTransient && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error("AI servers are busy. Please try again in a moment.");
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "").trim();

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    let { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profile) {
      const { data: newProfile, error: insertProfileErr } = await supabaseAdmin
        .from("profiles")
        .insert({ id: user.id, email: user.email })
        .select("*")
        .single();

      if (insertProfileErr || !newProfile) {
        return NextResponse.json(
          { error: "Could not load user profile" },
          { status: 500 }
        );
      }
      profile = newProfile;
    }

    if (profile.scans_used >= 2 && !profile.is_pro) {
      return NextResponse.json({ error: "PAYWALL_LIMIT" }, { status: 402 });
    }

    const body = await req.json();
    const { imageBase64, mimeType } = body;

    if (!imageBase64) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      );
    }

    const cleanBase64 = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const prompt =
      "Read ONLY the visible textbook text in this image. Return compact JSON with: `topic_title` (short string), `clean_notes` (array of 5 short bullet strings), and `questions` (array of 5 MCQs, each with `question` string, `options` array of 4 short strings, `correct_index` number 0-3, and `exact_source_quote` short verbatim quote from the image).";

    const rawText = await generateWithFallback(
      ai,
      cleanBase64,
      mimeType,
      prompt
    );

    const cleanedJson = rawText
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanedJson);
    } catch {
      return NextResponse.json(
        { error: "Could not read textbook text clearly. Try a sharper photo." },
        { status: 422 }
      );
    }

    const { data: savedDeck, error: deckError } = await supabaseAdmin
      .from("study_decks")
      .insert({
        user_id: user.id,
        topic_title: parsed.topic_title || "Untitled Study Note",
        clean_notes: parsed.clean_notes || [],
        questions: parsed.questions || [],
      })
      .select("*")
      .single();

    if (deckError || !savedDeck) {
      return NextResponse.json(
        { error: "Failed to save study deck" },
        { status: 500 }
      );
    }

    const updatedScans = (profile.scans_used || 0) + 1;

    await supabaseAdmin
      .from("profiles")
      .update({ scans_used: updatedScans })
      .eq("id", user.id);

    return NextResponse.json({
      deck: savedDeck,
      scans_used: updatedScans,
    });
  } catch (err: unknown) {
    const rawMsg =
      err instanceof Error ? err.message : "Something went wrong scanning";
    const friendlyMsg =
      rawMsg.includes("503") || rawMsg.includes("UNAVAILABLE")
        ? "Google AI is temporarily busy. Please tap Scan again in a few seconds."
        : rawMsg;
    return NextResponse.json({ error: friendlyMsg }, { status: 500 });
  }
}

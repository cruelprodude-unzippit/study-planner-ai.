import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

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
      "Analyze ONLY the visible text in this textbook image. Return valid JSON with: `topic_title` (string), `clean_notes` (array of 5 concise bullet strings), and `questions` (array of 5 objects, each with `question` string, `options` array of 4 strings, `correct_index` number 0-3, and `exact_source_quote` copied word-for-word from the image proving the answer).";

    const aiResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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

    const rawText = aiResponse.text || "";
    const cleanedJson = rawText
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedJson);

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
    const message =
      err instanceof Error ? err.message : "Something went wrong scanning";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

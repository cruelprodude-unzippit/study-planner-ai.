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
      "Extract key points from this textbook page. Return compact JSON: {\"topic_title\":\"short title\",\"clean_notes\":[\"note 1\",\"note 2\",\"note 3\",\"note 4\",\"note 5\"],\"questions\":[{\"question\":\"q\",\"options\":[\"a\",\"b\",\"c\",\"d\"],\"correct_index\":0,\"exact_source_quote\":\"short verbatim quote\"}]} (5 notes, 5 MCQs, keep every string under 12 words).";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8200);

    let aiResponse;
    try {
      aiResponse = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite",
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
          maxOutputTokens: 900,
          temperature: 0.2,
          abortSignal: controller.signal,
        },
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const rawText = aiResponse.text || "";
    const cleanedJson = rawText
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanedJson);
    } catch {
      return NextResponse.json(
        { error: "Could not read text clearly. Upload a clearer or cropped photo." },
        { status: 422 }
      );
    }

    const { data: savedDeck, error: deckError } = await supabaseAdmin
      .from("study_decks")
      .insert({
        user_id: user.id,
        topic_title: parsed.topic_title || "Study Notes",
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
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("AbortError")) {
      return NextResponse.json(
        { error: "Image took too long. Crop closer to the text and try again." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Scan failed: " + msg.slice(0, 120) },
      { status: 500 }
    );
  }
}

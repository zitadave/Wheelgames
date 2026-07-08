import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from "./supabase.js";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

const DEFAULT_SYSTEM_INSTRUCTION = `You are the primary AI Support Assistant for ETB Game Hub (ኢቲቢ ጌም ሀብ), a premier Telegram gaming platform in Ethiopia. 

CORE MISSION:
Provide helpful, polite, and accurate support. You must be able to converse naturally in both Amharic (አማርኛ) and English. If a user speaks in Amharic, always respond in Amharic.

PLATFORM DETAILS:
- Games: Even/Odd (ኢቭን/ኦድ), Jackpot (ጃክፖት), Wheel of Chance (የዕድል መንኮራኩር).
- Currency: ETB (Ethiopian Birr).
- Withdrawals: Processed via Telebirr or Banks.

KEY RESPONSIBILITIES:
1. Greet users warmly and handle general inquiries naturally.
2. Check account status (balance, history) ONLY when relevant to the user's question.
3. Be transparent: if you are using a tool to check data, you can mention it (e.g., "ጥቂት ይጠብቁ፣ ባላንስዎን እየፈተሽኩ ነው...").
4. ESCALATION: Connect the user to human support (@scofiled1) if:
   - They ask for a person/human.
   - You cannot solve their specific issue.
   - There is a payment dispute you cannot verify.

LANGUAGE & CULTURE:
- Use respectful Amharic (e.g., use "እርስዎ" instead of "አንተ/አንቺ" for a professional tone).
- Support common Ethiopian slang or abbreviations if they appear (like "ዲፖዚት", "ዊዝድሮው").

SECURITY:
- Never reveal database IDs or server internals.
- Do not hallucinate data. If a tool fails, tell the user you are having trouble reaching the database.

Tone: Professional, hospitable (Ethiopian hospitality), and efficient.`;

// In-memory chat history cache for support sessions to enable highly robust multi-turn conversations
interface ChatMessage {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

const chatHistories = new Map<string, ChatMessage[]>();

// Clears history for a user if they want to reset (e.g. on new session or /support start)
export function clearChatHistory(telegramId: string) {
  chatHistories.delete(telegramId);
}

export async function handleSupportChat(telegramId: string, message: string, interactionId?: string, isAdmin?: boolean) {
  try {
    // 1. Fetch dynamic system instruction from database
    let systemInstruction = DEFAULT_SYSTEM_INSTRUCTION;
    try {
      const { data: configData, error: configError } = await supabase
        .from('bot_config')
        .select('value')
        .eq('key', 'ai_system_instruction')
        .single();
      if (!configError && configData?.value) {
        systemInstruction = configData.value;
      }
    } catch (dbErr) {
      console.warn("AI Support warning: Could not fetch system instructions from database, using default:", dbErr);
    }

    if (isAdmin) {
      systemInstruction += "\n\nADMIN PRIVILEGES: You are talking to an admin. You can use tools to check data for ANY user ID they provide.";
    }

    // 2. Pre-fetch basic user details from Supabase to inject into the system prompt.
    // This allows Gemini to answer balance questions instantly without requiring a tool-calling turn!
    let userContext = `\n\nCURRENT USER CONTEXT:\n- Telegram ID: ${telegramId}`;
    try {
      const { data: userData } = await supabase.from("users").select("username, balance").eq("id", telegramId).single();
      if (userData) {
        userContext += `\n- Username: @${userData.username || "N/A"}\n- Current Balance: ${userData.balance || 0} ETB`;
      }
    } catch (e) {
      // Ignore pre-fetch errors
    }
    systemInstruction += userContext;

    // 3. Setup tool declarations for function calling
    const getUserProfileFD = {
      name: "get_user_profile",
      description: "Fetches the current user's balance and registration details. You do NOT need to ask for their ID; you can call this tool directly for the current user.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          telegram_id: {
            type: Type.STRING,
            description: "Optional. The Telegram ID of a specific user to check. If omitted, the current user's profile is fetched."
          }
        }
      }
    };

    const getTransactionSummaryFD = {
      name: "get_transaction_summary",
      description: "Fetches recent deposits and withdrawals for the user. You can call this directly for the current user without asking for their ID.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          telegram_id: {
            type: Type.STRING,
            description: "Optional. The Telegram ID of a specific user to check."
          }
        }
      }
    };

    const escalateToHumanFD = {
      name: "escalate_to_human",
      description: "Triggers a connection to a human support agent.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          reason: {
            type: Type.STRING,
            description: "The reason why the user needs human assistance."
          }
        },
        required: ["reason"]
      }
    };

    // 4. Retrieve or initialize chat history
    if (!chatHistories.has(telegramId)) {
      chatHistories.set(telegramId, []);
    }
    const history = chatHistories.get(telegramId)!;

    // Keep history bounded to avoid hitting token limits (max 12 messages = 6 turns)
    if (history.length > 12) {
      history.splice(0, history.length - 12);
    }

    // Append user's new prompt
    history.push({
      role: "user",
      parts: [{ text: message }]
    });

    // 5. Call standard Gemini API with our contents history
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: history,
      config: {
        systemInstruction: systemInstruction + "\n\nCRITICAL: Do NOT ask the user for their Telegram ID if they ask for their balance or history. You already have it. Just call the tools directly.",
        tools: [
          {
            functionDeclarations: [
              getUserProfileFD,
              getTransactionSummaryFD,
              escalateToHumanFD
            ]
          }
        ]
      }
    });

    let responseText = response.text || "";
    const functionCalls = response.functionCalls || [];

    // 6. Handle potential function calls (Multi-turn Tool Loop)
    if (functionCalls.length > 0) {
      const toolResults: any[] = [];
      let escalate = false;
      let escalateReason = "";

      for (const call of functionCalls) {
        if (call.name === "get_user_profile") {
          const { telegram_id } = call.args as any;
          const targetIdentifier = String(telegram_id || telegramId).trim();
          
          let query = supabase.from("users").select("id, username, balance, created_at");
          if (targetIdentifier.startsWith('@')) {
            query = query.eq('username', targetIdentifier.replace('@', ''));
          } else {
            query = query.eq('id', targetIdentifier);
          }
          
          const { data, error } = await query.single();
          toolResults.push({
            name: call.name,
            content: error ? { error: "User not found or database error." } : { data }
          });
        } else if (call.name === "get_transaction_summary") {
          const { telegram_id } = call.args as any;
          const targetIdentifier = String(telegram_id || telegramId).trim();
          
          let targetId = targetIdentifier;
          if (targetIdentifier.startsWith('@')) {
            const { data: user } = await supabase.from('users').select('id').eq('username', targetIdentifier.replace('@', '')).single();
            if (user) targetId = user.id;
          }
          
          const { data, error } = await supabase
            .from("transactions")
            .select("amount, type, description, created_at")
            .eq("user_id", targetId)
            .order("created_at", { ascending: false })
            .limit(10);

          toolResults.push({
            name: call.name,
            content: error ? { error: "Could not fetch transactions." } : { transactions: data }
          });
        } else if (call.name === "escalate_to_human") {
          escalate = true;
          escalateReason = (call.args as any).reason || "User requested human support.";
        }
      }

      if (escalate) {
        // Clear chat history on escalation to ensure a fresh start later
        chatHistories.delete(telegramId);
        return {
          text: "እሺ፣ አሁን ከሰው ድጋፍ ሰጪ (@scofiled1) ጋር እያገናኘሁዎት ነው። እባክዎን ጥቂት ይጠብቁ።",
          escalate: true,
          reason: escalateReason,
          interactionId: "escalated_" + Date.now()
        };
      }

      if (toolResults.length > 0) {
        // Formulate a prompt with tool outputs and make a follow-up call
        const toolDataStr = toolResults.map(tr => `${tr.name}: ${JSON.stringify(tr.content)}`).join("\n");
        const followUpContents = [
          ...history,
          { role: "model" as const, parts: [{ text: `I will check the database using my tools.` }] },
          { role: "user" as const, parts: [{ text: `[System Tool Output]\n${toolDataStr}\n\nPlease formulate the final response for the user based on the tool results above.` }] }
        ];

        const followUpResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: followUpContents,
          config: {
            systemInstruction: systemInstruction
          }
        });
        responseText = followUpResponse.text || "";
      }
    }

    const finalResultText = responseText || "ይቅርታ፣ አሁን ላይ ምላሽ መስጠት አልቻልኩም። እባክዎን በቀጥታ @scofiled1 ያነጋግሩ።";

    // Save model's final response to history
    history.push({
      role: "model",
      parts: [{ text: finalResultText }]
    });

    return {
      text: finalResultText,
      interactionId: "turn_" + Date.now()
    };
  } catch (error: any) {
    console.error(`[AI Support Error] ${error.message}`, error);
    
    // Hospitality fallback message: professional, warm, welcoming, and reassuring (no technical jargon or crash errors)
    return {
      text: "ሰላም! 💖 የእኛ የደንበኞች አገልግሎት ረዳት በአሁኑ ጊዜ እጅግ በጣም ስራ ላይ ነው። ጥያቄዎን ወይም አስተያየትዎን እባክዎ በቀጥታ ለዋናው የድጋፍ ሰጪ አካውንት @scofiled1 ይላኩ። ፈጣን ምላሽ ያገኛሉ! እናመሰግናለን። 🙏\n\nHello! 💖 Our support desk is experiencing extremely high volume right now. Please send your inquiries directly to our head of support @scofiled1 for an immediate response. Thank you for your patience! 🙏",
      error: true,
      interactionId: "fallback_" + Date.now()
    };
  }
}

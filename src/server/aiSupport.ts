import { GoogleGenAI, Type } from "@google/genai";
import { supabase } from "./supabase.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.warn("⚠️ GEMINI_API_KEY is not set in environment variables. AI Support will not function.");
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY || "dummy_key_to_prevent_immediate_crash",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});
const chatHistories = new Map<string, any[]>();

export function sanitizeHistory(history: any[]): any[] {
  const clean: any[] = [];
  if (!Array.isArray(history)) return [];
  for (const msg of history) {
    if (!msg || typeof msg !== "object") continue;
    if (!msg.parts || !Array.isArray(msg.parts) || msg.parts.length === 0) {
      continue;
    }
    const firstPart = msg.parts[0];
    if (!firstPart || typeof firstPart !== "object") continue;
    
    // Extract text safely
    const textVal = typeof firstPart.text === "string" ? firstPart.text : "";
    if (!textVal) {
      continue;
    }
    
    const role = msg.role === "model" ? "model" : "user";
    if (clean.length === 0) {
      if (role === "user") {
        clean.push({ role, parts: [{ text: textVal }] });
      }
    } else {
      const last = clean[clean.length - 1];
      if (last.role !== role) {
        clean.push({ role, parts: [{ text: textVal }] });
      } else {
        // Merge consecutive messages with the same role
        last.parts[0].text = (last.parts[0].text || "") + "\n" + textVal;
      }
    }
  }
  return clean;
}

export function clearAiSupportHistory(telegramId: string) {
  chatHistories.delete(telegramId);
}

export async function handleSupportChat(telegramId: string, message: string, oldHistoryArg: any[], isAdmin: boolean = false): Promise<{ text: string, escalate?: boolean, reason?: string, interactionId?: string, error?: boolean }> {
  try {
    // 1. Pre-fetch basic user details from Supabase to inject into the system prompt.
    let userContext = `

CURRENT USER CONTEXT:
- Telegram ID: ${telegramId}`;
    let isBlocked = false;
    try {
      const { data: userData } = await supabase.from("users").select("username, balance, is_blocked_bot").eq("id", telegramId).single();
      if (userData) {
        if (userData.is_blocked_bot) {
            isBlocked = true;
        }
        userContext += `
- Username: @${userData.username || "N/A"}
- Current Balance: ${userData.balance || 0} ETB`;
      }
    } catch (e) {
      // Ignore pre-fetch errors
    }

    if (isBlocked && !isAdmin) {
        return {
            text: "ይቅርታ፣ እርስዎ ይህን አገልግሎት እንዳይጠቀሙ ታግደዋል። ተጨማሪ መረጃ ከፈለጉ እባክዎን በቀጥታ @scofiled1 ያነጋግሩ።\n\nSorry, you have been blocked from using the AI support bot. For more info, please contact @scofiled1 directly.",
            error: true,
            interactionId: "blocked_" + Date.now()
        };
    }

    let systemInstruction = "You are the primary AI Support Assistant for ETB Game Hub. Provide helpful, polite, and accurate support in Amharic and English.";
    try {
      const { data: configData, error: configError } = await supabase.from("bot_config").select("value").eq("key", "ai_system_instruction").single();
      if (!configError && configData?.value) {
        systemInstruction = configData.value;
      }
    } catch (dbErr) {
      console.warn("AI Support warning: Could not fetch system instructions from database, using default:", dbErr);
    }

    if (isAdmin) {
      systemInstruction += "\n\nADMIN PRIVILEGES: You are talking to an admin. You can use tools to check data for ANY user ID they provide.";
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

    const blockUserFD = {
      name: "block_user_from_bot",
      description: "Blocks or unblocks a user from using the AI support bot. Only available to admins.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          telegram_id: { type: Type.STRING, description: "The Telegram ID of the user to block/unblock." },
          block_status: { type: Type.BOOLEAN, description: "True to block, false to unblock." }
        },
        required: ["telegram_id", "block_status"]
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
      // Fallback to provided history if in-memory is lost
      if (Array.isArray(oldHistoryArg) && oldHistoryArg.length > 0) {
        chatHistories.set(telegramId, oldHistoryArg);
      } else {
        chatHistories.set(telegramId, []);
      }
    }
    let history = chatHistories.get(telegramId)!;

    // Append user's new prompt
    history.push({
      role: "user",
      parts: [{ text: message }]
    });

    // Sanitize to guarantee alternating user/model roles and clean format
    history = sanitizeHistory(history);

    // Keep history bounded to avoid hitting token limits (max 12 messages = 6 turns)
    if (history.length > 12) {
      history.splice(0, history.length - 12);
    }

    chatHistories.set(telegramId, history);

    let responseText = "";
    let functionCalls: any[] = [];
    
    // RETRY LOGIC FOR RELIABILITY
    const maxRetries = 2;
    let attempt = 0;
    let success = false;
    let response: any = null;

    while (attempt < maxRetries && !success) {
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: history,
          config: {
            systemInstruction: systemInstruction + "\n\nCRITICAL: Do NOT ask the user for their Telegram ID if they ask for their balance or history. You already have it. Just call the tools directly.",
            tools: [
              {
                functionDeclarations: [
                  getUserProfileFD,
                  getTransactionSummaryFD,
                  escalateToHumanFD,
                  ...(isAdmin ? [blockUserFD] : [])
                ]
              }
            ]
          }
        });
        success = true;
      } catch (err: any) {
        attempt++;
        console.warn(`AI Support attempt ${attempt} failed:`, err.message);
        if (attempt >= maxRetries) {
           throw err; // throw to outer catch block
        }
        await new Promise(r => setTimeout(r, 1000)); // wait 1 sec before retry
      }
    }

    responseText = response?.text || "";
    functionCalls = response?.functionCalls || [];

    // 6. Handle potential function calls (Multi-turn Tool Loop)
    if (functionCalls.length > 0) {
      const toolResults: any[] = [];
      let escalate = false;
      let escalateReason = "";

      for (const call of functionCalls) {
        if (call.name === "get_user_profile") {
          const { telegram_id } = call.args as any;
          let targetIdentifier = telegramId;
          if (telegram_id && typeof telegram_id === 'string') {
            const trimmed = telegram_id.trim();
            // Only use if it looks like a real ID or username
            if (trimmed.startsWith('@') || /^\d+$/.test(trimmed)) {
              targetIdentifier = trimmed;
            }
          }
          
          let profileRes: any;
          try {
            let query = supabase.from("users").select("id, username, balance, created_at");
            if (targetIdentifier.startsWith('@')) {
              query = query.eq('username', targetIdentifier.replace('@', ''));
            } else {
              query = query.eq('id', targetIdentifier);
            }
            
            const { data, error } = await query.single();
            profileRes = error ? { error: "User not found or database error." } : { data };
          } catch (dbErr: any) {
            profileRes = { error: `Database query failed: ${dbErr.message || dbErr}` };
          }

          toolResults.push({
            name: call.name,
            content: profileRes
          });

        } else if (call.name === "get_transaction_summary") {
          const { telegram_id } = call.args as any;
          let targetIdentifier = telegramId;
          if (telegram_id && typeof telegram_id === 'string') {
            const trimmed = telegram_id.trim();
            if (trimmed.startsWith('@') || /^\d+$/.test(trimmed)) {
              targetIdentifier = trimmed;
            }
          }
          
          let txRes: any;
          try {
            let targetId = targetIdentifier;
            if (targetIdentifier.startsWith('@')) {
              const { data: user } = await supabase.from('users').select('id').eq('username', targetIdentifier.replace('@', '')).single();
              if (user) targetId = user.id;
              else targetId = "";
            }
            
            if (targetId && targetId.trim() !== "") {
              const { data, error } = await supabase
                  .from("transactions")
                  .select("amount, type, description, created_at")
                  .eq("user_id", targetId)
                  .order("created_at", { ascending: false })
                  .limit(10);
              txRes = error ? { error: "Could not fetch transactions." } : { transactions: data };
            } else {
              txRes = { error: "User not found for transaction history." };
            }
          } catch (dbErr: any) {
            txRes = { error: `Database query failed: ${dbErr.message || dbErr}` };
          }

          toolResults.push({
            name: call.name,
            content: txRes
          });

        } else if (call.name === "block_user_from_bot" && isAdmin) {
          const { telegram_id, block_status } = call.args as any;
          let blockRes: any;
          try {
            const { error } = await supabase.from("users").update({ is_blocked_bot: block_status }).eq("id", telegram_id);
            blockRes = error ? { error: error.message } : { success: true, message: `User ${telegram_id} block status set to ${block_status}` };
          } catch (dbErr: any) {
            blockRes = { error: `Database block action failed: ${dbErr.message || dbErr}` };
          }

          toolResults.push({
            name: call.name,
            content: blockRes
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

        let followUpResponse: any = null;
        let fuAttempt = 0;
        let fuSuccess = false;
        
        while (fuAttempt < maxRetries && !fuSuccess) {
           try {
             followUpResponse = await ai.models.generateContent({
               model: "gemini-3.5-flash",
               contents: followUpContents,
               config: {
                 systemInstruction: systemInstruction
               }
             });
             fuSuccess = true;
           } catch (e: any) {
             fuAttempt++;
             if (fuAttempt >= maxRetries) throw e;
             await new Promise(r => setTimeout(r, 1000));
           }
        }

        responseText = followUpResponse?.text || "";
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
    console.error(`[AI Support Error] ${error.message}`);
    
    // Clean up the trailing user message from history if it wasn't responded to
    const hist = chatHistories.get(telegramId);
    if (hist && hist.length > 0) {
      const last = hist[hist.length - 1];
      if (last.role === "user") {
        hist.pop();
      }
    }
    
    // Hospitality fallback message: professional, warm, welcoming, and reassuring (no technical jargon or crash errors)
    return {
      text: "ሰላም! 💖 የእኛ የደንበኞች አገልግሎት ረዳት በአሁኑ ጊዜ እጅግ በጣም ስራ ላይ ነው። ጥያቄዎን ወይም አስተያየትዎን እባክዎ በቀጥታ ለዋናው የድጋፍ ሰጪ አካውንት @scofiled1 ይላኩ። ፈጣን ምላሽ ያገኛሉ! እናመሰግናለን። 🙏\n\nHello! 💖 Our support desk is experiencing extremely high volume right now. Please send your inquiries directly to our head of support @scofiled1 for an immediate response. Thank you for your patience! 🙏",
      error: true,
      interactionId: "fallback_" + Date.now()
    };
  }
}

import Groq from "groq-sdk";
import { supabase } from "./supabase.js";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.warn("⚠️ GROQ_API_KEY is not set in environment variables. AI Support will not function.");
}

const groq = new Groq({
  apiKey: GROQ_API_KEY || "dummy_key_to_prevent_immediate_crash"
});

const chatHistories = new Map<string, any[]>();

export function sanitizeHistory(history: any[]): any[] {
  const clean: any[] = [];
  if (!Array.isArray(history)) return [];
  for (const msg of history) {
    if (!msg || typeof msg !== "object") continue;
    
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.parts) && msg.parts.length > 0 && typeof msg.parts[0].text === "string") {
      content = msg.parts[0].text;
    }
    
    if (!content) continue;

    const role = (msg.role === "assistant" || msg.role === "model") ? "assistant" : "user";
    
    if (clean.length === 0) {
      if (role === "user") {
        clean.push({ role, content });
      }
    } else {
      const last = clean[clean.length - 1];
      if (last.role !== role) {
        clean.push({ role, content });
      } else {
        last.content += "\n" + content;
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
    // 1. Pre-fetch basic user details from Supabase
    let userContext = `\n\nCURRENT USER CONTEXT:\n- Telegram ID: ${telegramId}`;
    let isBlocked = false;
    try {
      const { data: userData } = await supabase.from("users").select("username, balance, is_blocked_bot").eq("id", telegramId).single();
      if (userData) {
        if (userData.is_blocked_bot) {
            isBlocked = true;
        }
        userContext += `\n- Username: @${userData.username || "N/A"}\n- Current Balance: ${userData.balance || 0} ETB`;
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
    systemInstruction += "\n\nCRITICAL: Do NOT ask the user for their Telegram ID if they ask for their balance or history. You already have it. Just call the tools directly.";

    // 2. Setup tools for Groq (OpenAI style)
    const tools: any[] = [
      {
        type: "function",
        function: {
          name: "get_user_profile",
          description: "Fetches the current user's balance and registration details. You do NOT need to ask for their ID; you can call this tool directly for the current user.",
          parameters: {
            type: "object",
            properties: {
              telegram_id: {
                type: "string",
                description: "Optional. The Telegram ID of a specific user to check. If omitted, the current user's profile is fetched."
              }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_transaction_summary",
          description: "Fetches recent deposits and withdrawals for the user. You can call this directly for the current user without asking for their ID.",
          parameters: {
            type: "object",
            properties: {
              telegram_id: {
                type: "string",
                description: "Optional. The Telegram ID of a specific user to check."
              }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "escalate_to_human",
          description: "Triggers a connection to a human support agent.",
          parameters: {
            type: "object",
            properties: {
              reason: {
                type: "string",
                description: "The reason why the user needs human assistance."
              }
            },
            required: ["reason"]
          }
        }
      }
    ];

    if (isAdmin) {
      tools.push({
        type: "function",
        function: {
          name: "block_user_from_bot",
          description: "Blocks or unblocks a user from using the AI support bot. Only available to admins.",
          parameters: {
            type: "object",
            properties: {
              telegram_id: { type: "string", description: "The Telegram ID of the user to block/unblock." },
              block_status: { type: "boolean", description: "True to block, false to unblock." }
            },
            required: ["telegram_id", "block_status"]
          }
        }
      });
    }

    // 3. Retrieve or initialize chat history
    if (!chatHistories.has(telegramId)) {
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
      content: message
    });

    // Sanitize to guarantee alternating user/assistant roles and clean format
    history = sanitizeHistory(history);

    // Keep history bounded
    if (history.length > 12) {
      history.splice(0, history.length - 12);
    }

    chatHistories.set(telegramId, history);

    const messages = [
      { role: "system", content: systemInstruction },
      ...history
    ];

    // 4. API Call to Groq
    let response;
    try {
      response = await groq.chat.completions.create({
        model: "llama-3.1-70b-versatile",
        messages: messages as any,
        tools: tools,
        tool_choice: "auto",
        temperature: 0.7,
      });
    } catch (err: any) {
      console.error("Groq API error:", err.message);
      throw err;
    }

    const choice = response.choices[0];
    let responseText = choice.message.content || "";
    const toolCalls = choice.message.tool_calls || [];

    // 5. Handle Tool Calls
    if (toolCalls.length > 0) {
      const toolResults: any[] = [];
      let escalate = false;
      let escalateReason = "";

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);
        
        if (call.function.name === "get_user_profile") {
          const targetIdentifier = args.telegram_id || telegramId;
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
          toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(profileRes) });

        } else if (call.function.name === "get_transaction_summary") {
          const targetIdentifier = args.telegram_id || telegramId;
          let txRes: any;
          try {
            let targetId = targetIdentifier;
            if (targetIdentifier.startsWith('@')) {
              const { data: user } = await supabase.from('users').select('id').eq('username', targetIdentifier.replace('@', '')).single();
              if (user) targetId = user.id;
              else targetId = "";
            }
            
            if (targetId) {
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
          toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(txRes) });

        } else if (call.function.name === "block_user_from_bot" && isAdmin) {
          const { telegram_id, block_status } = args;
          let blockRes: any;
          try {
            const { error } = await supabase.from("users").update({ is_blocked_bot: block_status }).eq("id", telegram_id);
            blockRes = error ? { error: error.message } : { success: true, message: `User ${telegram_id} block status set to ${block_status}` };
          } catch (dbErr: any) {
            blockRes = { error: `Database block action failed: ${dbErr.message || dbErr}` };
          }
          toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(blockRes) });

        } else if (call.function.name === "escalate_to_human") {
          escalate = true;
          escalateReason = args.reason || "User requested human support.";
          toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ success: true }) });
        }
      }

      if (escalate) {
        chatHistories.delete(telegramId);
        return {
          text: "እሺ፣ አሁን ከሰው ድጋፍ ሰጪ (@scofiled1) ጋር እያገናኘሁዎት ነው። እባክዎን ጥቂት ይጠብቁ።",
          escalate: true,
          reason: escalateReason,
          interactionId: "escalated_" + Date.now()
        };
      }

      // Second turn with tool results
      if (toolResults.length > 0) {
        const followUpMessages = [
          ...messages,
          choice.message,
          ...toolResults
        ];

        try {
          const followUpResponse = await groq.chat.completions.create({
            model: "llama-3.1-70b-versatile",
            messages: followUpMessages as any,
          });
          responseText = followUpResponse.choices[0].message.content || "";
        } catch (fuErr: any) {
          console.error("Groq follow-up error:", fuErr.message);
          throw fuErr;
        }
      }
    }

    const finalResultText = responseText || "ይቅርታ፣ አሁን ላይ ምላሽ መስጠት አልቻልኩም። እባክዎን በቀጥታ @scofiled1 ያነጋግሩ።";

    // Save model's final response to history
    history.push({
      role: "assistant",
      content: finalResultText
    });

    return {
      text: finalResultText,
      interactionId: "turn_" + Date.now()
    };

  } catch (error: any) {
    console.error(`[AI Support Error] ${error.message}`);
    
    // Hospitality fallback
    return {
      text: "ሰላም! 💖 የእኛ የደንበኞች አገልግሎት ረዳት በአሁኑ ጊዜ እጅግ በጣም ስራ ላይ ነው። ጥያቄዎን ወይም አስተያየትዎን እባክዎ በቀጥታ ለዋናው የድጋፍ ሰጪ አካውንት @scofiled1 ይላኩ። ፈጣን ምላሽ ያገኛሉ! እናመሰግናለን። 🙏",
      error: true,
      interactionId: "fallback_" + Date.now()
    };
  }
}


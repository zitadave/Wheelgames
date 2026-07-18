import Groq from "groq-sdk";
import { supabase } from "./supabase.js";

let groqClient: Groq | null = null;

function getGroqClient(): Groq {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set. Please add it to your environment variables.");
    }
    groqClient = new Groq({
      apiKey: apiKey,
    });
  }
  return groqClient;
}

async function getEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.JINA_API_KEY;
    if (!apiKey) {
        throw new Error("JINA_API_KEY is not set. Required for embeddings.");
    }
    
    const response = await fetch("https://api.jina.ai/v1/embeddings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "jina-embeddings-v3",
            task: "text-matching",
            dimensions: 768,
            late_chunking: false,
            embedding_type: "float",
            input: [text]
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Jina API error: ${JSON.stringify(error)}`);
    }

    const result = await response.json();
    return result.data[0].embedding;
}

function dotProduct(a: number[], b: number[]) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    return a.reduce((sum, val, i) => sum + (val * (b[i] || 0)), 0);
}

function magnitude(a: number[]) {
    if (!Array.isArray(a)) return 0;
    return Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
}

function cosineSimilarity(a: number[], b: number[]) {
    const magA = magnitude(a);
    const magB = magnitude(b);
    if (magA === 0 || magB === 0) return 0;
    return dotProduct(a, b) / (magA * magB);
}

function parseVector(v: any): number[] {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
        try {
            return JSON.parse(v);
        } catch (e) {
            return v.replace(/[\[\]]/g, '').split(',').map(Number);
        }
    }
    return [];
}

export async function searchKnowledgeBase(query: string): Promise<string> {
    try {
        const embedding = await getEmbedding(query);
        
        // 1. Try Supabase RPC call
        const { data, error } = await supabase.rpc('match_knowledge', {
            query_embedding: embedding,
            match_threshold: 0.5,
            match_count: 5,
        });

        let results = data;

        // 2. Fallback to manual similarity search if RPC fails
        if (error) {
            if (!error.message.includes("structure of query does not match function result type")) {
                console.error("Supabase RPC error:", error.message);
            }
            
            const { data: allKnowledge, error: fetchError } = await supabase
                .from('knowledge_base')
                .select('content, embedding');
            
            if (fetchError) {
                console.error("Manual fetch error:", fetchError);
                return "Error searching knowledge base.";
            }

            if (allKnowledge) {
                const mapped = allKnowledge
                    .map(item => {
                        const itemEmbedding = parseVector(item.embedding);
                        return {
                            content: item.content,
                            similarity: cosineSimilarity(embedding, itemEmbedding)
                        };
                    })
                    .filter(item => item.similarity > 0.5)
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, 5);
                results = mapped;
            }
        }

        if (!results || results.length === 0) {
            return "No relevant information found in the knowledge base.";
        }

        return results.map((item: any) => `- ${item.content}`).join("\n\n");
    } catch (err: any) {
        console.error("RAG search error:", err.message);
        return "Failed to retrieve knowledge base information.";
    }
}

const chatHistories = new Map<string, any[]>();

export function sanitizeHistory(history: any[]): any[] {
  if (!Array.isArray(history)) return [];
  const clean: any[] = [];
  
  for (const msg of history) {
    if (!msg || typeof msg !== "object") continue;
    
    const role = msg.role;
    const content = msg.content || "";
    const tool_calls = msg.tool_calls;
    const tool_call_id = msg.tool_call_id;
    const name = msg.name;

    if (role === "system") {
      clean.push({ role, content });
    } else if (role === "user") {
      clean.push({ role, content });
    } else if (role === "assistant" || role === "model") {
      const assistantMsg: any = { role: "assistant", content };
      if (tool_calls) assistantMsg.tool_calls = tool_calls;
      clean.push(assistantMsg);
    } else if (role === "tool") {
      clean.push({ role, content, tool_call_id, name });
    }
  }
  return clean;
}

export function clearAiSupportHistory(telegramId: string) {
  chatHistories.delete(telegramId);
}

export async function addKnowledgeChunk(content: string, metadata: any = {}): Promise<{ success: boolean; error?: string }> {
    try {
        const embedding = await getEmbedding(content);
        const { error } = await supabase.from('knowledge_base').insert({
            content,
            embedding,
            metadata
        });
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error("Error adding knowledge chunk:", err.message);
        return { success: false, error: err.message };
    }
}

export async function handleSupportChat(telegramId: string, message: string, oldHistoryArg: any[], isAdmin: boolean = false): Promise<{ text: string, escalate?: boolean, reason?: string, interactionId?: string, error?: boolean }> {
  try {
    let userContext = `\n\nCURRENT USER CONTEXT:\n- Telegram ID: ${telegramId}`;
    let isBlocked = false;
    try {
      const { data: userData } = await supabase.from("users").select("username, balance, is_blocked_bot").eq("id", telegramId).single();
      if (userData) {
        if (userData.is_blocked_bot) isBlocked = true;
        userContext += `\n- Username: @${userData.username || "N/A"}\n- Current Balance: ${userData.balance || 0} ETB`;
      }
    } catch (e) {}

    if (isBlocked && !isAdmin) {
        return {
            text: "ይቅርታ፣ እርስዎ ይህን አገልግሎት እንዳይጠቀሙ ታግደዋል። ተጨማሪ መረጃ ከፈለጉ እባክዎን በቀጥታ @scofiled1 ያነጋግሩ።",
            error: true
        };
    }

    let systemInstruction = "You are the AI Support Assistant for ETB Game Hub. Provide helpful, polite support in Amharic and English. Use natural Amharic (Ethiopic script).\n\nTOOLS:\n- Use 'search_knowledge_base' to look up platform rules, game mechanics, etc.\n- ALWAYS call the tool first if you are unsure.";
    try {
      const { data: configData, error: configError } = await supabase.from("bot_config").select("value").eq("key", "ai_system_instruction").single();
      if (!configError && configData?.value) systemInstruction = configData.value;
    } catch (dbErr) {}

    if (isAdmin) systemInstruction += "\n\nADMIN: You can check data for ANY user ID.";
    systemInstruction += userContext;

    const tools: any[] = [
      {
        type: "function",
        function: {
          name: "search_knowledge_base",
          description: "Searches documentation for game rules, platform policies, and help.",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "get_user_profile",
          description: "Fetches user balance and details.",
          parameters: {
            type: "object",
            properties: { telegram_id: { type: "string" } }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "escalate_to_human",
          description: "Connects user to a human agent.",
          parameters: {
            type: "object",
            properties: { reason: { type: "string" } },
            required: ["reason"]
          }
        }
      }
    ];

    if (!chatHistories.has(telegramId)) {
      chatHistories.set(telegramId, Array.isArray(oldHistoryArg) ? oldHistoryArg : []);
    }
    let history = sanitizeHistory(chatHistories.get(telegramId)!);
    history.push({ role: "user", content: message });
    if (history.length > 10) history.splice(0, history.length - 10);
    chatHistories.set(telegramId, history);

    const messages = [{ role: "system", content: systemInstruction }, ...history];

    let response;
    try {
      const groq = getGroqClient();
      response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: messages as any,
        tools: tools,
        tool_choice: "auto",
        temperature: 0.6,
      });
    } catch (err: any) {
      console.error("Groq API error:", err.message);
      if (err.message.includes("429") || err.status === 429) {
          return { text: "ሰላም! 💖 የ AI አገልግሎታችን በከፍተኛ ስራ ላይ ስለሆነ ጥቂት ቆይተው ይሞክሩ።", error: true };
      }
      // Fallback: Retry without tools
      try {
        const groq = getGroqClient();
        response = await groq.chat.completions.create({
          model: "llama-3.1-70b-versatile",
          messages: messages as any,
          temperature: 0.7,
        });
      } catch (err2: any) {
        throw err2;
      }
    }

    const choice = response.choices[0];
    let responseText = choice.message.content || "";
    const toolCalls = choice.message.tool_calls || [];

    if (toolCalls.length > 0) {
      const toolResults: any[] = [];
      let escalate = false;
      let escalateReason = "";

      for (const call of toolCalls) {
        try {
          const args = JSON.parse(call.function.arguments);
          if (call.function.name === "search_knowledge_base") {
            const content = await searchKnowledgeBase(args.query);
            toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content });
          } else if (call.function.name === "get_user_profile") {
            const tid = args.telegram_id || telegramId;
            const { data } = await supabase.from("users").select("balance").eq("id", tid).single();
            toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(data || { error: "Not found" }) });
          } else if (call.function.name === "escalate_to_human") {
            escalate = true;
            escalateReason = args.reason;
            toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: "Escalated" });
          }
        } catch (e) {
          toolResults.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: "Error" });
        }
      }

      if (escalate) {
        return { text: "ከሰው ድጋፍ ሰጪ ጋር እያገናኘሁዎት ነው።", escalate: true, reason: escalateReason };
      }

      if (toolResults.length > 0) {
        const groq = getGroqClient();
        const followUp = await groq.chat.completions.create({
          model: "llama-3.1-70b-versatile",
          messages: [...messages, choice.message, ...toolResults] as any,
        });
        responseText = followUp.choices[0].message.content || "";
      }
    }

    const finalResultText = responseText || "ይቅርታ፣ አሁን ላይ ምላሽ መስጠት አልቻልኩም።";
    history.push({ role: "assistant", content: finalResultText });
    return { text: finalResultText, interactionId: "turn_" + Date.now() };

  } catch (error: any) {
    console.error(`[AI Support Error] ${error.message}`);
    return {
      text: "ሰላም! 💖 የእኛ የደንበኞች አገልግሎት ረዳት በአሁኑ ጊዜ እጅግ በጣም ስራ ላይ ነው። እባክዎን ጥቂት ቆይተው ይሞክሩ።",
      error: true
    };
  }
}

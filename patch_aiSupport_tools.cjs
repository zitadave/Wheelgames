const fs = require('fs');

let code = fs.readFileSync('src/server/aiSupport.ts', 'utf8');

const target1 = `    const escalateToHumanFD = {`;
const replace1 = `    const blockUserFD = {
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

    const escalateToHumanFD = {`;

code = code.replace(target1, replace1);

const target2 = `                  escalateToHumanFD
                ]`;
const replace2 = `                  escalateToHumanFD,
                  ...(isAdmin ? [blockUserFD] : [])
                ]`;

code = code.replace(target2, replace2);

const target3 = `} else if (call.name === "escalate_to_human") {`;
const replace3 = `} else if (call.name === "block_user_from_bot" && isAdmin) {
          const { telegram_id, block_status } = call.args as any;
          const { error } = await supabase.from("users").update({ is_blocked_bot: block_status }).eq("id", telegram_id);
          toolResults.push({
            name: call.name,
            content: error ? { error: error.message } : { success: true, message: \`User \${telegram_id} block status set to \${block_status}\` }
          });
        } else if (call.name === "escalate_to_human") {`;

code = code.replace(target3, replace3);

fs.writeFileSync('src/server/aiSupport.ts', code);
console.log("Patched AI support tools");

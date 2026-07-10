const fs = require('fs');
let code = fs.readFileSync('src/server/BingoEngine.ts', 'utf8');

// The file needs to import txManager
if (!code.includes('import { txManager }')) {
  code = code.replace(/import \{ supabase \} from "\.\/supabase\.js";/, 'import { supabase } from "./supabase.js";\nimport { txManager } from "./transactionManager.js";');
}

// Replace bingo_join balance logic (line 307 - 319 approx)
const joinRegex = /if \(user\) \{\s*const newBalance = user\.balance \- amountToCharge;\s*await supabase\.from\("users"\)\.update\(\{ balance: newBalance \}\)\.eq\("id", data\.userId\);\s*await supabase\.from\("transactions"\)\.insert\(\{[\s\S]*?\}\);\s*io\.to\(`user_\$\{data\.userId\}`\)\.emit\("syncBalance", newBalance\);\s*\}/m;
code = code.replace(joinRegex, `const res = await txManager.modifyBalance(data.userId, -amountToCharge, cardDiff > 0 ? "bet" : "refund", cardDiff > 0 ? \`Bingo Bet Update (\${data.roomId}, +\${cardDiff} cards)\` : \`Bingo Refund Update (\${data.roomId}, \${Math.abs(cardDiff)} cards removed)\`);
                  if (!res.success) {
                     if (callback) callback({ success: false, message: res.error || "Insufficient balance" });
                     return;
                  }
                  io.to(\`user_\${data.userId}\`).emit("syncBalance", res.newBalance);`);


// Replace bingo_leave balance logic
const leaveRegex = /if \(supabase\) \{\s*const \{ data: user \} = await supabase\.from\("users"\)\.select\("balance"\)\.eq\("id", data\.userId\)\.single\(\);\s*if \(user\) \{\s*const newBalance = user\.balance \+ totalRefund;\s*await supabase\.from\("users"\)\.update\(\{ balance: newBalance \}\)\.eq\("id", data\.userId\);\s*await supabase\.from\("transactions"\)\.insert\(\{[\s\S]*?\}\);\s*io\.to\(`user_\$\{data\.userId\}`\)\.emit\("syncBalance", newBalance\);\s*\}\s*\}/m;
code = code.replace(leaveRegex, `const res = await txManager.modifyBalance(data.userId, totalRefund, "refund", \`Bingo Refund (\${data.roomId}, \${player.cards.length} cards)\`);
               if (res.success) {
                  io.to(\`user_\${data.userId}\`).emit("syncBalance", res.newBalance);
               }`);

// Replace bingo_claim payout logic
const claimRegex = /if \(supabase\) \{\s*const \{ data: user \} = await supabase\.from\("users"\)\.select\("balance"\)\.eq\("id", data\.userId\)\.single\(\);\s*if \(user\) \{\s*const newBalance = user\.balance \+ res\.winAmount;\s*await supabase\.from\("users"\)\.update\(\{ balance: newBalance \}\)\.eq\("id", data\.userId\);\s*await supabase\.from\("transactions"\)\.insert\(\{[\s\S]*?\}\);\s*await supabase\.from\("game_logs"\)\.insert\(\{[\s\S]*?\}\);\s*io\.to\(`user_\$\{data\.userId\}`\)\.emit\("syncBalance", newBalance\);\s*\}\s*\}/m;
code = code.replace(claimRegex, `if (supabase) {
                     const txRes = await txManager.modifyBalance(data.userId, res.winAmount, "win", \`Bingo Win (\${room.state.id})\`);
                     await supabase.from("game_logs").insert({
                        user_id: data.userId,
                        game_type: \`Bingo | \${room.state.gameId}\`,
                        result: "Win",
                        win_amount: res.winAmount
                     });
                     if (txRes.success) {
                        io.to(\`user_\${data.userId}\`).emit("syncBalance", txRes.newBalance);
                     }
                  }`);

// Remove test_set_balance
code = code.replace(/socket\.on\("test_set_balance"[\s\S]*?\}\);/m, '');

fs.writeFileSync('src/server/BingoEngine.ts', code);
console.log("Patched BingoEngine.ts");

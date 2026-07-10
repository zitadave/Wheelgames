const fs = require('fs');
let code = fs.readFileSync('src/server/GameEngine.ts', 'utf8');

// Replace grid_claimSlot logic
const claimRegex = /const \{ data: user \} = await supabase\.from\("users"\)\.select\("balance"\)\.eq\("id", data\.userId\)\.single\(\);\s*if \(\!user \|\| Number\(user\.balance\) < entryFee\) \{\s*if \(callback\) callback\(\{ success: false, message: \`Insufficient balance \(\$\{entryFee\} ETB required\) or account not found\.\` \}\);\s*return;\s*\}\s*if \(room && \!room\.claimedSlots\[data\.num\]\) \{\s*\/\/ Deduct balance\s*const newBalance = user\.balance \- entryFee;\s*await supabase\.from\("users"\)\.update\(\{ balance: newBalance \}\)\.eq\("id", data\.userId\);\s*await supabase\.from\("transactions"\)\.insert\(\{[\s\S]*?\}\);\s*io\.to\(`user_\$\{data\.userId\}`\)\.emit\("syncBalance", newBalance\);/m;

code = code.replace(claimRegex, `if (room && !room.claimedSlots[data.num]) {
           const { txManager } = await import("./transactionManager.js");
           const res = await txManager.modifyBalance(data.userId, -entryFee, "bet", \`Secured Slot #\${data.num} in \${data.room}\`);
           if (!res.success) {
               if (callback) callback({ success: false, message: res.error || \`Insufficient balance (\${entryFee} ETB required) or account not found.\` });
               return;
           }
           io.to(\`user_\${data.userId}\`).emit("syncBalance", res.newBalance);`);


// Replace grid_releaseSlot logic
const releaseRegex = /const \{ data: user \} = await supabase\.from\("users"\)\.select\("balance"\)\.eq\("id", data\.userId\)\.single\(\);\s*if \(user\) \{\s*const newBalance = user\.balance \+ entryFee;\s*await supabase\.from\("users"\)\.update\(\{ balance: newBalance \}\)\.eq\("id", data\.userId\);\s*await supabase\.from\("transactions"\)\.insert\(\{[\s\S]*?\}\);\s*io\.to\(`user_\$\{data\.userId\}`\)\.emit\("syncBalance", newBalance\);\s*\}/m;

code = code.replace(releaseRegex, `const { txManager } = await import("./transactionManager.js");
             const res = await txManager.modifyBalance(data.userId, entryFee, "refund", \`Refund Slot #\${data.num} (\${data.room})\`);
             if (res.success) {
                io.to(\`user_\${data.userId}\`).emit("syncBalance", res.newBalance);
             }`);

// Replace submitBet logic
const submitRegex = /const \{ data: user \} = await supabase\.from\("users"\)\.select\("balance"\)\.eq\("id", data\.userId\)\.single\(\);\s*if \(\!user\) \{\s*if \(callback\) callback\(\{ success: false, message: "Account not found\." \}\);\s*return;\s*\}\s*const existingBet = room\.state\.players\[data\.userId\];\s*const oldAmount = existingBet \? existingBet\.amount : 0;\s*const diff = data\.amount \- oldAmount;\s*if \(Number\(user\.balance\) < diff\) \{\s*if \(callback\) callback\(\{ success: false, message: \`Insufficient balance\. Need \$\{diff\.toLocaleString\(\)\} ETB more\.\` \}\);\s*return;\s*\}\s*\/\/ Deduct balance from Supabase\s*const newBalance = Number\(user\.balance\) \- diff;\s*const \{ error: updateError \} = await supabase\.from\("users"\)\.update\(\{ balance: newBalance \}\)\.eq\("id", data\.userId\);\s*if \(updateError\) \{\s*if \(callback\) callback\(\{ success: false, message: "Transaction failed\. Try again\." \}\);\s*return;\s*\}/m;

code = code.replace(submitRegex, `const existingBet = room.state.players[data.userId];
        const oldAmount = existingBet ? existingBet.amount : 0;
        const diff = data.amount - oldAmount;

        const { txManager } = await import("./transactionManager.js");
        const res = await txManager.modifyBalance(data.userId, -diff, "bet", \`Even/Odd Bet (Round #\${room.state.roundId}, Side: \${data.side})\`);
        
        if (!res.success) {
          if (callback) callback({ success: false, message: res.error || "Transaction failed. Try again." });
          return;
        }
        io.to(\`user_\${data.userId}\`).emit("syncBalance", res.newBalance);`);

fs.writeFileSync('src/server/GameEngine.ts', code);
console.log("Patched other game methods");

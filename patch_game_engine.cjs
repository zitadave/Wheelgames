const fs = require('fs');
let code = fs.readFileSync('src/server/GameEngine.ts', 'utf8');

// The file needs to import txManager
if (!code.includes('import { txManager }')) {
  code = code.replace(/import \{ supabase \} from "\.\/supabase\.js";/, 'import { supabase } from "./supabase.js";\nimport { txManager } from "./transactionManager.js";');
}

// Replace Pattern 1 (Promises):
/*
supabase.from("users").select("balance").eq("id", p.userId).single().then(({ data: user }) => {
  if (user) {
    const newBalance = Number(user.balance) + refund;
    supabase.from("users").update({ balance: newBalance }).eq("id", p.userId).then(() => {
      this.io.to(`user_${p.userId}`).emit("syncBalance", newBalance);
    });
  }
});
*/

const pattern1Regex = /supabase\.from\("users"\)\.select\("balance"\)\.eq\("id", (\w+\.userId)\)\.single\(\)\.then\(\(\{ data: user \}\) => \{\s*if \(user\) \{\s*const newBalance = Number\(user\.balance\) \+ (\w+);\s*supabase\.from\("users"\)\.update\(\{ balance: newBalance \}\)\.eq\("id", \1\)\.then\(\(\) => \{\s*this\.io\.to\(`user_\$\{\1\}`\)\.emit\("syncBalance", newBalance\);\s*\}\);\s*\}\s*\}\);/g;

code = code.replace(pattern1Regex, (match, userIdVar, amountVar) => {
  return `txManager.modifyBalance(${userIdVar}, ${amountVar}, "refund", "Partial Refund / Balance Adjust").then((res) => { if (res.success) { this.io.to(\`user_\$\{${userIdVar}\}\`).emit("syncBalance", res.newBalance); } });`;
});

// Write it back
fs.writeFileSync('src/server/GameEngine.ts', code);
console.log("Patched promises in GameEngine.ts");

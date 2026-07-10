const fs = require('fs');
let code = fs.readFileSync('src/server/GameEngine.ts', 'utf8');

// Replace line 304 to 319 block
code = code.replace(/supabase\.from\("users"\)\.select\("balance"\)\.eq\("id", p\.userId\)\.single\(\)\.then\(\(\{ data: user \}\) => \{[\s\S]*?(?=\}\);\n          \}\n        \})/g, 
`txManager.modifyBalance(p.userId, prize, "win", \`Even/Odd Win (Round #\${this.state.roundId}, Side: \${winningSide})\`).then((res) => {
              if (res.success) {
                this.io.to(\`user_\${p.userId}\`).emit("syncBalance", res.newBalance);
              }
            });`);

fs.writeFileSync('src/server/GameEngine.ts', code);
console.log("Patched p2p wins");

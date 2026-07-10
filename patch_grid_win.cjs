const fs = require('fs');
let code = fs.readFileSync('src/server/GameEngine.ts', 'utf8');

const target = `                                if (prize > 0) {
                                    const { data: user } = await supabase.from("users").select("balance").eq("id", winner.userId).single();
                                    if (user) {
                                        const newBalance = user.balance + prize;
                                        await supabase.from("users").update({ balance: newBalance }).eq("id", winner.userId);
                                        await supabase.from("transactions").insert({
                                           user_id: winner.userId,
                                           amount: prize,
                                           type: "win",
                                           description: \`Win #\${wNum} in \${data.room} (Place \${i+1})\`
                                        });
                                        io.to(\`user_\${winner.userId}\`).emit("syncBalance", newBalance);
                                    }
                                }`;

const replacement = `                                if (prize > 0) {
                                    const { txManager } = await import("./transactionManager.js");
                                    const res = await txManager.modifyBalance(winner.userId, prize, "win", \`Win #\${wNum} in \${data.room} (Place \${i+1})\`);
                                    if (res.success) {
                                        io.to(\`user_\${winner.userId}\`).emit("syncBalance", res.newBalance);
                                    }
                                }`;

code = code.replace(target, replacement);

fs.writeFileSync('src/server/GameEngine.ts', code);
console.log("Patched grid win");

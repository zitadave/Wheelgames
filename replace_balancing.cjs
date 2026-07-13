const fs = require('fs');

let content = fs.readFileSync('src/server/GameEngine.ts', 'utf8');

const regex = /private doBalancing\(\) \{[\s\S]*?this\.timer = setInterval\(\(\) => this\.tick\(\), 1000\);\n  \}/;

const newCode = `private doBalancing() {
    this.state.status = "balancing";
    this.state.timeLeft = BALANCING_TIME;

    // Balancing Logic
    // Pure P2P Match - balance the pools
    if (this.state.pools.even !== this.state.pools.odd) {
      const overSide = this.state.pools.even > this.state.pools.odd ? 'even' : 'odd';
      const underSide = overSide === 'even' ? 'odd' : 'even';
      const targetPool = this.state.pools[underSide];
      
      let currentOverPool = 0;
      // Sort players by timestamp or just array order (first come first served)
      const overPlayers = Object.values(this.state.players).filter(p => p.side === overSide);
      
      for (const p of overPlayers) {
        if (currentOverPool + p.amount <= targetPool) {
          currentOverPool += p.amount;
        } else {
          // This bet crosses the threshold
          const remaining = targetPool - currentOverPool;
          if (remaining > 0 && p.partial) {
            // Refund the difference
            const refund = p.amount - remaining;
            p.amount = remaining;
            currentOverPool += remaining;
            if (p.amount > 0) {
              this.state.feed.unshift(\`የ\${p.username} ባለው \${p.amount.toLocaleString()} ሄደሃል።\`);
            } else {
              this.state.feed.unshift(\`የ\${p.username} በዚህ ዙር አልሄድክም\`);
            }
            this.io.to(p.userId).emit('refund', refund);
            txManager.modifyBalance(p.userId, refund, "refund", "Partial Refund / Balance Adjust").then((res) => { if (res.success) { this.io.to(\`user_\${p.userId}\`).emit("syncBalance", res.newBalance); } });
            supabase.from("transactions").insert({
              user_id: p.userId,
              amount: refund,
              type: "refund",
              description: \`Even/Odd Partial Refund (Pool Limit, Round #\${this.state.roundId})\`
            }).then(({ error }) => { if (error) console.error("Refund log failed:", error); });
          } else {
            // Reject the whole bet
            const refund = p.amount;
            p.amount = 0; // effectively removed
            this.state.feed.unshift(\`የ\${p.username} በዚህ ዙር አልሄድክም\`);
            this.io.to(p.userId).emit('refund', refund);
            txManager.modifyBalance(p.userId, refund, "refund", "Partial Refund / Balance Adjust").then((res) => { if (res.success) { this.io.to(\`user_\${p.userId}\`).emit("syncBalance", res.newBalance); } });
            supabase.from("transactions").insert({
              user_id: p.userId,
              amount: refund,
              type: "refund",
              description: \`Even/Odd Refund (Pool Limit, Round #\${this.state.roundId})\`
            }).then(({ error }) => { if (error) console.error("Refund log failed:", error); });
          }
        }
      }
      this.state.pools[overSide] = targetPool;
    }

    // Determine winner early for animation
    let isEvenWinner = Math.random() > 0.5;

    // Even numbers: 2, 4, 6. Odd numbers: 1, 3, 5
    const evenNumbers = [2, 4, 6];
    const oddNumbers = [1, 3, 5];

    this.state.winner = isEvenWinner 
       ? evenNumbers[Math.floor(Math.random() * evenNumbers.length)]
       : oddNumbers[Math.floor(Math.random() * oddNumbers.length)];

    this.broadcastState();
    this.timer = setInterval(() => this.tick(), 1000);
  }`;

fs.writeFileSync('src/server/GameEngine.ts', content.replace(regex, newCode));

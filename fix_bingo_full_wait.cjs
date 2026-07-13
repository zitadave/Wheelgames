const fs = require('fs');

let content = fs.readFileSync('src/server/BingoEngine.ts', 'utf8');

// If 400 cards are selected, skip to 10 seconds remaining in lobby if it's currently > 10.
content = content.replace(
  `this.broadcastState();
     return { success: true };`,
  `this.broadcastState();
     
     // Check if all 400 cards are taken
     let totalCards = 0;
     for (const p of Object.values(this.state.players)) {
       totalCards += p.cards.length;
     }
     if (totalCards >= 400 && this.state.status === "lobby" && this.state.timeLeft > 10) {
       this.state.timeLeft = 10;
       this.broadcastState();
     }
     
     return { success: true };`
);

fs.writeFileSync('src/server/BingoEngine.ts', content);

const fs = require('fs');

let content = fs.readFileSync('src/server/BingoEngine.ts', 'utf8');

// Replace bingo total card skip
content = content.replace(
  `this.broadcastState();
     
     // Check if all 50 cards are taken
     let totalCards = 0;
     for (const p of Object.values(this.state.players)) {
       totalCards += p.cards.length;
     }
     if (totalCards >= 400 && this.timer) {
       this.clearTimer();
       this.startPlaying();
     }
     
     return { success: true };`,
  `this.broadcastState();
     return { success: true };`
);

fs.writeFileSync('src/server/BingoEngine.ts', content);

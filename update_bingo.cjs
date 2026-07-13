const fs = require('fs');

let content = fs.readFileSync('src/server/BingoEngine.ts', 'utf8');

const regexJoin = /this\.broadcastState\(\);\n     return \{ success: true \};/;

const newJoin = `this.broadcastState();
     
     // Check if all 50 cards are taken
     let totalCards = 0;
     for (const p of Object.values(this.state.players)) {
       totalCards += p.cards.length;
     }
     if (totalCards >= 50 && this.timer) {
       this.clearTimer();
       this.startPlaying();
     }
     
     return { success: true };`;

content = content.replace(regexJoin, newJoin);

fs.writeFileSync('src/server/BingoEngine.ts', content);

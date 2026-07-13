const fs = require('fs');

let content = fs.readFileSync('src/server/BingoEngine.ts', 'utf8');

// Replace 50 with 400
content = content.replace(
  "if (totalCards >= 50 && this.timer) {",
  "if (totalCards >= 400 && this.timer) {"
);

fs.writeFileSync('src/server/BingoEngine.ts', content);

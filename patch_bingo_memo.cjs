const fs = require('fs');
let code = fs.readFileSync('src/components/BingoGame.tsx', 'utf8');

code = code.replace(
  /export const BingoGame: React\.FC<BingoGameProps> = \(\{/g,
  "export const BingoGame = React.memo(function BingoGame({"
);

// We need to add the closing parenthesis for memo
// The end of the file is usually `};`
const lastBraceIndex = code.lastIndexOf('};');
if (lastBraceIndex !== -1) {
  code = code.substring(0, lastBraceIndex) + '});\n' + code.substring(lastBraceIndex + 2);
}

fs.writeFileSync('src/components/BingoGame.tsx', code);
console.log("Patched BingoGame");

const fs = require('fs');
let code = fs.readFileSync('src/components/Leaderboard.tsx', 'utf8');

code = code.replace(
  /export function Leaderboard\(\{ stats, isLoading, onRefresh, userId, botUsername, showNotification \}: LeaderboardProps\) \{/g,
  "export const Leaderboard = React.memo(function Leaderboard({ stats, isLoading, onRefresh, userId, botUsername, showNotification }: LeaderboardProps) {"
);

const lastBraceIndex = code.lastIndexOf('}');
if (lastBraceIndex !== -1) {
  code = code.substring(0, lastBraceIndex) + '});\n' + code.substring(lastBraceIndex + 1);
}

fs.writeFileSync('src/components/Leaderboard.tsx', code);
console.log("Patched Leaderboard");

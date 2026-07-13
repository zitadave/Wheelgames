const fs = require('fs');

let content = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

content = content.replace(
  "flex-1 overflow-y-auto px-1 pr-2 pb-6 max-h-[420px] opacity-100",
  "flex-1 overflow-y-auto px-1 pr-2 pb-6 max-h-[420px] ${tier === 'grand' && gamePhase === 'drawing' ? 'opacity-0' : 'opacity-100'}"
);

content = content.replace(
  "className={`grid gap-1 ${showTheater ? 'pointer-events-none' : ''}`}",
  "className={`grid gap-1 ${showTheater ? 'opacity-20 pointer-events-none' : 'opacity-100'}`}"
);

fs.writeFileSync('src/components/JackpotArena.tsx', content);

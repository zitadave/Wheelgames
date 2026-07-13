const fs = require('fs');

let content = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

// Replace opacity-0 with opacity-100 for grand tier drawing
content = content.replace(
  "flex-1 overflow-y-auto px-1 pr-2 pb-6 max-h-[420px] ${tier === 'grand' && gamePhase === 'drawing' ? 'opacity-0' : 'opacity-100'}",
  "flex-1 overflow-y-auto px-1 pr-2 pb-6 max-h-[420px] opacity-100"
);

// Replace opacity-20 with just pointer-events-none during theater
content = content.replace(
  "className={`grid gap-1 ${showTheater ? 'opacity-20 pointer-events-none' : 'opacity-100'}`}",
  "className={`grid gap-1 ${showTheater ? 'pointer-events-none' : ''}`}"
);

// There is also another opacity-20 inset-0 pointer-events-none?
// "div className=\"absolute inset-0 opacity-20 pointer-events-none\""
// Actually that's inside the grid item, it's fine.

fs.writeFileSync('src/components/JackpotArena.tsx', content);

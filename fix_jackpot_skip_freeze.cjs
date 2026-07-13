const fs = require('fs');

let content = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

// Replace grid opacity to be fully visible
content = content.replace(
  "className={`grid gap-1 ${showTheater ? 'opacity-20 pointer-events-none' : 'opacity-100'}`}",
  "className={`grid gap-1 ${showTheater ? 'pointer-events-none' : 'opacity-100'}`}"
);

// Instead of setting freeze, set drawing phase immediately
content = content.replace(
  `if (Object.keys(newClaimed).length === config[tier].slots && gamePhase === 'lobby') {
          setGamePhase('freeze');
          setFreezeCountdown(10);
       }`,
  `if (Object.keys(newClaimed).length === config[tier].slots && gamePhase === 'lobby') {
          setGamePhase('drawing');
          setDrawNumber(1);
          startDrawingAnimations(1);
       }`
);

// Same for the manual trigger
content = content.replace(
  `const triggerGlobalFreeze = () => {
    setGamePhase('freeze');
    setFreezeCountdown(10);
  };`,
  `const triggerGlobalFreeze = () => {
    setGamePhase('drawing');
    setDrawNumber(1);
    startDrawingAnimations(1);
  };`
);

fs.writeFileSync('src/components/JackpotArena.tsx', content);

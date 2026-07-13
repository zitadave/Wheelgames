const fs = require('fs');

let content = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

// Instead of setting drawing phase immediately, set freeze
content = content.replace(
  `if (Object.keys(newClaimed).length === config[tier].slots && gamePhase === 'lobby') {
          setGamePhase('drawing');
          setDrawNumber(1);
          startDrawingAnimations(1);
       }`,
  `if (Object.keys(newClaimed).length === config[tier].slots && gamePhase === 'lobby') {
          setGamePhase('freeze');
          setFreezeCountdown(10);
       }`
);

// Same for the manual trigger
content = content.replace(
  `const triggerGlobalFreeze = () => {
    setGamePhase('drawing');
    setDrawNumber(1);
    startDrawingAnimations(1);
  };`,
  `const triggerGlobalFreeze = () => {
    setGamePhase('freeze');
    setFreezeCountdown(10);
  };`
);

fs.writeFileSync('src/components/JackpotArena.tsx', content);

const fs = require('fs');

// Fix JackpotArena.tsx
let contentJ = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

if (!contentJ.includes('isResettingRef')) {
  contentJ = contentJ.replace(
    `const gamePhaseRef = useRef(gamePhase);`,
    `const gamePhaseRef = useRef(gamePhase);\n  const isResettingRef = useRef(false);`
  );

  contentJ = contentJ.replace(
    `const onGridState = (state: any) => {`,
    `const onGridState = (state: any) => {\n       if (isResettingRef.current) {\n         if (Object.keys(state.claimedSlots || {}).length < config[tier].slots) {\n           isResettingRef.current = false;\n           setGamePhase('lobby');\n         } else {\n           return;\n         }\n       }`
  );

  contentJ = contentJ.replace(
    `setGamePhase('lobby');\n    setDrawNumber(1);`,
    `// setGamePhase('lobby'); // Delayed until empty grid arrives\n    isResettingRef.current = true;\n    setDrawNumber(1);`
  );
}

fs.writeFileSync('src/components/JackpotArena.tsx', contentJ);

// Fix WheelOfChance.tsx
let contentW = fs.readFileSync('src/components/WheelOfChance.tsx', 'utf8');

if (!contentW.includes('isResettingRef')) {
  contentW = contentW.replace(
    `const phaseRef = useRef(phase);`,
    `const phaseRef = useRef(phase);\n  const isResettingRef = useRef(false);`
  );

  contentW = contentW.replace(
    `const onGridState = (state: any) => {`,
    `const onGridState = (state: any) => {\n       if (isResettingRef.current) {\n         const maxSlots = activeRoom === '1-10' ? 10 : 20;\n         if (Object.keys(state.claimedSlots || {}).length < maxSlots) {\n           isResettingRef.current = false;\n           setPhase('lobby');\n         } else {\n           return;\n         }\n       }`
  );

  contentW = contentW.replace(
    `setPhase('lobby');\n        setClaimedSlots({});`,
    `// setPhase('lobby'); // Delayed until empty grid arrives\n        isResettingRef.current = true;\n        setClaimedSlots({});`
  );
}

fs.writeFileSync('src/components/WheelOfChance.tsx', contentW);

// Fix BingoGame.tsx
let contentB = fs.readFileSync('src/components/BingoGame.tsx', 'utf8');

if (!contentB.includes('pendingUpdateRef')) {
  contentB = contentB.replace(
    `const prevCalledBallsLengthRef = useRef<number>(0);`,
    `const prevCalledBallsLengthRef = useRef<number>(0);\n  const pendingUpdateRef = useRef(false);`
  );

  contentB = contentB.replace(
    `setSelectedCards(roomState.players[userId].cards);`,
    `if (!pendingUpdateRef.current) setSelectedCards(roomState.players[userId].cards);`
  );

  contentB = contentB.replace(
    `setSelectedCards(newSelected);`,
    `setSelectedCards(newSelected);\n    pendingUpdateRef.current = true;`
  );

  contentB = contentB.replace(
    `showNotification(res.message, "error");`,
    `showNotification(res.message, "error");\n          pendingUpdateRef.current = false;\n          if (roomState?.players[userId]) setSelectedCards(roomState.players[userId].cards);\n          else setSelectedCards([]);`
  );
  
  contentB = contentB.replace(
    `if (res.success) {`,
    `pendingUpdateRef.current = false;\n        if (res.success) {`
  );
}

fs.writeFileSync('src/components/BingoGame.tsx', contentB);

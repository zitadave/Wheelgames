const fs = require('fs');

let contentJ = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

contentJ = contentJ.replace(
  `if (isResettingRef.current) {\n         if (Object.keys(state.claimedSlots || {}).length < config[tier].slots) {\n           isResettingRef.current = false;\n           setGamePhase('lobby');\n         } else {\n           return;\n         }\n       }`,
  `if (isResettingRef.current) {\n         // If the state's roundId is less than what we optimistically set, it's the stale grid.\n         // If it's equal or greater, the server has processed a nextRound (ours or someone else's).\n         if (state.roundId && state.roundId < roundIdsRef.current[tier]) {\n            return;\n         }\n         isResettingRef.current = false;\n         setGamePhase('lobby');\n       }`
);

if (!contentJ.includes('roundIdsRef')) {
  contentJ = contentJ.replace(
    `const [roundIds, setRoundIds] = useState<{ mini: number; grand: number }>(() => ({`,
    `const [roundIds, setRoundIds] = useState<{ mini: number; grand: number }>(() => ({\n    mini: Math.floor(Math.random() * 9000) + 1000,\n    grand: Math.floor(Math.random() * 9000) + 1000\n  }));\n  const roundIdsRef = useRef(roundIds);\n  useEffect(() => { roundIdsRef.current = roundIds; }, [roundIds]);\n\n  // DUMMY:`
  );
  // remove the duplicate initialization
  contentJ = contentJ.replace(
    `// DUMMY:\n    mini: Math.floor(Math.random() * 9000) + 1000,\n    grand: Math.floor(Math.random() * 9000) + 1000\n  }));`,
    ``
  );
}

fs.writeFileSync('src/components/JackpotArena.tsx', contentJ);

let contentW = fs.readFileSync('src/components/WheelOfChance.tsx', 'utf8');

contentW = contentW.replace(
  `if (isResettingRef.current) {\n         const maxSlots = activeRoom === '1-10' ? 10 : 20;\n         if (Object.keys(state.claimedSlots || {}).length < maxSlots) {\n           isResettingRef.current = false;\n           setPhase('lobby');\n         } else {\n           return;\n         }\n       }`,
  `if (isResettingRef.current) {\n         if (state.roundId && state.roundId < roundIdsRef.current[activeRoom]) {\n            return;\n         }\n         isResettingRef.current = false;\n         setPhase('lobby');\n       }`
);

if (!contentW.includes('roundIdsRef')) {
  contentW = contentW.replace(
    `const [roundIds, setRoundIds] = useState<{ [key: string]: number }>(() => ({`,
    `const [roundIds, setRoundIds] = useState<{ [key: string]: number }>(() => ({\n    '1-10': Math.floor(Math.random() * 9000) + 1000,\n    '1-20': Math.floor(Math.random() * 9000) + 1000\n  }));\n  const roundIdsRef = useRef(roundIds);\n  useEffect(() => { roundIdsRef.current = roundIds; }, [roundIds]);\n\n  // DUMMY:`
  );
  contentW = contentW.replace(
    `// DUMMY:\n    '1-10': Math.floor(Math.random() * 9000) + 1000,\n    '1-20': Math.floor(Math.random() * 9000) + 1000\n  }));`,
    ``
  );
}

fs.writeFileSync('src/components/WheelOfChance.tsx', contentW);

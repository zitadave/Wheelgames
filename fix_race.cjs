const fs = require('fs');

// Fix JackpotArena.tsx
let contentJ = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');

contentJ = contentJ.replace(
  `const [gamePhase, setGamePhase] = useState<'lobby' | 'freeze' | 'drawing' | 'winner' | 'vaporizing' | 'complete'>('lobby');`,
  `const [gamePhase, setGamePhase] = useState<'lobby' | 'freeze' | 'drawing' | 'winner' | 'vaporizing' | 'complete'>('lobby');\n  const gamePhaseRef = useRef(gamePhase);\n  useEffect(() => { gamePhaseRef.current = gamePhase; }, [gamePhase]);`
);

contentJ = contentJ.replace(
  `if (Object.keys(newClaimed).length === config[tier].slots && gamePhase === 'lobby') {`,
  `if (Object.keys(newClaimed).length === config[tier].slots && gamePhaseRef.current === 'lobby') {`
);

contentJ = contentJ.replace(
  `}, [socket, tier, isActive, gamePhase]);`,
  `}, [socket, tier, isActive]);`
);

fs.writeFileSync('src/components/JackpotArena.tsx', contentJ);

// Fix WheelOfChance.tsx
let contentW = fs.readFileSync('src/components/WheelOfChance.tsx', 'utf8');

contentW = contentW.replace(
  `const [phase, setPhase] = useState<GamePhase>('lobby');`,
  `const [phase, setPhase] = useState<GamePhase>('lobby');\n  const phaseRef = useRef(phase);\n  useEffect(() => { phaseRef.current = phase; }, [phase]);`
);

contentW = contentW.replace(
  `if (Object.keys(newClaimed).length === maxSlots && phase === 'lobby') {`,
  `if (Object.keys(newClaimed).length === maxSlots && phaseRef.current === 'lobby') {`
);

contentW = contentW.replace(
  `}, [socket, activeRoom, isActive, phase]);`,
  `}, [socket, activeRoom, isActive]);`
);

fs.writeFileSync('src/components/WheelOfChance.tsx', contentW);

const fs = require('fs');

let contentJ = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');
if (!contentJ.includes('roundIdsRef')) {
  contentJ = contentJ.replace(
    'const [roundIds, setRoundIds]',
    'const roundIdsRef = useRef({ mini: 0, grand: 0 });\n  const [roundIds, setRoundIds]'
  );
  contentJ = contentJ.replace(
    'useEffect(() => {',
    'useEffect(() => {\n    roundIdsRef.current = roundIds;\n  }, [roundIds]);\n\n  useEffect(() => {'
  );
  fs.writeFileSync('src/components/JackpotArena.tsx', contentJ);
}

let contentW = fs.readFileSync('src/components/WheelOfChance.tsx', 'utf8');
if (!contentW.includes('roundIdsRef')) {
  contentW = contentW.replace(
    'const [roundIds, setRoundIds]',
    'const roundIdsRef = useRef({ "1-10": 0, "1-20": 0 });\n  const [roundIds, setRoundIds]'
  );
  contentW = contentW.replace(
    'useEffect(() => {',
    'useEffect(() => {\n    roundIdsRef.current = roundIds;\n  }, [roundIds]);\n\n  useEffect(() => {'
  );
  fs.writeFileSync('src/components/WheelOfChance.tsx', contentW);
}

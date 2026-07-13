const fs = require('fs');

let contentJ = fs.readFileSync('src/components/JackpotArena.tsx', 'utf8');
contentJ = contentJ.replace('  useEffect(() => { roundIdsRef.current = roundIds; }, [roundIds]);\n    mini: ', '    mini: ');
contentJ = contentJ.replace('  }));', '  }));\n  useEffect(() => { roundIdsRef.current = roundIds; }, [roundIds]);');
fs.writeFileSync('src/components/JackpotArena.tsx', contentJ);

let contentW = fs.readFileSync('src/components/WheelOfChance.tsx', 'utf8');
contentW = contentW.replace('  useEffect(() => { roundIdsRef.current = roundIds; }, [roundIds]);\n    \'1-10\': ', '    \'1-10\': ');
contentW = contentW.replace('  }));', '  }));\n  useEffect(() => { roundIdsRef.current = roundIds; }, [roundIds]);');
fs.writeFileSync('src/components/WheelOfChance.tsx', contentW);

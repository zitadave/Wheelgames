const fs = require('fs');
let code = fs.readFileSync('src/server/aiSupport.ts', 'utf8');

code = code.replace(
  /systemInstruction \+ "\n\nCRITICAL/g,
  'systemInstruction + "\\n\\nCRITICAL'
);

fs.writeFileSync('src/server/aiSupport.ts', code);
console.log("Fixed string newlines 3");

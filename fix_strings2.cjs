const fs = require('fs');
let code = fs.readFileSync('src/server/aiSupport.ts', 'utf8');

code = code.replace(
  /systemInstruction \+= "\n\nADMIN PRIVILEGES/g,
  'systemInstruction += "\\n\\nADMIN PRIVILEGES'
);

fs.writeFileSync('src/server/aiSupport.ts', code);
console.log("Fixed string newlines 2");

const fs = require('fs');
let code = fs.readFileSync('src/server/aiSupport.ts', 'utf8');

code = code.replace(
  /export async function handleSupportChat\(\n  telegramId: string,\n  message: string,\n  isAdmin: boolean = false\n\)/g,
  'export async function handleSupportChat(telegramId: string, message: string, oldHistoryArg: any[], isAdmin: boolean = false)'
);

fs.writeFileSync('src/server/aiSupport.ts', code);
console.log("Fixed signature");

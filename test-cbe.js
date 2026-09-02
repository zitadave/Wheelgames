import fs from 'fs';
const txMgr = fs.readFileSync('src/server/transactionManager.ts', 'utf8');
const cbeRegex = txMgr.match(/cbe\.com\.et\\\/([a-zA-Z0-9_-]+)/i);
console.log("Regex exists in transactionManager.ts:", !!cbeRegex);

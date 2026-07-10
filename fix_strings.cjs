const fs = require('fs');

let code = fs.readFileSync('src/server/aiSupport.ts', 'utf8');

code = code.replace(
  /"ይቅርታ፣ እርስዎ ይህን አገልግሎት እንዳይጠቀሙ ታግደዋል። ተጨማሪ መረጃ ከፈለጉ እባክዎን በቀጥታ @scofiled1 ያነጋግሩ።\n\nSorry, you have been blocked from using the AI support bot. For more info, please contact @scofiled1 directly."/g,
  '"ይቅርታ፣ እርስዎ ይህን አገልግሎት እንዳይጠቀሙ ታግደዋል። ተጨማሪ መረጃ ከፈለጉ እባክዎን በቀጥታ @scofiled1 ያነጋግሩ።\\n\\nSorry, you have been blocked from using the AI support bot. For more info, please contact @scofiled1 directly."'
);

fs.writeFileSync('src/server/aiSupport.ts', code);
console.log("Fixed string newlines 1");

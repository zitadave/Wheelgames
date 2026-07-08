const fs = require('fs');
const path = require('path');

const mgrPath = path.join(__dirname, 'src/server/announcementManager.ts');
let mgrCode = fs.readFileSync(mgrPath, 'utf8');

// replace processAnnouncements to format numbers correctly
const formatEmojiNumbers = `
function formatEmojiNumbers(nums: number[]): string {
  const emojiMap: { [key: string]: string } = {
    '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣',
    '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'
  };
  return nums.map(n => n.toString().split('').map(digit => emojiMap[digit]).join('')).join(', ');
}
`;

if (!mgrCode.includes('formatEmojiNumbers')) {
  mgrCode = mgrCode.replace('export async function processAnnouncements', formatEmojiNumbers + '\nexport async function processAnnouncements');
}

mgrCode = mgrCode.replace(
  /\/\/ Dynamic logic for specific types[\s\S]*?\} else if \(ann\.type === "high_withdrawal"\)/,
  \`// Dynamic logic for specific types
      if (ann.type === "vip_slots") {
        const vipGrandSlots = formatEmojiNumbers(generateSlotNumbers(100));
        const miniVipSlots = formatEmojiNumbers(generateSlotNumbers(50));
        const fastSlots = formatEmojiNumbers(generateSlotNumbers(20));
        
        messageText = \`🎲 <b>የተቀሩ ያልተያዙ ቦታዎች (Remaining Slots)</b> 🎲\\n\\n\` +
          \`🔥 <b>ዕድል 100 ሰው (vip-grand) ቀሪ ቁጥሮች:</b>\\n\${vipGrandSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`💥 <b>ዕድል 50 ሰው (mini-vip) ቀሪ ቁጥሮች:</b>\\n\${miniVipSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b>\\n\${fastSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`<i>አሁኑኑ ይግቡ እና ቦታዎን ያስይዙ!</i>\`;
      } else if (ann.type === "high_withdrawal")\`
);

// Also change "join_play" logic
mgrCode = mgrCode.replace(
  /\} else if \(ann\.type === "join_play"\) \{[\s\S]*?try \{/,
  \`\} else if (ann.type === "join_play") {
        const vipGrandSlots = formatEmojiNumbers(generateSlotNumbers(100).slice(0, 5));
        const miniVipSlots = formatEmojiNumbers(generateSlotNumbers(50).slice(0, 5));
        const fastSlots = formatEmojiNumbers(generateSlotNumbers(20).slice(0, 5));
        
        messageText = \`🎮 <b>Scheduled Match Starting Soon!</b> 🎮\\n\\n\` +
          \`⏳ <b>Games available:</b>\\n\\n\` +
          \`🔥 <b>ዕድል 100 ሰው ቀሪ ቁጥሮች:</b> \${vipGrandSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`💥 <b>ዕድል 50 ሰው ቀሪ ቁጥሮች:</b> \${miniVipSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`⚡ <b>ፈጣን 20 ሰው ቀሪ ቁጥሮች:</b> \${fastSlots} ቶሎ ብለው ቁጥር ሳያልቅ ያዝ ያዝ ያድርጉ እና ያሸንፉ፤ ይደሰቱ 🥰\\n\\n\` +
          \`<i>Don't miss the next round! Log in to the Mini App and place your bets!</i>\`;
      }
      try {\`
);

fs.writeFileSync(mgrPath, mgrCode, 'utf8');
console.log("Updated announcementManager.ts");

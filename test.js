const emojiMap = {
    '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣',
    '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'
  };
const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const formatted = nums.map(n => {
    return n.toString().split('').map(digit => emojiMap[digit] || digit).join('');
  }).join(' ');
console.log(formatted);

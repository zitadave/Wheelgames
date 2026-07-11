const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50];
const ranges = [];
let currentRange = [nums[0]];
for (let i = 1; i < nums.length; i++) {
  if (nums[i] === nums[i - 1] + 1) {
    currentRange.push(nums[i]);
  } else {
    ranges.push(currentRange);
    currentRange = [nums[i]];
  }
}
if (currentRange.length > 0) {
  ranges.push(currentRange);
}
const formatted = ranges.map(r => {
  if (r.length === 1) return r[0].toString();
  if (r.length === 2) return `${r[0]}, ${r[1]}`;
  return `${r[0]} - ${r[r.length - 1]}`;
}).join(', ');
console.log(formatted);

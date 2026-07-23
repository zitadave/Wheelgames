// Deterministic Bingo Card Generator using 32-bit Mulberry32 PRNG
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDeterministicCard(id: number): number[][] {
  const card: number[][] = [];
  // Standard integer hash seed derived strictly from card ID
  const seed = (id * 2654435761) >>> 0;
  const rng = mulberry32(seed);

  for (let col = 0; col < 5; col++) {
    const min = col * 15 + 1;
    const available = Array.from({ length: 15 }, (_, i) => min + i);
    const colNums: number[] = [];
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) {
        colNums.push(0); // Free space (star)
        continue;
      }
      const randIdx = Math.floor(rng() * available.length);
      colNums.push(available.splice(randIdx, 1)[0]);
    }
    card.push(colNums);
  }
  return card;
}

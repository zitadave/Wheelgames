// Deterministic Bingo Card Generator
export function getDeterministicCard(id: number): number[][] {
  const card: number[][] = [];
  const seed = id * 12345;
  const pseudoRandom = (s: number) => {
    const x = Math.sin(s) * 10000;
    return x - Math.floor(x);
  };

  for (let col = 0; col < 5; col++) {
    const min = col * 15 + 1;
    const max = (col + 1) * 15;
    const available = Array.from({ length: 15 }, (_, i) => min + i);
    const colNums: number[] = [];
    for (let row = 0; row < 5; row++) {
      if (col === 2 && row === 2) {
        colNums.push(0); // Free space (star)
        continue;
      }
      const randIdx = Math.floor(pseudoRandom(seed + col * 20 + row) * available.length);
      colNums.push(available.splice(randIdx, 1)[0]);
    }
    card.push(colNums);
  }
  return card;
}

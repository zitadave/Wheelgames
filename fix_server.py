with open('src/server/BingoEngine.ts', 'r') as f:
    code = f.read()

target = '''   const bingoRooms: Record<string, BingoRoom> = {
      "bingo-10": new BingoRoom("bingo-10", io, 10),
      "bingo-20": new BingoRoom("bingo-20", io, 20),
   };'''

replacement = '''   const bingoRooms: Record<string, BingoRoom> = {
      "bingo-10": new BingoRoom("bingo-10", io, 10),
      "bingo-20": new BingoRoom("bingo-20", io, 20),
   };

   // Offset the start time for the second room so they aren't perfectly synced
   bingoRooms["bingo-20"].state.timeLeft = 30;'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/server/BingoEngine.ts', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')

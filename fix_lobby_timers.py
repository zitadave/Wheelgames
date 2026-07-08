import re
with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target1 = '''<span className="text-[10px] font-mono text-purple-300 font-bold bg-purple-500/20 px-1.5 py-0.5 rounded">{bingoRoomsMeta['bingo-10'].timeLeft}s</span>'''
replacement1 = '''<span className="text-[12px] font-mono text-purple-300 font-black bg-purple-500/20 px-2 py-0.5 rounded">{bingoRoomsMeta['bingo-10'].timeLeft}s</span>'''
code = code.replace(target1, replacement1)

target2 = '''<span className="text-[10px] font-mono text-orange-300 font-bold bg-orange-500/20 px-1.5 py-0.5 rounded">{bingoRoomsMeta['bingo-20'].timeLeft}s</span>'''
replacement2 = '''<span className="text-[12px] font-mono text-orange-300 font-black bg-orange-500/20 px-2 py-0.5 rounded">{bingoRoomsMeta['bingo-20'].timeLeft}s</span>'''
code = code.replace(target2, replacement2)

with open('src/components/BingoGame.tsx', 'w') as f:
    f.write(code)
print('SUCCESS')

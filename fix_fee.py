with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

code = code.replace('<span className="text-[8px] font-black text-gray-500">15% HOUSE FEE</span>', '')

with open('src/components/BingoGame.tsx', 'w') as f:
    f.write(code)
print('SUCCESS')

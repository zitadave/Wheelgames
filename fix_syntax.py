with open('src/server/BingoEngine.ts', 'r') as f:
    lines = f.readlines()

with open('src/server/BingoEngine.ts', 'w') as f:
    for i, line in enumerate(lines):
        if i == 334 and 'if (supabase) {' in line:
            continue
        f.write(line)
print('SUCCESS')

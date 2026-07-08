with open('src/server/BingoEngine.ts', 'r') as f:
    code = f.read()

# Comment out addRandomBot
code = code.replace('this.addRandomBot();', '// this.addRandomBot();')
code = code.replace('const botWon = this.checkBotBingos();', 'const botWon = false; // this.checkBotBingos();')

with open('src/server/BingoEngine.ts', 'w') as f:
    f.write(code)
print('SUCCESS')

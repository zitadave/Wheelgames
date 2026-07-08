with open('src/server/BingoEngine.ts', 'r') as f:
    code = f.read()

target = '''         } else if (room) {
            // socket.leave(data.roomId);
            room.leave(data.userId);
         }'''

replacement = '''         } else if (room) {
            // Do NOT remove them from the game if it is already playing
            // socket.leave(data.roomId);
         }'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/server/BingoEngine.ts', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')

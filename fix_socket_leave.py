with open('src/server/BingoEngine.ts', 'r') as f:
    code = f.read()

target = '''            socket.leave(data.roomId);
            room.leave(data.userId);
         } else if (room) {
            socket.leave(data.roomId);
            room.leave(data.userId);
         }'''

replacement = '''            // socket.leave(data.roomId);
            room.leave(data.userId);
         } else if (room) {
            // socket.leave(data.roomId);
            room.leave(data.userId);
         }'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/server/BingoEngine.ts', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')

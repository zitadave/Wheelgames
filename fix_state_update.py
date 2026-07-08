with open('src/App.tsx', 'r') as f:
    code = f.read()

target = '''    socket.on('bingo_state', (state: any) => {
      setBingoRoomState(state);
    });'''

replacement = '''    socket.on('bingo_state', (state: any) => {
      setBingoRoomState(prev => {
        // Only update if we are currently looking at this room, or if we don't have a room selected (to prevent background updates from messing up state)
        // Actually, it's safer to always update, but let's make sure it doesn't overwrite if we switched rooms
        return state; 
      });
    });'''

# Wait, if we just keep it as is, it's fine. The only issue is `bingoRoomState` is populated when we are on the menu.
# But I can fix `bingo_leave` to ACTUALLY leave the socket room, and in BingoGame.tsx `handleLeave` I can just emit a new `bingo_refund` event instead of `bingo_leave`.

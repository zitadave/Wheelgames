with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target = '''  useEffect(() => {
    if (!socket || !selectedRoomId || isActive === false) return;
    socket.emit('bingo_get_state', selectedRoomId);
  }, [socket, selectedRoomId, isActive]);'''

replacement = '''  useEffect(() => {
    if (!socket || !selectedRoomId || isActive === false) return;
    socket.emit('bingo_get_state', selectedRoomId);
  }, [socket, selectedRoomId, isActive]);

  useEffect(() => {
    if (roomState?.players && roomState.players[userId]) {
      setIsJoined(true);
      if (selectedCards.length === 0) {
        setSelectedCards(roomState.players[userId].cards);
      }
    } else {
      setIsJoined(false);
      if (roomState?.status === 'lobby') {
        setSelectedCards([]);
      }
    }
  }, [roomState?.players, userId, roomState?.status]);'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/components/BingoGame.tsx', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')

import re
with open('src/components/BingoGame.tsx', 'r') as f:
    code = f.read()

target = '''  useEffect(() => {
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

replacement = '''  useEffect(() => {
    if (roomState?.players && roomState.players[userId]) {
      setIsJoined(true);
      // Ensure we reflect the exact cards they bought
      setSelectedCards(roomState.players[userId].cards);
    } else {
      setIsJoined(false);
      // If the game started and they never joined, clear their selection so they see "Watching Only"
      if (roomState?.status === 'playing' || roomState?.status === 'result') {
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

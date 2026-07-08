import re
with open('src/server/BingoEngine.ts', 'r') as f:
    code = f.read()

target = '''  private addRandomBot() {
    const activeBotNames = Object.values(this.state.players).map(p => p.username);
    const availableBots = BINGO_BOTS.filter(b => !activeBotNames.includes(b.username));
    
    if (availableBots.length === 0) return;
    
    const chosenBot = availableBots[Math.floor(Math.random() * availableBots.length)];
    const botId = `bot_${chosenBot.username.toLowerCase()}_${Math.floor(Math.random() * 1000)}`;
    
    const card1 = Math.floor(Math.random() * 400) + 1;
    const card2 = Math.floor(Math.random() * 400) + 1;
    const cards = card1 === card2 ? [card1] : [card1, card2];
    
    this.state.players[botId] = {
      userId: botId,
      username: chosenBot.username,
      cards,
      photoUrl: chosenBot.photoUrl
    };
  }'''

replacement = '''  private addRandomBot() {
    const activeBotNames = Object.values(this.state.players).map(p => p.username);
    const availableBots = BINGO_BOTS.filter(b => !activeBotNames.includes(b.username));
    
    if (availableBots.length === 0) return;
    
    // Find taken cards
    const takenCards = new Set<number>();
    Object.values(this.state.players).forEach(p => {
       p.cards.forEach(c => takenCards.add(c));
    });
    
    // Find available cards
    const availableCards: number[] = [];
    for (let i = 1; i <= 400; i++) {
       if (!takenCards.has(i)) availableCards.push(i);
    }
    
    if (availableCards.length < 2) return;
    
    // Pick two random unique cards
    const r1 = Math.floor(Math.random() * availableCards.length);
    const card1 = availableCards[r1];
    availableCards.splice(r1, 1);
    const r2 = Math.floor(Math.random() * availableCards.length);
    const card2 = availableCards[r2];
    
    const chosenBot = availableBots[Math.floor(Math.random() * availableBots.length)];
    const botId = `bot_${chosenBot.username.toLowerCase()}_${Math.floor(Math.random() * 1000)}`;
    
    this.state.players[botId] = {
      userId: botId,
      username: chosenBot.username,
      cards: [card1, card2],
      photoUrl: chosenBot.photoUrl
    };
  }'''

if target in code:
    code = code.replace(target, replacement)
    with open('src/server/BingoEngine.ts', 'w') as f:
        f.write(code)
    print('SUCCESS')
else:
    print('NOT FOUND')

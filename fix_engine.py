import re
with open('src/server/BingoEngine.ts', 'r') as f:
    code = f.read()

target1 = '''  private startPlaying() {
    if (Object.keys(this.state.players).length === 0) {
       this.startLobby();
       return;
    }'''

replacement1 = '''  private startPlaying() {
    // We want the game to start even if no players selected a card, so spectators can watch
    // if (Object.keys(this.state.players).length === 0) {
    //    this.startLobby();
    //    return;
    // }'''

code = code.replace(target1, replacement1)

target2 = '''        // Add random bot players periodically during the lobby phase (at 40s, 30s, 20s, 10s)
        if ([40, 30, 20, 10].includes(this.state.timeLeft)) {
          // this.addRandomBot();
        }'''

replacement2 = '''        // Add random bot players periodically during the lobby phase (at 40s, 30s, 20s, 10s)
        if ([40, 30, 20, 10].includes(this.state.timeLeft)) {
          this.addRandomBot();
        }'''

code = code.replace(target2, replacement2)

target3 = '''    // Check if any bot player won Bingo after the new ball is called
    const botWon = false; // this.checkBotBingos();
    if (botWon) {
       return; // Stop calling more balls
    }'''

replacement3 = '''    // Check if any bot player won Bingo after the new ball is called
    const botWon = this.checkBotBingos();
    if (botWon) {
       return; // Stop calling more balls
    }'''

code = code.replace(target3, replacement3)

target_join = '''  public join(userId: string, username: string, cards: number[], photoUrl?: string) {
     if (this.state.status !== "lobby") return { success: false, message: "Game already in progress" };
     if (cards.length === 0 || cards.length > 2) return { success: false, message: "Invalid cards count" };'''

replacement_join = '''  public join(userId: string, username: string, cards: number[], photoUrl?: string) {
     if (this.state.status !== "lobby") return { success: false, message: "Game already in progress" };
     if (cards.length === 0 || cards.length > 2) return { success: false, message: "Invalid cards count" };
     
     // Check if any of the cards is already selected by another player
     for (const card of cards) {
        for (const [pId, p] of Object.entries(this.state.players)) {
           if (pId !== userId && p.cards.includes(card)) {
              return { success: false, message: `Card ${card} is already taken by another player` };
           }
        }
     }'''

code = code.replace(target_join, replacement_join)

with open('src/server/BingoEngine.ts', 'w') as f:
    f.write(code)
print('SUCCESS')

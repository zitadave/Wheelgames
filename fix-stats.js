const fs = require('fs');
const file = 'src/components/KenoGame.tsx';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
`  const getTicketStats = (ticketNumbers: number[], ticketBet: number) => {
    const matchedNumbers = ticketNumbers.filter(n => drawNumbers.slice(0, currentDrawIndex + 1).includes(n));
    const payoutMult = PAYOUTS[ticketNumbers.length]?.[matchedNumbers.length] || 0;
    return {
      matchedNumbers,
      payout: payoutMult * ticketBet,
      isWinner: payoutMult > 0,
      payoutMult
    };
  };`,
`  const getTicketStats = (ticketNumbers: number[], ticketBet: number) => {
    const matchedNumbers = ticketNumbers.filter(n => drawNumbers.slice(0, currentDrawIndex + 1).includes(n));
    let payoutMult = PAYOUTS[ticketNumbers.length]?.[matchedNumbers.length] || 0;
    
    // Do not award "Catch 0" (or below minimum required) payouts until the draw is completely finished
    if (currentDrawIndex < 19 && matchedNumbers.length < getMinRequiredMatches(ticketNumbers.length)) {
      payoutMult = 0;
    }

    return {
      matchedNumbers,
      payout: Number((payoutMult * ticketBet).toFixed(2)),
      isWinner: payoutMult > 0,
      payoutMult
    };
  };`
);
fs.writeFileSync(file, code);

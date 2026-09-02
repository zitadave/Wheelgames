import fetch from 'node-fetch';

async function test() {
  const depositRes = await fetch('http://localhost:3000/api/deposit-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: "12345", 
      amount: "22",
      bank: "CBE",
      receiptText: "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th"
    })
  });
  console.log("Deposit response:", await depositRes.text());
}
test();

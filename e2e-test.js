import fetch from 'node-fetch';

async function test() {
  // 1. Trigger Webhook
  const webhookRes = await fetch('http://localhost:3000/api/webhook/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': 'Dave@5520@Dave' },
    body: JSON.stringify({
      phone: "889",
      raw_message: "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th"
    })
  });
  console.log("Webhook response:", await webhookRes.text());

  // 2. Trigger Deposit Request
  const depositRes = await fetch('http://localhost:3000/api/deposit-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: "12345", // We need a valid user ID! Wait.
      amount: "22",
      bank: "CBE",
      receiptText: "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th"
    })
  });
  console.log("Deposit response:", await depositRes.text());
}
test();

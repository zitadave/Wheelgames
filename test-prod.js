import fetch from 'node-fetch';
const bodyStr = `{
  "transaction_id": "",
  "amount": "",
  "sender_name": "",
  "sender_phone": "889",
  "raw_message": "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th"
}`;
const r = await fetch('https://wheelgames2.onrender.com/api/webhook/sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': 'Dave@5520@Dave' },
    body: bodyStr
});
console.log("Status:", r.status);
console.log("Text:", await r.text());

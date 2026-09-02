import crypto from 'crypto';
import fetch from 'node-fetch';

const secret = "Dave@5520@Dave";
const payload = {
  transaction_id: "{{TXN_ID}}",
  amount: "{{AMOUNT}}",
  sender_name: "{{SENDER}}",
  sender_phone: "889",
  raw_message: "Dear Dawit Tamiru Asefaw You have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938. Your current balance is ETB244.61. Thanks for Banking with CBE. https://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th  for feedback: https://forms.gle/kGNGQpG3mQCCk3iD6"
};

const hmac = crypto.createHmac('sha256', secret);
const signature = hmac.update(JSON.stringify(payload)).digest('hex');

console.log("Sending Webhook payload to Render...");
fetch("https://wheelgames2.onrender.com/api/webhook/sms", {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "x-signature": secret // The server accepts raw secret
    },
    body: JSON.stringify(payload)
}).then(async r => {
    console.log("Status:", r.status);
    console.log("Response:", await r.text());
}).catch(e => console.error(e));


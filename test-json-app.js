const bodyStr = `{
  "transaction_id": "{{TXN_ID}}",
  "amount": "{{AMOUNT}}",
  "sender_name": "{{SENDER}}",
  "sender_phone": "889",
  "raw_message": "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th"
}`;
let payload = {};
try {
  payload = JSON.parse(bodyStr);
} catch (e) {
  const brokenJsonPhone = bodyStr.match(/"sender_phone"\s*:\s*"([^"]*)"/i);
  const brokenJsonRaw = bodyStr.match(/"raw_message"\s*:\s*"([\s\S]*?)"\s*}/i);
  
  if (brokenJsonPhone && brokenJsonRaw) {
    payload = { phone: brokenJsonPhone[1].trim(), raw_message: brokenJsonRaw[1].trim() };
  } else {
    console.log("Fallback 2 failed");
  }
}
console.log(payload);

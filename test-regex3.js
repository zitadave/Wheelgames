const bodyStr = `{
  "transaction_id": "",
  "amount": "",
  "sender_name": "",
  "sender_phone": "889",
  "raw_message": "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th"
}`;
const brokenJsonPhone = bodyStr.match(/"sender_phone"\s*:\s*"([^"]*)"/i);
const brokenJsonRaw = bodyStr.match(/"raw_message"\s*:\s*"([\s\S]*?)"\s*}/i);
console.log("Phone match:", brokenJsonPhone ? brokenJsonPhone[1] : "null");
console.log("Raw match:", brokenJsonRaw ? brokenJsonRaw[1] : "null");

if (brokenJsonPhone && brokenJsonRaw) {
    let payload = { phone: brokenJsonPhone[1].trim(), raw_message: brokenJsonRaw[1].trim() };
    console.log("Payload:", payload);
}

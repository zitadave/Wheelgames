const text = "Dear Dawit Tamiru Asefaw You have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938. Your current balance is ETB244.61. Thanks for Banking with CBE. https://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th  for feedback: https://forms.gle/kGNGQpG3mQCCk3iD6";
const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
const txIdPatterns = [
    /\b(MT[A-Z0-9.]{8,22})\b/i,
    /\b(FT[A-Z0-9.]{8,22})\b/i,
    /\b(TXN[A-Z0-9.]{8,22})\b/i,
    /\b(DG[A-Z0-9.]{8,22})\b/i,
    /cbe\.com\.et\/([a-zA-Z0-9_-]+)/i,
    /(?:ref|reference|transaction\s*id|transaction\s*number|Ref\s*No|የማመሳከሪያ\s*ቁጥር|መለያ|ቁጥር)(?::|\s+is)?[:\s#]*([A-Z0-9.]{8,22})/i,
    /\b([A-Z0-9]{8,22})\b/
];
let txId = null;
for (const pattern of txIdPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].toUpperCase().trim();
      if (!["CUSTOMER", "TELEBIRR", "PAYMENT", "ACCOUNT", "MERCHANT", "TRANSFER"].includes(candidate)) {
        txId = candidate;
        console.log("Matched Pattern:", pattern);
        break;
      }
    }
}
console.log("Parsed TX ID:", txId);


const amountPatterns = [
    /(?:credited\s*with|transferred|sent|received|deposited)\s*(?:birr|etb|br|ብር)?\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    /(?:ብር|ብር\s* መጠን)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    /([0-9,]+(?:\.[0-9]{2})?)\s*(?:birr|etb|br|ብር)/i,
    /(?:etb|birr|br|ብር)[:\s]*([0-9,]+(?:\.[0-9]{2})?)/i,
    /(?:ገቢ|ተሞልቷል|ገባ)\s*(?:ብር)?\s*([0-9,]+(?:\.[0-9]{2})?)/i
];
let amount = null;
for (const pattern of amountPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const cleanAmt = match[1].replace(/,/g, '');
      const parsed = parseFloat(cleanAmt);
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        console.log("Matched Pattern:", pattern);
        break;
      }
    }
}
console.log("Parsed Amount:", amount);


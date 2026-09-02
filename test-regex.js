const text = "Dear Dawit Tamiru Asefaw You have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938. Your current balance is ETB244.61. Thanks for Banking with CBE. https://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th  for feedback: https://forms.gle/kGNGQpG3mQCCk3iD6";
const amountMatch = text.match(/(?:credited|sent|received|ETB|ብር|amount|amt|deposited|transferred)\s*(?:ETB|Birr|ብር)?\s*([\d,]+(?:\.\d+)?)/i);
console.log("amountMatch:", amountMatch ? amountMatch[1] : "null");

const refMatch = text.match(/(?:Ref|ID|Transaction|ቁጥር|መለያ)(?::|\s+is)?\s*([A-Z0-9.]{8,22})/i) || text.match(/cbe\.com\.et\/([a-zA-Z0-9_-]+)/i);
console.log("refMatch:", refMatch ? refMatch[1] : "null");

const cbeMatch = text.match(/\(\s*([a-zA-Z\s]{3,40})\s*\)\s*(?:to\s*your|to\s*account)/i);
console.log("cbeMatch:", cbeMatch ? cbeMatch[1] : "null");


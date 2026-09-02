import { parseReceiptSMS } from './src/server/transactionManager.js';
const receiptText = "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th";

console.log("Parsed:", parseReceiptSMS(receiptText));

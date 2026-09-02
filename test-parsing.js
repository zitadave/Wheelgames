import { parseReceiptSMS } from './src/server/transactionManager.js';
import { parseBankSMS } from './src/server/smsParser.js';

const msg = `Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th`;

console.log("parseReceiptSMS:", parseReceiptSMS(msg));
console.log("parseBankSMS:", parseBankSMS(msg, "889"));

import { parseBankSMS, extractSenderName } from './src/server/smsParser';

const rawMessage = `Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th`;

const parsed = parseBankSMS(rawMessage, "889");
console.log("Parsed:", parsed);
console.log("SenderName:", extractSenderName(rawMessage));

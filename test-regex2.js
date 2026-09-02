const body = "PHONE: 889\nTEXT: Dear Dawit Tamiru Asefaw You have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.";
const phoneMatch = body.match(/PHONE:\s*(.*?)\n/i);
const textMatch = body.match(/TEXT:\s*([\s\S]*)/i);
console.log("phone:", phoneMatch[1]);
console.log("text:", textMatch[1]);

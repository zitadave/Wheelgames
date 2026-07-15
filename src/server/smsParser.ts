
export interface ParsedSMS {
  amount: number;
  transactionId: string;
  senderName?: string;
  bankName: string;
}

export function parseBankSMS(text: string, from: string): ParsedSMS | null {
  const lowercaseText = text.toLowerCase();
  
  // CBE Parsing logic
  // Example: "Dear Customer, your A/C *7890 has been credited with ETB 500.00 by ABEBE BALCHA. Ref: FT2312345678. 15-Jul-26 10:30 AM"
  if (from.includes("CBE") || lowercaseText.includes("cbe")) {
    const amountMatch = text.match(/ETB\s?([\d,]+\.?\d*)/i);
    const refMatch = text.match(/Ref:\s?([A-Z0-9]+)/i);
    if (amountMatch && refMatch) {
      return {
        amount: parseFloat(amountMatch[1].replace(/,/g, "")),
        transactionId: refMatch[1],
        bankName: "CBE"
      };
    }
  }

  // Telebirr Parsing logic
  // Example: "Transaction successful. You have received ETB 100.00 from 251911223344 ABEBE BALCHA. Your current balance is... Transaction ID: 0123456789"
  // Example 2: "Your transaction number is DGF4VDU0WI"
  if (from.toLowerCase().includes("telebirr") || lowercaseText.includes("telebirr")) {
    const amountMatch = text.match(/(?:received|credited|ETB|deposited)\s*(?:ETB|Birr|ብር)?\s*([\d,]+\.?\d*)/i);
    // Matches "Transaction ID: XXX" or "transaction number is XXX" or "number XXX" or "Ref: XXX"
    const refMatch = text.match(/(?:Transaction ID|transaction number|Ref|ID|number)(?::|\s+is)?\s+([A-Z0-9]{8,15})/i);
    
    if (amountMatch && refMatch) {
      return {
        amount: parseFloat(amountMatch[1].replace(/,/g, "")),
        transactionId: refMatch[1].trim().toUpperCase(),
        bankName: "Telebirr"
      };
    }
  }

  // Generic/Fallback
  const amountMatch = text.match(/(?:ETB|Birr|ብር)\s*([\d,]+\.?\d*)/i);
  const refMatch = text.match(/(?:Ref|ID|Transaction|number)(?::|\s+is)?\s+([A-Z0-9]{8,15})/i);
  if (amountMatch && refMatch) {
    return {
      amount: parseFloat(amountMatch[1].replace(/,/g, "")),
      transactionId: refMatch[1],
      bankName: from || "Unknown"
    };
  }

  return null;
}

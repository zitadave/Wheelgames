
export interface ParsedSMS {
  amount: number;
  transactionId: string;
  senderName?: string;
  bankName: string;
}

export function parseBankSMS(text: string, from: string): ParsedSMS | null {
  const lowercaseText = text.toLowerCase();
  
  // CBE Parsing logic
  const isCBE = from.includes("889") || from.includes("CBE") || lowercaseText.includes("cbe") || lowercaseText.includes("ንግድ ባንክ");
  if (isCBE) {
    const amountMatch = text.match(/(?:credited|sent|received|ETB|ብር|amount|amt|deposited|transferred)\s*(?:ETB|Birr|ብር)?\s*([\d,]+\.?\d*)/i);
    const refMatch = text.match(/(?:Ref|ID|Transaction|ቁጥር|መለያ)(?::|\s+is)?\s*([A-Z0-9.]{8,22})/i);
    if (amountMatch && refMatch) {
      return {
        amount: parseFloat(amountMatch[1].replace(/,/g, "")),
        transactionId: refMatch[1].trim().toUpperCase(),
        bankName: "CBE"
      };
    }
  }

  // Telebirr Parsing logic
  const isTelebirr = from.includes("127") || from.toLowerCase().includes("telebirr") || lowercaseText.includes("telebirr") || lowercaseText.includes("ቴሌብር");
  if (isTelebirr) {
    const amountMatch = text.match(/(?:received|credited|ETB|deposited|transferred|sent|ብር|amount|amt)\s*(?:ETB|Birr|ብር)?\s*([\d,]+\.?\d*)/i);
    // Matches English and common Amharic "Reference Number" labels
    const refMatch = text.match(/(?:Transaction ID|transaction number|Ref|ID|number|ቁጥር|መለያ)(?::|\s+is)?\s*([A-Z0-9.]{8,22})/i);
    
    if (amountMatch && refMatch) {
      return {
        amount: parseFloat(amountMatch[1].replace(/,/g, "")),
        transactionId: refMatch[1].trim().toUpperCase(),
        bankName: "Telebirr"
      };
    }
  }

  // Generic/Fallback
  const amountMatch = text.match(/(?:ETB|Birr|ብር|amount|amt|sent|received|transferred|deposited)\s*(?:ETB|Birr|ብር)?\s*([\d,]+\.?\d*)/i);
  const refMatch = text.match(/(?:Ref|ID|Transaction|number|ቁጥር|መለያ)(?::|\s+is)?\s*([A-Z0-9.]{8,22})/i);
  if (amountMatch && refMatch) {
    return {
      amount: parseFloat(amountMatch[1].replace(/,/g, "")),
      transactionId: refMatch[1].trim().toUpperCase(),
      bankName: from || "Unknown"
    };
  }

  return null;
}

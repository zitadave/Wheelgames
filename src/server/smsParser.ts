
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
    const amountMatch = text.match(/(?:credited|sent|received|ETB|ብር|amount|amt|deposited|transferred)\s*(?:ETB|Birr|ብር)?\s*([\d,]+(?:\.\d+)?)/i);
    const refMatch = text.match(/(?:Ref|ID|Transaction|ቁጥር|መለያ)(?::|\s+is)?\s*([A-Z0-9.]{8,22})/i);
    if (amountMatch && refMatch) {
      let cleanTxId = refMatch[1].trim().toUpperCase();
      if (cleanTxId.endsWith('.')) cleanTxId = cleanTxId.slice(0, -1);
      return {
        amount: parseFloat(amountMatch[1].replace(/,/g, "")),
        transactionId: cleanTxId,
        bankName: "CBE"
      };
    }
  }

  // Telebirr Parsing logic
  const isTelebirr = from.includes("127") || from.toLowerCase().includes("telebirr") || lowercaseText.includes("telebirr") || lowercaseText.includes("ቴሌብር");
  if (isTelebirr) {
    const amountMatch = text.match(/(?:received|credited|ETB|deposited|transferred|sent|ብር|amount|amt)\s*(?:ETB|Birr|ብር)?\s*([\d,]+(?:\.\d+)?)/i);
    // Matches English and common Amharic "Reference Number" labels
    const refMatch = text.match(/(?:Transaction ID|transaction number|Ref|ID|number|ቁጥር|መለያ)(?::|\s+is)?\s*([A-Z0-9.]{8,22})/i);
    
    if (amountMatch && refMatch) {
      let cleanTxId = refMatch[1].trim().toUpperCase();
      if (cleanTxId.endsWith('.')) cleanTxId = cleanTxId.slice(0, -1);
      return {
        amount: parseFloat(amountMatch[1].replace(/,/g, "")),
        transactionId: cleanTxId,
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

export function extractSenderName(text: string): string | null {
  if (!text) return null;
  const cleanText = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

  const patterns = [
    // Matches "from JOHN DOE" or "from: JOHN DOE" or "from JOHN DOE."
    /from\s+([A-Z\s]{3,35})(?:\s*\(|\s*\.|\s+Ref|\s+on|\s+at|\s+to|is\s+credited|\s+by)/i,
    /by\s+([A-Z\s]{3,35})(?:\s*\(|\s*\.|\s+Ref|\s+on|\s+at|\s+to|is\s+credited|from)/i,
    /ከ\s*([A-Za-z\s]{3,35})\s*(?:\(|በ|ገቢ|ሂሳብ|ቁጥር)/i,
    /(?:transfer\s+from|received\s+from)\s+([A-Z\s]{3,35})/i,
    /([A-Z\s]{3,35})\s+has\s+deposited/i,
  ];

  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Split by whitespace and filter out noise
      const words = name.split(/\s+/).map(w => w.trim());
      const cleanedWords = words.filter(w => {
        const upper = w.toUpperCase();
        return upper.length > 1 && !["REF", "ID", "TRANSACTION", "TELEBIRR", "CBE", "ETB", "BIRR", "DEAR", "CUSTOMER", "MOBILE", "BANKING", "ACCOUNT", "VIA", "BY", "FROM", "TO"].includes(upper);
      });
      if (cleanedWords.length >= 1) {
        return cleanedWords.join(" ").toUpperCase();
      }
    }
  }

  return null;
}

export function verifyNameMatch(depositorName: string | null, userFullName: string, telegramUsername?: string): boolean {
  if (!depositorName) return false;

  const cleanDepositor = depositorName.toUpperCase().replace(/[^A-Z\s]/g, "").trim();
  const cleanFull = userFullName.toUpperCase().replace(/[^A-Z\s]/g, "").trim();
  const cleanUsername = (telegramUsername || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();

  const depositorWords = cleanDepositor.split(/\s+/).filter(w => w.length > 2);
  const userWords = cleanFull.split(/\s+/).filter(w => w.length > 2);

  if (depositorWords.length === 0) return false;

  // 1. Check if any word of the depositor name matches a word of the user's full name on Telegram
  for (const depWord of depositorWords) {
    if (userWords.includes(depWord)) {
      return true;
    }
  }

  // 2. Check if the username matches or is part of the depositor name
  if (cleanUsername.length > 3) {
    for (const depWord of depositorWords) {
      if (cleanUsername.includes(depWord)) {
        return true;
      }
    }
    if (cleanUsername.includes(cleanDepositor.replace(/\s+/g, ""))) {
      return true;
    }
  }

  // 3. Check if the depositor name contains any of the user's Telegram name words
  for (const userWord of userWords) {
    if (cleanDepositor.includes(userWord)) {
      return true;
    }
  }

  return false;
}

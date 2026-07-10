const botLogs: string[] = (globalThis as any).telegramBotLogs || [];

export function logBot(msg: string) {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] ${msg}`;
  console.log(formatted);
  botLogs.push(formatted);
  if (botLogs.length > 200) {
    botLogs.shift();
  }
  (globalThis as any).telegramBotLogs = botLogs;
}

export function getBotLogs() {
  return botLogs;
}

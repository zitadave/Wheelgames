const GLOBAL_LOGS_KEY = "__TELEGRAM_BOT_LOGS__";
const botLogs: string[] = (globalThis as any)[GLOBAL_LOGS_KEY] || [];

export function logBot(msg: string) {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] ${msg}`;
  console.log(formatted);
  botLogs.push(formatted);
  if (botLogs.length > 200) {
    botLogs.shift();
  }
  (globalThis as any)[GLOBAL_LOGS_KEY] = botLogs;
}

export function getBotLogs() {
  return botLogs;
}

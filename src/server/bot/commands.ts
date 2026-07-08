import TelegramBot, { Message } from "node-telegram-bot-api";

export function registerCommandHandlers(
  bot: TelegramBot,
  logBot: (msg: string) => void,
  checkRegisteredAndHandle: (msg: Message, handler: () => void) => Promise<void>,
  sendSupportCard: (chatId: number) => void,
  userStates: Map<string, any>
) {
  bot.onText(/\/language/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🌐 <b>Select your language / ቋንቋ ይምረጡ:</b>", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🇬🇧 English", callback_data: "lang_en" }],
          [{ text: "🇪🇹 Amharic", callback_data: "lang_am" }]
        ]
      }
    });
  });

  bot.onText(/\/support/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    if (!userId) return;

    // Activate AI Support Session
    userStates.set(userId, { 
      step: 'support_ai', 
      isSupportAI: true, 
      aiHistory: undefined 
    });

    bot.sendMessage(chatId, "👋 <b>Welcome to AI Support!</b>\n\nI am your AI assistant. How can I help you today? You can ask about your balance, games, or any issues you're facing.\n\n<i>Type your message below to start chatting. To exit support, type /cancel.</i>", { parse_mode: "HTML" });
  });
}

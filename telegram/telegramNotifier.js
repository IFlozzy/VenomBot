// telegram/telegramNotifier.js
import TelegramBot from 'node-telegram-bot-api';
import telegramKeys from '../telegramKeys.js'; // Шлях оновлено

// Допоміжна функція для розбиття довгого повідомлення на частини
function splitMessage(message, maxLength = 4000) {
    const chunks = [];
    for (let i = 0; i < message.length; i += maxLength) {
        chunks.push(message.slice(i, i + maxLength));
    }
    return chunks;
}

class TelegramNotifier {
    constructor() {
        this.bot = new TelegramBot(telegramKeys.telegramToken, { polling: false });
        this.chatId = telegramKeys.chatId;
        this.logChatId = telegramKeys.logChatId;
    }

    async sendMainMessage(message) {
        try {
            console.log("Відправка повідомлення до основного чату Telegram:\n", message);
            await this.bot.sendMessage(this.chatId, message);
            console.log("Повідомлення відправлено в основний чат!");
        } catch (error) {
            console.error("Помилка відправки основного повідомлення Telegram:", error);
        }
    }

    async sendLog(message) {
        try {
            console.log("Відправка лог-повідомлення до Telegram:\n", message);
            const messageChunks = splitMessage(message, 4000);
            for (const chunk of messageChunks) {
                await this.bot.sendMessage(this.logChatId, chunk);
            }
            console.log("Лог повідомлення відправлено в групу логів!");
        } catch (error) {
            console.error("Помилка відправки лог повідомлення Telegram:", error);
        }
    }
}

export default TelegramNotifier;

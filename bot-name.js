require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('Переменная TELEGRAM_BOT_TOKEN не найдена в .env');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: false });

bot
  .getMe()
  .then((me) => {
    console.log(`Имя бота: ${me.first_name}`);
    console.log(`Юзернейм: @${me.username}`);
    console.log(`ID: ${me.id}`);
  })
  .catch((err) => {
    console.error('Ошибка при получении данных бота:', err.message);
    process.exit(1);
  });




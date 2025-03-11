require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');

// Отключение проверки сертификатов (НЕБЕЗОПАСНО)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Telegram Bot Token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Хранилище статусов и номеров телефонов для каждого chatId
const TG_REG_STATUS = {}; // { chatId: "START" | "CONTACT" | "CONFIRM" | "HAS_TOKEN" }
const TG_PHONE = {}; // 79785667199
const TG_TOKEN = {}; // 03E35E5B2A7DC5DD2B264AC86A7A51C6

// Функция для установки текущего номера телефона
function setPhone(chatId, phone) {
  TG_PHONE[chatId] = phone;
  console.log(`Chat ID: ${chatId}, Phone updated to: ${phone}`);
}
// Функция для получения текущего телефона
function getPhone(chatId) {
  return TG_PHONE[chatId] || undefined; 
}

// Функция для установки текущего состояния
function setStatus(chatId, status) {
  TG_REG_STATUS[chatId] = status;
  console.log(`Chat ID: ${chatId}, Status updated to: ${status}`);
}
// Функция для получения текущего состояния
function getStatus(chatId) {
  return TG_REG_STATUS[chatId] || 'START'; // По умолчанию статус 'START'
}

// Функция для установки текущего состояния
function setToken(chatId, token) {
  TG_TOKEN[chatId] = token;
  console.log(`Chat ID: ${chatId}, Token updated to: ${token}`);
}
// Функция для получения текущего состояния
function getToken(chatId) {
  return TG_TOKEN[chatId] || undefined;
}


// Базовые настройки для API
const baseOptions = {
  hostname: process.env.API_HOSTNAME,
  port: process.env.API_PORT,
  headers: {
    'Content-Type': 'application/json',
    apikey: process.env.API_KEY,
    Authorization: process.env.AUTHORIZATION,
  },
};

// Функция для формирования настроек запроса
function createOptions(method, endpoint) {
  return {
    ...baseOptions,
    method,
    path: `${process.env.API_PATH}/${endpoint}`,
  };
}

// Функция для отправки POST-запроса с кодом подтверждения
async function sendPostRequestConfirmPhone(phoneNumber, authType, chatId, confirmationCode = undefined) {
  const apiEndpoint = 'confirm_phone';
  const postData = confirmationCode && confirmationCode.length >= 4
    ? JSON.stringify({
        phone: phoneNumber,
        confirmation_code: confirmationCode,
      })
    : JSON.stringify({
        phone: phoneNumber,
        auth_type: authType,
      });
  console.log(postData);
  const options = createOptions('POST', apiEndpoint);

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const response = JSON.parse(data);
        console.log('Ответ от API:', response); // Логируем ответ от API

        if (response.result) {
          if (confirmationCode) {
            resolve(response.data.pass_token);
          }
          else {
            resolve(response.result); // Возвращаем только результат
          }
        } else {
          if (confirmationCode) {
            reject(new Error('Код неверный')); // Отправляем ошибку
          }
          else {
            reject(new Error('Попробуйте позже подтвердить номер телефона')); // Отправляем ошибку
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error('Ошибка при отправке запроса:', error);
      reject(error); // Отправляем ошибку
    });

    req.write(postData);
    req.end();
  });
}

// Обработчик команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  let currentStatus = getStatus(chatId);
  if (currentStatus !== "CONTACT" && currentStatus !== "CONFIRM" && currentStatus !== "HAS_TOKEN") {  
    // Установить статус на START
    setStatus(chatId, 'START');
  } else {
    if (currentStatus == "CONTACT") {
      let phoneNumber = getPhone(chatId);
      // Запросить метод подтверждения
      tgSendConfirmationMethod(bot, chatId, phoneNumber);
      return;
    }
    if (currentStatus == "CONFIRM") {
      bot.sendMessage(chatId, `Введите 4-х значный код подтверждения`);
      return;
    }
    if (currentStatus == "HAS_TOKEN") {
      bot.sendMessage(chatId, `Мы вас уже знаем`);
      return;
    }
  }

  bot.sendMessage(chatId, 'Привет! Пожалуйста, поделитесь своим контактом.', {
    reply_markup: {
      keyboard: [
        [
          {
            text: 'Поделиться контактом',
            request_contact: true,
          },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
});

// Обработчик получения контакта
bot.on('contact', (msg) => {
  const chatId = msg.chat.id;
  const phoneNumber = msg.contact.phone_number;
  setPhone(chatId, phoneNumber);
  
  // Установить статус на CONTACT
  setStatus(chatId, 'CONTACT');

  // Запросить метод подтверждения
  tgSendConfirmationMethod(bot, chatId, phoneNumber);
});

function tgSendConfirmationMethod(bot, chatId, phoneNumber) {
  bot.sendMessage(chatId, `Как вы хотите получить код подтверждения на ${phoneNumber}?`, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Код на WhatsApp', callback_data: `api:confirm_phone:post:whats_app:${phoneNumber}:${chatId}` },
          { text: 'Код по звонку (по последним 4 цифрам)', callback_data: `api:confirm_phone:post:call:${phoneNumber}:${chatId}` },
        ],
      ],
    },
  });
}
// Обработчик нажатий на inline-кнопки
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;

  if (query.data.startsWith('api:')) {
    if (query.data.startsWith('api:confirm_phone:post:') && TG_REG_STATUS[chatId]) {
      const [api, confirm_phone, post, authType, phoneNumber, storedChatId] = query.data.split(':');

      if (authType === 'call') {
        bot.sendMessage(storedChatId, `Звоним вам на номер ${phoneNumber}\nОтправьте последние 4 цифры звонящего номера в ответном сообщении`);
      }
      else {
        bot.sendMessage(storedChatId, `Отправил вам код на WhatsApp ${phoneNumber}\nОтправьте 4-х значный код в ответном сообщении`);
      }

      try {
        // Отправка POST-запроса с выбранным authType и ожидание результата
        const result = await sendPostRequestConfirmPhone(phoneNumber, authType, storedChatId);
        console.log('Результат от API:', result);
      } catch (error) {
        console.error('Ошибка при подтверждении номера:', error.message);
        bot.sendMessage(storedChatId, 'Не удалось подтвердить номер телефона. Повторите попытку.');
      }

      // Установить статус на CONFIRM
      setStatus(chatId, 'CONFIRM');
    }
  } else {
    bot.sendMessage(chatId, 'Эта кнопка не требует работы с API.');
  }
});

// Обработка подтверждения кода
bot.onText(/^\d{4}$/, async (msg) => {
  const chatId = msg.chat.id;
  const confirmationCode = msg.text;

  if (getStatus(chatId) === 'CONFIRM') {
    bot.sendMessage(chatId, `Код подтверждения: ${confirmationCode}. Проверяем...`);
    let phoneNumber = getPhone(chatId);
    try {
      // Отправка кода подтверждения
      const userToken = await sendPostRequestConfirmPhone(phoneNumber, 'code_verification', chatId, confirmationCode);

      if (userToken) {
        setToken(chatId, userToken);
        setStatus(chatId, 'HAS_TOKEN');
        bot.sendMessage(chatId, 'Номер успешно подтверждён! Ваш токен: ' + userToken);
      }
    } catch (error) {
      bot.sendMessage(chatId, 'Неверный 4-х значный код. Отправьте код ещё раз в ответом сообщении или запросите новый код /start\n' + error);
      setStatus(chatId, 'CONTACT');
    }
  } else {
    bot.sendMessage(chatId, 'Вы пока не на этапе подтверждения. Начните с команды /start.');
  }
});

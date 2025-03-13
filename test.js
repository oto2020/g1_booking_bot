require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, 'Пожалуйста, поделитесь своим контактом:', {
    reply_markup: {
      keyboard: [
        [{ text: 'Отправить контакт', request_contact: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const phone = '79782449190';//;
  await getAnketaForPhone(msg.contact.phone_number.replace('+', ''), chatId);
});

bot.on('message', async (msg) => {
  if (msg.from.is_bot || msg.text == '/start') return;
  console.log('bot.on message');
  const chatId = msg.chat.id;
  console.log(msg.text);
  const {phone, comment} = parseMessage(msg.text);
  console.log(`phone: ${phone}, comment: ${comment}`);
  await getAnketaForPhone(phone, chatId);
})

async function getAnketaForPhone(phone, chatId) {
  // Генерация подписи
  const sign = crypto.createHash('sha256')
    .update('phone:' + phone + ";key:" + process.env.SECRET_KEY)
    .digest('hex');

  const passTokenUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/pass_token/?phone=${phone}&sign=${sign}`;

  try {
    const passTokenResponse = await axios.get(passTokenUrl, {
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.API_KEY,
        Authorization: process.env.AUTHORIZATION
      }
    });

    if (passTokenResponse.data.result && passTokenResponse.data.data.pass_token) {
      const passToken = passTokenResponse.data.data.pass_token;

      let ticketsText = await getTicketsText(passToken);

      let clientResponse = await getClientResponse(passToken);

      if (clientResponse.data.result) {
        const client = clientResponse.data.data;
        const id = client.id;
        const name = `${client.name} ${client.last_name}`;
        const phone = `${client.phone}`;
        const birthDate = new Date(client.birthday).toLocaleDateString("ru-RU");
        const photo = client.photo;
        const tags = client.tags.map(tag => `#${tag.title}`).join('\n');

        let tag = "ХОЧЕТ НА ВПТ";
        try {
          await addTag(passToken, id, tag);
          await bot.sendMessage(chatId, `Установлен тег: "${tag}"`);
        } catch (e) {
          await bot.sendMessage(chatId, `Не удалось установить тег "${tag}"`);
        }

        // try {
        //   await deleteTag(passToken, id, tag);
        //   await bot.sendMessage(chatId, `Удален тег "${tag}"`);
        // } catch (e) {
        //   console.error(e);
        //   await bot.sendMessage(chatId, `Не удалось удалить тег "${tag}"`);
        // }

        let captionText = `Имя: ${name}\nТелефон: ${phone}\nДата рождения: ${birthDate}\n${tags}\n\nБилеты:\n${ticketsText}`;
        const fileId = await downloadAndSendPhoto(chatId, photo, captionText);

        if (fileId) {
          console.log(`Photo file_id: ${fileId}`);
        }
      } else {
        bot.sendMessage(chatId, 'Ошибка при получении данных клиента.');
      }
    } else {
      bot.sendMessage(chatId, 'Ошибка при получении токена, попробуйте позже.');
    }
  } catch (error) {
    bot.sendMessage(chatId, 'Ошибка соединения с сервером.');
    console.error(error);
  }

}

async function downloadAndSendPhoto(chatId, photoUrl, captionText) {
  try {
    const headers = {
      'Authorization': process.env.AUTHORIZATION,
      'apikey': process.env.API_KEY
    };
    const response = await axios.get(photoUrl, {
      headers,
      responseType: 'arraybuffer'
    });

    const filePath = path.join(__dirname, 'photo.jpg');
    fs.writeFileSync(filePath, response.data);

    const sentMessage = await bot.sendPhoto(chatId, filePath, {
      caption: captionText,
      parse_mode: 'Markdown'
    });

    const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id;

    fs.unlinkSync(filePath);

    return fileId;
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    bot.sendMessage(chatId, 'Не удалось загрузить фото.');
    return null;
  }
}

function translateStatus(status) {
  const translations = {
    "active": "🟢 Активно",
    "not_active": "💸 Продано, не активно",
    "frozen": "🟠Заморожено",
    "locked": "🔐 Заблокировано",
    "closed": "❌ Закрыто"
  };

  return translations[status] || "Неизвестный статус";
}

// добавить тег
async function addTag(userToken, clientId, tag) {
  // Отправка POST-запроса на /tag
  const tagUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tag`;
  await axios.post(tagUrl, {
    tag: tag,
    client_id: clientId
  }, {
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.API_KEY,
      Authorization: process.env.AUTHORIZATION,
      usertoken: userToken
    }
  });
}

// удалить тег
async function deleteTag(userToken, clientId, tag) {
  // Отправка POST-запроса на /tag
  const tagUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tag?tag=${tag}&client_id=${clientId}`;
  await axios.delete(tagUrl, {
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.API_KEY,
      Authorization: process.env.AUTHORIZATION,
      usertoken: userToken
    }
  });
}

// Текст с информацией о членствах/пакетах/услугах
async function getTicketsText(passToken) {
  const ticketsUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/tickets`;
  const ticketsResponse = await axios.get(ticketsUrl, {
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.API_KEY,
      Authorization: process.env.AUTHORIZATION,
      usertoken: passToken
    }
  });
  function getMembershipServices(el) {
    return (el.type == 'membership' && el.service_list && el.service_list.length > 0)
      ? 'Не использовано:\n' + el.service_list.map(ss => `➖${ss.title}\nОстаток: ${ss.count}(${ss.count_reserves})`).join('\n') + '\n'
      : '';
  }
  function getEndDate(el) {
    return (el.end_date) ? '(до ' + new Date(el.end_date).toLocaleDateString("ru-RU") + ')\n' : '';
  }
  function getPackageCount(el) {
    return (el.type == 'package' && el.count) ? `Остаток: ${el.count}\n` : '';
  }
  if (ticketsResponse.data) {
    let txt = ticketsResponse.data.data.map(el => `${translateStatus(el.status)}: ${el.title}\n${getEndDate(el)}${getPackageCount(el)}${getMembershipServices(el)}`).join('\n');
    return txt;
  } else {
    return "Нет информации о доступных услугах."
  }
}

// получить клиента
async function getClientResponse(passToken) {
  const clientUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/client`;
  const clientResponse = await axios.get(clientUrl, {
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.API_KEY,
      Authorization: process.env.AUTHORIZATION,
      usertoken: passToken
    }
  });
  return clientResponse;
}

// +7(978) 566-71-99 хочет на ВПТ
// переводит в phone: 79785667199, comment: "хочет на ВПТ"
function parseMessage(message) {
  let match = message.match(/([+8]?\d?[\s\-\(\)]*\d{3}[\s\-\(\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2})([\s\S]*)/);
  
  if (!match) return null;
  
  let rawPhone = match[1];
  let comment = match[2].trim().replace(/\s+/g, " "); // Убираем лишние пробелы и переносы строк
  
  // Очищаем номер от лишних символов
  let phone = rawPhone.replace(/\D/g, "");
  
  // Приводим к стандартному формату (добавляем 7, если 10 цифр, но не трогаем если уже 11 и начинается на 7)
  if (phone.length === 10) {
      phone = "7" + phone;
  } else if (phone.length === 11 && phone.startsWith("8")) {
      phone = "7" + phone.slice(1);
  } else if (phone.length === 11 && phone.startsWith("+7")) {
      phone = "7" + phone.slice(2);
  }
  
  return { phone: phone, comment: comment };
}
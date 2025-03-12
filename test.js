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
  const phone = '79782449190';//msg.contact.phone_number.replace('+', '');

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

      const clientUrl = `https://${process.env.API_HOSTNAME}:${process.env.API_PORT}${process.env.API_PATH}/client`;
      const clientResponse = await axios.get(clientUrl, {
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.API_KEY,
          Authorization: process.env.AUTHORIZATION,
          usertoken: passToken
        }
      });

      if (clientResponse.data.result) {
        const client = clientResponse.data.data;
        const id = client.id;
        const name = `${client.name} ${client.last_name}`;
        const phone = `${client.phone}`;
        const birthDate = new Date(client.birthday).toLocaleDateString("ru-RU");
        const photo = client.photo;
        const tags = client.tags.map(tag => `#${tag.title}`).join('\n');


        bot.sendMessage(chatId, `Имя: ${name}\nТелефон:${phone}\nДата рождения: ${birthDate}\n${tags}`);
        const headers = {
          'Authorization': process.env.AUTHORIZATION,
          'apikey': process.env.API_KEY
        };

        const fileId = await downloadAndSendPhoto(chatId, photo, headers);

        if (fileId) {
          bot.sendMessage(chatId, `Идентификатор фото: \`${fileId}\``, { parse_mode: 'Markdown' });
        }



        let tag = "ХОЧЕТ НА ВПТ";
        // try {
        //   await addTag(passToken, client.id, tag);
        //   await bot.sendMessage(chatId, `Установлен тег: "${tag}"`);
        // } catch (e) {
        //   await bot.sendMessage(chatId, `Не удалось установить тег "${tag}"`);
        // }

        try {
          await deleteTag(passToken, client.id, tag);
          await bot.sendMessage(chatId, `Удален тег "${tag}"`);
        } catch (e) {
          console.error(e);
          await bot.sendMessage(chatId, `Не удалось удалить тег "${tag}"`);
        }


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
          let txt = ticketsResponse.data.data.map(el=>`${translateStatus(el.status)}: ${el.title}\n${getEndDate(el)}${getPackageCount(el)}${getMembershipServices(el)}`).join('\n');
          bot.sendMessage(chatId, txt);
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
});


function translateStatus(status) {
  const translations = {
    "active": "🟢 Активно",
    "not_active": "💸 Не активно",
    "frozen": "🟠Заморожено",
    "locked": "🔐 Заблокировано",
    "closed": "❌ Закрыто"
  };

  return translations[status] || "Неизвестный статус";
}

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

async function downloadAndSendPhoto(chatId, photoUrl, headers) {
  try {
    const response = await axios.get(photoUrl, {
      headers,
      responseType: 'arraybuffer'
    });

    const filePath = path.join(__dirname, 'photo.jpg');
    fs.writeFileSync(filePath, response.data);

    const sentMessage = await bot.sendPhoto(chatId, filePath);
    const fileId = sentMessage.photo[sentMessage.photo.length - 1].file_id; // Берем наибольшее качество

    console.log('Photo file_id:', fileId); // Выводим file_id в консоль

    fs.unlinkSync(filePath); // Удаляем файл после отправки

    return fileId;
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    bot.sendMessage(chatId, 'Не удалось загрузить фото.');
    return null;
  }
}
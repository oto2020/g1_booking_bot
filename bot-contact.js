function rememberAppointmentToken(chatId, cfgKey, cls) {
  if (!appointmentTokens[chatId]) appointmentTokens[chatId] = {};
  const token = Math.random().toString(36).slice(2, 8);
  appointmentTokens[chatId][token] = {
    cfgKey,
    appointment_id: cls.appointment_id || cls.id,
    service_id: cls.service?.id,
    club_id: cls.club?.id,
    raw: cls,
  };
  return token;
}

function resolveAppointmentToken(chatId, token) {
  return appointmentTokens[chatId]?.[token] || null;
}

function ensureAppointmentToken(chatId, cfgKey, cls) {
  if (!appointmentTokens[chatId]) appointmentTokens[chatId] = {};
  const apptId = cls.appointment_id || cls.id;
  const existingEntry = Object.entries(appointmentTokens[chatId]).find(
    ([, info]) => info.appointment_id === apptId
  );
  if (existingEntry) {
    const [tok, info] = existingEntry;
    appointmentTokens[chatId][tok] = { ...info, raw: cls };
    return tok;
  }
  const tok = rememberAppointmentToken(chatId, cfgKey, cls);
  appointmentTokens[chatId][tok].raw = cls;
  return tok;
}

function rememberPurchaseToken(chatId, cfgKey, item) {
  if (!purchaseTokens[chatId]) purchaseTokens[chatId] = {};
  const token = Math.random().toString(36).slice(2, 8);
  purchaseTokens[chatId][token] = {
    cfgKey,
    purchase_id: item.id || item.purchase_id,
    raw: item,
  };
  return token;
}

function resolvePurchaseToken(chatId, token) {
  return purchaseTokens[chatId]?.[token] || null;
}
// Бот, который один раз просит контакт и сохраняет его в JSON.
// Поведение:
// - /start впервые → отправляет кнопку "Поделиться контактом"
// - После контакта убирает клавиатуру, сохраняет данные и здоровается
// - При повторном /start, если контакт уже есть → сразу здоровается без запроса

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { ApiHelper } = require('./ApiHelper');

// Иногда тестовый контур с самоподписанным сертификатом
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Переменная TELEGRAM_BOT_TOKEN не найдена в .env');
  process.exit(1);
}

const STORE_PATH = path.join(__dirname, 'contacts-store.json');
const CLASSES_PATH = path.join(__dirname, 'classes.json');
const CLASSES_CACHE_PATH = path.join(__dirname, 'classes-cache.json');
const CACHE_PHONE = process.env.CACHE_PHONE || process.env.PHONE || process.env.DEFAULT_PHONE;

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function loadClassesConfig() {
  try {
    const raw = fs.readFileSync(CLASSES_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

function loadClassesCache() {
  try {
    const raw = fs.readFileSync(CLASSES_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function selectUpcomingByConfig(classes, cfg) {
  const now = new Date();
  const end = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  return classes
    .filter((cls) => {
      if (cls.canceled) return false;
      if (!cls.start_date) return false;
      const roomTitle = cls.room?.title || '';
      const serviceTitle = cls.service?.title || '';
      const byRoom = roomTitle === cfg.roomTitle;
      const hasRuble = serviceTitle.includes('₽');
      const start = new Date(cls.start_date);
      const inWindow = start > now && start <= end;
      return byRoom && hasRuble && inWindow;
    })
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
}

async function refreshCacheOnce(phoneOverride) {
  const phoneToUse = phoneOverride || CACHE_PHONE;
  if (!phoneToUse) throw new Error('CACHE_PHONE не задан и нет номера для обновления кэша');
  if (!classesConfig.length) throw new Error('classes.json пуст или не загружен');

  const passToken = await getPassTokenByPhone(phoneToUse);
  const client = await getClientByPassToken(passToken);
  const clubId = client?.club?.id;
  if (!clubId) throw new Error('clubId не найден у клиента (кэш)');

  const now = new Date();
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const toISO = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const classes = await getClasses(passToken, clubId, toISO(now), toISO(end));

  const result = {};
  classesConfig.forEach((cfg) => {
    result[cfg.key] = selectUpcomingByConfig(classes, cfg).map((cls) => ({
      appointment_id: cls.appointment_id || cls.id,
      start_date: cls.start_date,
      room_title: cls.room?.title || '',
      service_title: cls.service?.title || '',
      employee: cls.employee ? { id: cls.employee.id, name: cls.employee.name } : null,
    }));
  });

  fs.writeFileSync(
    CLASSES_CACHE_PATH,
    JSON.stringify(
      {
        updated_at: new Date().toISOString(),
        club_id: clubId,
        phone: phoneToUse,
        data: result,
      },
      null,
      2
    ),
    'utf8'
  );

  return result;
}

async function ensureCacheFresh(maxAgeMs = 30 * 60 * 1000, phoneFallback = null) {
  const cache = loadClassesCache();
  if (cache?.data) return cache.data;
  return {};
}

async function getPassTokenByPhone(phone) {
  return ApiHelper.getPassTokenByPhone(phone);
}

async function getClientByPassToken(passToken) {
  return ApiHelper.getClientByPassToken(passToken);
}

async function getTickets(passToken, type = 'membership') {
  return ApiHelper.getTickets(passToken, type);
}

function pickMembershipFromTickets(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    return { title: 'нет', expires: null, status: null, ticket_id: null };
  }

  // Сначала активные, потом любые
  const sorted = [...tickets].sort((a, b) => {
    const aActive = a.status === 'active' ? 0 : 1;
    const bActive = b.status === 'active' ? 0 : 1;
    return aActive - bActive;
  });

  const m = sorted[0];
  return {
    title: m.title || 'нет',
    expires: m.end_date || null,
    status: m.status || null,
    ticket_id: m.ticket_id || null,
    type: m.type || null,
  };
}

function buildFullName(client) {
  const parts = [
    client?.full_name,
    client?.fio,
    [client?.last_name, client?.name || client?.first_name, client?.middle_name].filter(Boolean).join(' '),
  ].find((v) => v && v.trim());

  return parts ? parts.trim() : null;
}

const store = loadStore();
const bot = new TelegramBot(token, { polling: true });
const classesConfig = loadClassesConfig();
const appointmentTokens = {};
const purchaseTokens = {};

// Меню команд
bot.setMyCommands([
  { command: '/start', description: 'Войти' },
  { command: '/exit', description: 'Выйти' },
  { command: '/book', description: 'Записаться' },
  { command: '/my_purchases', description: 'Что у меня куплено' },
  { command: '/my_classes', description: 'Запланированные тренировки' }
]);

async function refreshFromOneC(chatId, record) {
  let passToken = record?.oneC?.usertoken || null;
  let client = null;

  // Пробуем текущий токен
  if (passToken) {
    try {
      client = await getClientByPassToken(passToken);
    } catch (err) {
      console.warn('Кэшированный usertoken не подошёл, пробуем обновить:', err.message);
      passToken = null;
    }
  }

  // Если токен не валиден — обновляем по телефону
  if (!passToken) {
    const phone = record?.telegram?.phone;
    if (!phone) throw new Error('Нет сохранённого телефона для обновления данных');
    passToken = await getPassTokenByPhone(phone);
    client = await getClientByPassToken(passToken);
  }

  // Членства
  const tickets = await getTickets(passToken, 'membership');
  const membership = pickMembershipFromTickets(tickets);

  const fullName =
    buildFullName(client) ||
    record?.telegram?.first_name ||
    record?.telegram?.username ||
    'клиент';

  const updated = {
    telegram: record?.telegram || {},
    oneC: {
      fullName,
      membership,
      clientId: client?.id || null,
      clubId: client?.club?.id || null,
      usertoken: passToken,
    },
    saved_at: new Date().toISOString(),
    status: 'active',
  };

  store[chatId] = updated;
  saveStore(store);

  return updated;
}

function membershipLine(membership) {
  const title = membership?.title || 'нет';
  const expires = membership?.expires;
  return title === 'нет'
    ? 'Членство: нет'
    : `Членство: ${title}${expires ? `, до ${expires}` : ''}`;
}

function statusLabel(status) {
  switch (status) {
    case 'active':
      return '✅ Активно';
    case 'not_active':
      return '🟡 Продано (не активно)';
    case 'frozen':
      return '🧊 Заморожено';
    case 'locked':
      return '🔒 Заблокировано';
    case 'closed':
      return '⛔️ Закрыто';
    default:
      return '❔ Неизвестно';
  }
}

function ticketLine(ticket) {
  const title = ticket.title || 'Без названия';
  const type = ticket.type === 'package' ? 'Пакет' : 'Членство';
  const status = statusLabel(ticket.status);
  const end = ticket.end_date ? `, до ${ticket.end_date}` : '';
  return `- ${type}: ${title} — ${status}${end}`;
}

function formatClassLabel(cls, options = {}, cfg = null) {
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const d = new Date(cls.start_date);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const weekday = wd[d.getDay()] || '';

  const title = cls.service_title || cls.service?.title || 'Занятие';
  const trainerFull = cls.employee?.name || cls.employee_name || 'Тренер не указан';
  const trainerLast = trainerFull.split(' ')[0] || trainerFull;

  const canceled = cls.canceled === true;
  const recorded =
    cls.recorded ||
    cls.is_recorded ||
    cls.enrolled ||
    cls.in_record ||
    cls.client_enrolled ||
    cls.already_booked ||
    false;
  const em = (cfg && cfg.emojis) || {};
  const availableEmoji = em.available || '🚲';
  const recordedEmoji = em.recorded || '🚴';
  const canceledEmoji = em.canceled || '❌';
  const defaultEmoji = em.default || '✖️';
  const pendingEmoji = em.pending || '🕒';

  const statusEmoji = options.hideStatus
    ? pendingEmoji
    : canceled
    ? canceledEmoji
    : recorded
    ? recordedEmoji
    : availableEmoji;

  // День и месяц скрыты, но добавлен день недели
  const prefix = options.hideStatus ? `${statusEmoji} ` : `${statusEmoji} `;
  return `${prefix}${weekday} ${time}, ${title}, ${trainerLast}`;
}

function statusEmojiOfClass(cls, cfg) {
  const em = (cfg && cfg.emojis) || {};
  const availableEmoji = em.available || '🚲';
  const recordedEmoji = em.recorded || '🚴';
  const canceledEmoji = em.canceled || '❌';
  const defaultEmoji = em.default || '✖️';

  const canceled = cls.canceled === true;
  const free = Number(cls.free_places ?? cls.free_count ?? cls.free ?? cls.available_count ?? 0);
  const recorded =
    cls.recorded ||
    cls.is_recorded ||
    cls.enrolled ||
    cls.in_record ||
    cls.client_enrolled ||
    cls.already_booked ||
    false;

  // Пока не открыто детальное занятие, мы не знаем точное число мест.
  // Если не отменено и не записан клиент — считаем, что потенциально есть места → показываем available.
  if (canceled) return canceledEmoji;
  if (recorded) return recordedEmoji;
  return availableEmoji;
}

function mergeClassDescription(cls, desc) {
  if (!desc) return cls;
  const available =
    desc.available_slots === 'unlimited'
      ? Number.MAX_SAFE_INTEGER
      : desc.available_slots !== undefined
      ? Number(desc.available_slots)
      : cls.free_places ?? null;
  return {
    ...cls,
    free_places: available,
    capacity: desc.capacity ?? cls.capacity ?? null,
    canceled: desc.canceled ?? cls.canceled ?? false,
    already_booked: desc.already_booked ?? cls.already_booked ?? false,
    recorded:
      desc.already_booked ??
      cls.recorded ??
      cls.is_recorded ??
      cls.enrolled ??
      cls.in_record ??
      cls.client_enrolled ??
      false,
  };
}

async function ensurePassToken(chatId, existing) {
  if (existing?.oneC?.usertoken) return existing.oneC.usertoken;
  const updated = await refreshFromOneC(chatId, existing || {});
  store[chatId] = updated;
  saveStore(store);
  return updated.oneC.usertoken;
}

async function getClasses(passToken, clubId, startDate, endDate) {
  return ApiHelper.getClasses(passToken, clubId, startDate, endDate);
}

async function getPricelist(passToken) {
  return ApiHelper.getPricelist(passToken);
}

async function getClassDescriptions(passToken, appointmentIds) {
  return ApiHelper.getClassDescriptions(passToken, appointmentIds);
}

async function cancelClassBooking(passToken, appointmentId) {
  return ApiHelper.cancelClassBooking(passToken, appointmentId);
}

async function suggestPurchaseOptions(chatId, cfg, passToken, classInfo) {
  const catalogTitle = cfg.catalogTitle;
  if (!catalogTitle) {
    return;
  }
  try {
    // Определяем, есть ли активное членство
    const ticketsAll = await getTickets(passToken, null);
    const hasActiveMembership = ticketsAll.some(
      (t) => t.type === 'membership' && t.status === 'active'
    );

    const pricelist = await getPricelist(passToken);
    const byCatalog = pricelist.filter((item) => {
      if (!item.category) return false;
      if (typeof item.category === 'object' && item.category.title) {
        return item.category.title === catalogTitle;
      }
      return false;
    });

    const filtered = byCatalog.filter((item) => {
      const title = item.title || item.name || item.title_ru || '';
      const hasNotCK = title.includes('Не ЧК');
      if (hasActiveMembership) {
        // Есть членство → показываем только варианты без "Не ЧК"
        return !hasNotCK;
      }
      // Нет членства → показываем только "Не ЧК"
      return hasNotCK;
    });

    if (filtered.length === 0) {
      await bot.sendMessage(
        chatId,
        `Подходящие варианты для покупки в каталоге "${catalogTitle}" не найдены. Обратитесь на рецепцию.`
      );
      return;
    }

    // Сортируем варианты по стоимости по возрастанию
    const sorted = [...filtered].sort((a, b) => {
      const pa = a.price_with_discount ?? a.price;
      const pb = b.price_with_discount ?? b.price;
      const va = pa != null ? parseFloat(pa) : Number.MAX_SAFE_INTEGER;
      const vb = pb != null ? parseFloat(pb) : Number.MAX_SAFE_INTEGER;
      return va - vb;
    });

    const top = sorted.slice(0, 5);
    const keyboard = top.map((item) => {
      const price = item.price_with_discount ?? item.price ?? '';
      const text = `${item.title || item.name || 'Без названия'}${price ? ` — ${price} ₽` : ''}`;
      const tok = rememberPurchaseToken(chatId, cfg.key, item);
      return [
        {
          text,
          callback_data: `buy:${cfg.key}:${tok}`,
        },
      ];
    });

    // Кнопка закрытия под списком вариантов
    keyboard.push([
      {
        text: '↩️ Закрыть',
        callback_data: 'close:buy:0',
      },
    ]);

    let header = `Вы можете приобрести подходящие тренировки в каталоге "${catalogTitle}":`;
    if (classInfo) {
      const { weekday, time, title, trainerFull } = classInfo;
      header += `\nПосле оплаты вы будете записаны на:\n${weekday} ${time}\nУслуга: ${title}\nТренер: ${trainerFull}`;
    }

    await bot.sendMessage(chatId, header, {
      reply_markup: {
        inline_keyboard: keyboard,
      },
    });
  } catch (error) {
    console.error('Ошибка suggestPurchaseOptions:', error.message);
    await bot.sendMessage(
      chatId,
      'Не удалось получить список вариантов для покупки. Попробуйте позже или обратитесь на рецепцию.'
    );
  }
}

async function tryBookClass(passToken, appointmentId) {
  // FIXME: Реальный вызов API записи не реализован, возвращаем отказ
  return {
    success: false,
    reason: 'Запись через API не реализована в этом боте.',
  };
}

bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  const existing = store[chatId];

  // Если есть данные — актуализируем из 1С
  if (existing) {
    if (existing.status === 'logged_out') {
      // Сбрасываем статус выхода
      delete existing.status;
      delete existing.logged_out_at;
    }
    try {
      const updated = await refreshFromOneC(chatId, existing);
      const name =
        updated?.oneC?.fullName ||
        updated?.telegram?.first_name ||
        updated?.telegram?.username ||
        'друг';
    await bot.sendMessage(
      chatId,
      `Привет, ${name}! Рад снова тебя видеть 👋\n${membershipLine(updated.oneC.membership)}`
    );
      return;
    } catch (err) {
      console.warn('Не удалось обновить данные из 1С, запросим контакт:', err.message);
    }
  }

  const opts = {
    reply_markup: {
      keyboard: [[{ text: '📱 Поделиться контактом', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  };

  await bot.sendMessage(
    chatId,
    'Привет! Нажми кнопку ниже, чтобы поделиться контактом ⬇️',
    opts
  );
});

bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const contact = msg.contact;

  // Если пользователь помечен как вышедший
  const existing = store[chatId];
  if (existing?.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  // Защита: принимаем контакт только от того же пользователя
  if (contact && contact.user_id && msg.from && contact.user_id !== msg.from.id) {
    await bot.sendMessage(
      chatId,
      'Нужно отправить свой контакт через кнопку "Поделиться контактом".'
    );
    return;
  }

  if (!contact || !contact.phone_number) {
    await bot.sendMessage(chatId, 'Не удалось прочитать контакт. Попробуй ещё раз /start.');
    return;
  }

  // Убираем клавиатуру
  const removeKeyboard = { reply_markup: { remove_keyboard: true } };

  try {
    let passToken = store[chatId]?.oneC?.usertoken || null;
    let client = null;

    // Пробуем существующий токен, если есть
    if (passToken) {
      try {
        client = await getClientByPassToken(passToken);
      } catch (err) {
        console.warn('Кэшированный usertoken не подошёл, запрашиваю новый:', err.message);
        passToken = null;
      }
    }

    // Если токена нет или не сработал — запрашиваем новый
    if (!passToken) {
      passToken = await getPassTokenByPhone(contact.phone_number);
      client = await getClientByPassToken(passToken);
    }

    // Получаем членства/абонементы (tickets)
    const tickets = await getTickets(passToken, 'membership');
    const membership = pickMembershipFromTickets(tickets);

    // 4. Формируем данные
    const fullName = buildFullName(client) || contact.first_name || msg.from?.first_name || 'клиент';

    store[chatId] = {
      telegram: {
        first_name: contact.first_name || msg.from?.first_name,
        last_name: contact.last_name || msg.from?.last_name,
        phone: contact.phone_number,
        username: msg.from?.username,
        user_id: contact.user_id || msg.from?.id,
      },
      oneC: {
        fullName,
        membership,
        clientId: client?.id || null,
        clubId: client?.club?.id || null,
        usertoken: passToken,
      },
      saved_at: new Date().toISOString(),
      status: 'active',
    };
    saveStore(store);

    const membershipLine =
      membership.title === 'нет'
        ? 'Членство: нет'
        : `Членство: ${membership.title}${membership.expires ? `, до ${membership.expires}` : ''}`;

    await bot.sendMessage(
      chatId,
      `Спасибо, ${fullName}! Контакт получил.\n${membershipLine}`,
      removeKeyboard
    );
  } catch (error) {
    console.error('Ошибка при обработке контакта:', error.message);
    await bot.sendMessage(
      chatId,
      `Ваша карточка не найдена в базе. Обратитесь на рецепцию или в отдел продаж, чтобы они внесли ваш номер (${contact.phone_number}) в карточку или завели новую карточку`,
      removeKeyboard
    );
  }
});

// Команда/кнопка "Выйти"
bot.onText(/^\/exit$/, async (msg) => {
  const chatId = msg.chat.id;
  if (store[chatId]) {
    store[chatId].status = 'logged_out';
    store[chatId].logged_out_at = new Date().toISOString();
    saveStore(store);
  }
  await bot.sendMessage(chatId, 'Вы вышли. Чтобы войти снова, нажмите /start.', {
    reply_markup: { remove_keyboard: true },
  });
});

// Команда "Записаться"
bot.onText(/^\/book$/, async (msg) => {
  const chatId = msg.chat.id;
  const existing = store[chatId];

  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }

  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  if (!classesConfig.length) {
    await bot.sendMessage(chatId, 'Список направлений пока пуст.');
    return;
  }

  const keyboard = classesConfig.map((c) => [
    { text: c.button || c.roomTitle, callback_data: `cls:${c.key}` },
  ]);

  await bot.sendMessage(chatId, 'Выберите направление:', {
    reply_markup: { inline_keyboard: keyboard },
  });
});

// Команда "Что у меня куплено"
bot.onText(/^\/my_purchases$/, async (msg) => {
  const chatId = msg.chat.id;
  const existing = store[chatId];

  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }

  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  try {
    const passToken = await ensurePassToken(chatId, existing);
    const tickets = await getTickets(passToken, null);

    // Фильтруем только членства и пакеты услуг
    const membershipsAndPackages = tickets.filter(
      (t) => t.type === 'membership' || t.type === 'package'
    );

    if (membershipsAndPackages.length === 0) {
      await bot.sendMessage(chatId, 'У вас нет активных членств и пакетов услуг.');
      return;
    }

    // Формируем сообщение для каждого билета
    const lines = ['📦 Что у вас куплено:\n'];

    for (const ticket of membershipsAndPackages) {
      const typeEmoji = ticket.type === 'membership' ? '🎫' : '📋';
      const typeName = ticket.type === 'membership' ? 'Членство' : 'Пакет услуг';
      
      lines.push(`${typeEmoji} ${typeName}: ${ticket.title}`);

      // Статус
      let statusEmoji = '❓';
      let statusText = ticket.status || 'неизвестно';
      if (ticket.status === 'active') {
        statusEmoji = '✅';
        statusText = 'Активно';
      } else if (ticket.status === 'not_active') {
        statusEmoji = '⏸️';
        statusText = 'Не активно';
      } else if (ticket.status === 'frozen') {
        statusEmoji = '❄️';
        statusText = 'Заморожено';
      } else if (ticket.status === 'locked') {
        statusEmoji = '🔒';
        statusText = 'Заблокировано';
      } else if (ticket.status === 'closed') {
        statusEmoji = '🔴';
        statusText = 'Закрыто';
      }
      lines.push(`   Статус: ${statusEmoji} ${statusText}`);

      // Срок действия
      if (ticket.end_date) {
        const endDate = new Date(ticket.end_date);
        const formattedDate = endDate.toLocaleDateString('ru-RU', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
        lines.push(`   Срок действия: до ${formattedDate}`);
      }

      // Остаток услуг
      if (ticket.count !== null && ticket.count !== undefined) {
        lines.push(`   Остаток услуг: ${ticket.count}`);
      } else if (ticket.type === 'membership') {
        lines.push(`   Остаток услуг: безлимит`);
      }

      // Детали услуг (для пакетов)
      if (Array.isArray(ticket.service_list) && ticket.service_list.length > 0) {
        lines.push(`   Услуги в пакете:`);
        ticket.service_list.forEach((service) => {
          const serviceCount =
            service.count === null || service.count === undefined
              ? 'безлимит'
              : service.count;
          lines.push(`     • ${service.title}: ${serviceCount}`);
        });
      }

      lines.push(''); // Пустая строка между билетами
    }

    await bot.sendMessage(chatId, lines.join('\n'));
  } catch (error) {
    console.error('Ошибка при получении информации о покупках:', error.message);
    await bot.sendMessage(
      chatId,
      'Не удалось получить информацию о покупках. Попробуйте позже.'
    );
  }
});

// Команда "Запланированные тренировки"
bot.onText(/^\/my_classes$/, async (msg) => {
  const chatId = msg.chat.id;
  const existing = store[chatId];

  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }

  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  try {
    const passToken = await ensurePassToken(chatId, existing);
    
    // Получаем запланированные занятия клиента
    const appointments = await ApiHelper.getClientAppointments(passToken, {
      type: 'classes',
      statuses: ['planned'],
      requested_offset: 0,
      page_size: 50,
    });

    // Фильтруем только запланированные занятия (не отмененные)
    const now = new Date();
    const plannedClasses = appointments.filter((apt) => {
      if (apt.type !== 'classes') return false;
      if (apt.status !== 'planned') return false;
      if (apt.arrival_status === 'canceled' || apt.arrival_status === 'cancelled') return false;
      if (!apt.start_date) return false;
      // Показываем только будущие занятия
      const startDate = new Date(apt.start_date);
      return startDate > now;
    });

    // Сортируем по дате начала
    plannedClasses.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    if (plannedClasses.length === 0) {
      await bot.sendMessage(chatId, 'У вас нет запланированных тренировок.');
      return;
    }

    // Отправляем сообщение о количестве тренировок
    await bot.sendMessage(
      chatId,
      `📅 Запланированные тренировки: ${plannedClasses.length}\n\nОтправляю информацию о каждой тренировке...`
    );

    // Отправляем каждую тренировку отдельным сообщением с кнопками
    const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    
    for (const apt of plannedClasses) {
      const d = new Date(apt.start_date);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const weekday = wd[d.getDay()] || '';
      const date = d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
      
      const title = apt.service?.title || 'Занятие';
      const trainerFull = apt.employee?.name || 'Тренер не указан';
      const roomTitle = apt.room?.title || 'Зал не указан';

      // Формируем текст сообщения
      const lines = [
        `🚴 Тренировка`,
        ``,
        `📅 ${weekday}, ${date}`,
        `🕐 Время: ${time}`,
        `🎯 Услуга: ${title}`,
        `👤 Тренер: ${trainerFull}`,
        `🏠 Зал: ${roomTitle}`,
      ];

      // Добавляем информацию об оплате, если есть
      if (apt.payment) {
        lines.push(`💳 Оплата: ${apt.payment.title || 'Не указано'}`);
      }

      // Находим конфигурацию направления по названию зала
      const cfg = classesConfig.find((c) => c.roomTitle === roomTitle);
      const cfgKey = cfg?.key || 'unknown';

      // Создаем или находим токен для этого занятия
      const token = ensureAppointmentToken(chatId, cfgKey, {
        appointment_id: apt.appointment_id,
        id: apt.appointment_id,
        start_date: apt.start_date,
        service: apt.service,
        employee: apt.employee,
        room: apt.room,
        service_title: title,
        employee_name: trainerFull,
        club_id: apt.club?.id,
      });

      // Формируем кнопки
      const keyboard = {
        inline_keyboard: [
          [{ text: '❌ Отменить запись', callback_data: `unbook:${cfgKey}:${token}` }],
          [{ text: '↩️ Закрыть', callback_data: `close_myclass:${token}` }],
        ],
      };

      // Отправляем сообщение
      await bot.sendMessage(chatId, lines.join('\n'), {
        reply_markup: keyboard,
      });
    }
  } catch (error) {
    console.error('Ошибка при получении запланированных тренировок:', error.message);
    await bot.sendMessage(
      chatId,
      'Не удалось получить список запланированных тренировок. Попробуйте позже.'
    );
  }
});

async function handleSelectClassDirection(chatId, key) {
  const cfg = classesConfig.find((c) => c.key === key);
  if (!cfg) {
    await bot.sendMessage(chatId, 'Неизвестное направление.');
    return;
  }

  const existing = store[chatId];
  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }
  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  try {
    console.log(`handleSelectClassDirection key=${key} chat=${chatId}`);
    // Берём токен из store, если нет — обновляем профиль
    let passTokenForSlots = existing.oneC?.usertoken || null;
    let profile = existing;
    if (!passTokenForSlots) {
      const updatedUser = await refreshFromOneC(chatId, existing);
      passTokenForSlots = updatedUser.oneC.usertoken;
      profile = updatedUser;
      store[chatId] = updatedUser;
      saveStore(store);
    }

    // Берём только готовый кэш (без принудительного обновления)
    const cacheData = await ensureCacheFresh();
    const now = new Date();
    let upcoming = [];

    if (cacheData?.[key] && Array.isArray(cacheData[key])) {
      upcoming = cacheData[key]
        .filter((cls) => cls.start_date && new Date(cls.start_date) > now)
        .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    }

    // Если после кэша пусто — запасной живой запрос для этого пользователя
    if (!upcoming.length) {
      console.time(`refresh-${chatId}`);
      const updated = await refreshFromOneC(chatId, existing);
      console.timeEnd(`refresh-${chatId}`);

      console.time(`classes-${chatId}`);
      const passToken = updated.oneC.usertoken;
      const clubId = updated.oneC.clubId;
      if (!clubId) throw new Error('Не найден clubId клиента');

      const end = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 дня вперёд
      const toISO = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
      const classes = await getClasses(passToken, clubId, toISO(now), toISO(end));
      console.timeEnd(`classes-${chatId}`);

      console.time(`filter-${chatId}`);
      upcoming = selectUpcomingByConfig(classes, cfg);
      console.timeEnd(`filter-${chatId}`);

      // Обновляем passToken для слотов (на случай live-пути)
      passTokenForSlots = passToken;
      profile = updated;
      store[chatId] = updated;
      saveStore(store);
    }

    if (!upcoming.length) {
      await bot.sendMessage(chatId, 'Ближайшие занятия не найдены.');
      return;
    }

    // Сразу формируем кнопки из кеша с pending emoji и отправляем сообщение
    const keyboard = upcoming.map((cls) => {
      const token = ensureAppointmentToken(chatId, cfg.key, cls);
      // Используем pending emoji для начального отображения
      const label = formatClassLabel(cls, { hideStatus: true }, cfg);
      return [
        {
          text: label,
          callback_data: `clsitem:${cfg.key}:${token}`,
        },
      ];
    });

    // Добавляем кнопку "Назад" в конец
    keyboard.push([{ text: '↩️ Назад', callback_data: 'back:classes' }]);

    // Отправляем сообщение сразу из кеша
    const sentMessage = await bot.sendMessage(chatId, 'Ближайшие занятия', {
      reply_markup: { inline_keyboard: keyboard },
    });

    // В фоне получаем список запланированных занятий клиента и обновляем кнопки
    (async () => {
      try {
        const plannedAppointments = await ApiHelper.getClientAppointments(passTokenForSlots, {
          type: 'classes',
          statuses: ['planned'],
          requested_offset: 0,
          page_size: 30,
        });
        const plannedIds = new Set(
          plannedAppointments
            .filter((a) => a.type === 'classes' && a.status === 'planned')
            .map((a) => a.appointment_id)
        );

        // Обновляем кнопки с актуальными статусами
        const updatedKeyboard = upcoming.map((cls) => {
          const apptId = cls.appointment_id || cls.id;
          const alreadyBooked = apptId && plannedIds.has(apptId);
          const token = ensureAppointmentToken(chatId, cfg.key, cls);
          const label = formatClassLabel(
            { ...cls, already_booked: alreadyBooked },
            {},
            cfg
          );
          return [
            {
              text: label,
              callback_data: `clsitem:${cfg.key}:${token}`,
            },
          ];
        });

        // Добавляем кнопку "Назад" в конец
        updatedKeyboard.push([{ text: '↩️ Назад', callback_data: 'back:classes' }]);

        // Обновляем сообщение с актуальными статусами
        await bot.editMessageReplyMarkup(
          { inline_keyboard: updatedKeyboard },
          {
            chat_id: chatId,
            message_id: sentMessage.message_id,
          }
        );
      } catch (e) {
        console.warn('Не удалось обновить статусы занятий:', e.message);
        // В случае ошибки оставляем кнопки как есть (с pending emoji)
      }
    })();
  } catch (error) {
    console.error('Ошибка handleSelectClassDirection:', error.message);
    await bot.sendMessage(
      chatId,
      'Не удалось получить расписание. Попробуйте позже или повторите попытку.'
    );
  }
}

async function handleBookClass(chatId, key, appointmentId) {
  const cfg = classesConfig.find((c) => c.key === key);
  if (!cfg) {
    await bot.sendMessage(chatId, 'Неизвестное направление.');
    return;
  }

  const existing = store[chatId];
  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }
  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  try {
    const tokenData = resolveAppointmentToken(chatId, appointmentId);
    if (!tokenData) {
      // Если не удалось найти занятие - показываем список занятий заново
      await handleSelectClassDirection(chatId, key);
      return;
    }

    const passToken = await ensurePassToken(chatId, existing);

    // Получаем актуальное описание занятия
    let cls = tokenData.raw || {};
    try {
      const desc = await ApiHelper.getClassDescription(passToken, tokenData.appointment_id);
      cls = mergeClassDescription(cls, desc);
      tokenData.raw = cls;
    } catch (e) {
      console.warn('Не удалось обновить class_description перед записью:', e.message);
    }

    // Сохраняем информацию о занятии для покупки (если понадобится)
    if (!store[chatId].lastSelectedClass) store[chatId].lastSelectedClass = {};
    store[chatId].lastSelectedClass.appointment_id = tokenData.appointment_id;
    store[chatId].lastSelectedClass.service_id = tokenData.service_id || cls.service?.id || null;
    store[chatId].lastSelectedClass.start_date = cls.start_date || null;
    store[chatId].lastSelectedClass.service_title = cls.service_title || cls.service?.title || null;
    store[chatId].lastSelectedClass.trainerFull = cls.employee?.name || cls.employee_name || null;
    saveStore(store);

    // Базовая проверка статуса занятия
    if (cls.canceled) {
      await bot.sendMessage(chatId, 'Занятие отменено, запись невозможна.');
      return;
    }
    const free = Number(cls.free_places ?? 0);
    const recorded =
      cls.recorded ||
      cls.is_recorded ||
      cls.enrolled ||
      cls.in_record ||
      cls.client_enrolled ||
      cls.already_booked ||
      false;

    // Получаем список записей клиента, чтобы повторить логику find-next-saikl-pro
    const appointments = await ApiHelper.getClientAppointments(passToken);
    const existingAppointment = appointments.find(
      (apt) => apt.appointment_id === tokenData.appointment_id
    );

    let alreadyBooked = recorded;
    let isCanceled = false;
    let appointmentStatus = null;
    let arrivalStatus = null;

    if (existingAppointment) {
      alreadyBooked = true;
      appointmentStatus = existingAppointment.status || null;
      arrivalStatus = existingAppointment.arrival_status || null;
      if (
        arrivalStatus === 'canceled' ||
        arrivalStatus === 'cancelled' ||
        appointmentStatus === 'canceled'
      ) {
        isCanceled = true;
      }
    }

    const clubId = cls.club_id || tokenData.club_id || existing.oneC?.clubId || null;

    // Вспомогательная функция выбора билета
    const pickTicket = async () => {
      const tickets = await getTickets(passToken, null);
      const suitable =
        tickets.find((t) => {
          if (t.status && t.status !== 'active') return false;
          if (t.type && !['membership', 'package'].includes(t.type)) return false;
          if (t.count === null || t.count > 0) return true;
          if (Array.isArray(t.service_list)) {
            return t.service_list.some((s) => s.count === null || s.count > 0);
          }
          return false;
        }) || null;
      return suitable ? suitable.ticket_id : null;
    };

    const doBookingOnce = async () => {
      const ticketId = await pickTicket();
      const res = await ApiHelper.bookClass(passToken, tokenData.appointment_id, clubId, ticketId);
      return res;
    };

    const handleNoGrounds = async () => {
      const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      const d = new Date(cls.start_date);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
        2,
        '0'
      )}`;
      const weekday = wd[d.getDay()] || '';
      const title = cls.service_title || cls.service?.title || 'занятие';
      const trainerFull = cls.employee?.name || cls.employee_name || 'Тренер не указан';

      await bot.sendMessage(
        chatId,
        `У вас нет оснований для записи на ${title}\nПодождите немного, подготавливаю варианты покупки`
      );
      await suggestPurchaseOptions(chatId, cfg, passToken, {
        weekday,
        time,
        title,
        trainerFull,
      });
    };

    const finishSuccessMessage = async () => {
      tokenData.raw = { ...tokenData.raw, recorded: true, free_places: Math.max(free - 1, 0) };
      const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      const d = new Date(cls.start_date);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
        2,
        '0'
      )}`;
      const weekday = wd[d.getDay()] || '';
      const title = cls.service_title || cls.service?.title || 'Занятие';
      const trainerFull = cls.employee?.name || cls.employee_name || 'Тренер не указан';
      const em = (cfg && cfg.emojis) || {};
      const recordedEmoji = em.recorded || '🚴';
      const header = `✅ Запись оформлена! ${recordedEmoji}`;
      const lines = [header, `${weekday} ${time}`, `Услуга: ${title}`, `Тренер: ${trainerFull}`];
      await bot.sendMessage(chatId, lines.join('\n'));
    };

    // Если клиент уже был в отменённых — сначала удаляем из состава занятия, затем пробуем записать заново
    if (isCanceled) {
      await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch((err) =>
        console.warn('cancelClassBooking (from canceled) error:', err.reason || err)
      );
      const firstTry = await doBookingOnce();
      if (!firstTry.success) {
        await handleNoGrounds();
        return;
      }
      const status1 =
        firstTry.data?.status || firstTry.raw?.data?.status || firstTry.raw?.status || null;
      if (status1 === 'temporarily_reserved_need_payment') {
        await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch(() => {});
        const secondTry = await doBookingOnce();
        if (!secondTry.success) {
          await handleNoGrounds();
          return;
        }
        const status2 =
          secondTry.data?.status || secondTry.raw?.data?.status || secondTry.raw?.status || null;
        if (status2 === 'temporarily_reserved_need_payment') {
          await handleNoGrounds();
          return;
        }
        await finishSuccessMessage();
        return;
      }
      await finishSuccessMessage();
      return;
    }

    // Если уже записан и НЕ в отменённых
    if (alreadyBooked && !isCanceled) {
      if (appointmentStatus === 'temporarily_reserved_need_payment') {
        await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch(() => {});
        const firstTry = await doBookingOnce();
        if (!firstTry.success) {
          await handleNoGrounds();
          return;
        }
        const status1 =
          firstTry.data?.status || firstTry.raw?.data?.status || firstTry.raw?.status || null;
        if (status1 === 'temporarily_reserved_need_payment') {
          await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch(() => {});
          const secondTry = await doBookingOnce();
          if (!secondTry.success) {
            await handleNoGrounds();
            return;
          }
          const status2 =
            secondTry.data?.status || secondTry.raw?.data?.status || secondTry.raw?.status || null;
          if (status2 === 'temporarily_reserved_need_payment') {
            await handleNoGrounds();
            return;
          }
          await finishSuccessMessage();
          return;
        }
        await finishSuccessMessage();
        return;
      }

      // уже записан и статус нормальный
      await bot.sendMessage(chatId, 'Вы уже записаны на это занятие.');
      return;
    }

    // Клиент еще не записан — пробуем записать
    if (!(free > 0)) {
      await handleNoGrounds();
      return;
    }

    const firstBooking = await doBookingOnce();
    if (!firstBooking.success) {
      await handleNoGrounds();
      return;
    }
    const status =
      firstBooking.data?.status || firstBooking.raw?.data?.status || firstBooking.raw?.status || null;
    if (status === 'temporarily_reserved_need_payment') {
      await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch(() => {});
      const retry = await doBookingOnce();
      if (!retry.success) {
        await handleNoGrounds();
        return;
      }
      const statusRetry =
        retry.data?.status || retry.raw?.data?.status || retry.raw?.status || null;
      if (statusRetry === 'temporarily_reserved_need_payment') {
        await handleNoGrounds();
        return;
      }
      await finishSuccessMessage();
      return;
    }

    await finishSuccessMessage();
  } catch (error) {
    console.error('Ошибка handleBookClass:', error.message);
    await bot.sendMessage(chatId, 'У вас нет оснований для записи на выбранное занятие');
    // На ошибках API тоже предлагаем варианты покупки
    try {
      const cfg = classesConfig.find((c) => c.key === key);
      if (cfg) {
        const passToken = existing.oneC?.usertoken && (await ensurePassToken(chatId, existing));
        if (passToken) {
          await suggestPurchaseOptions(chatId, cfg, passToken);
        }
      }
    } catch (e) {
      console.warn('Не удалось предложить варианты покупки после ошибки записи:', e.message);
    }
  }
}

async function handleUnbookClass(chatId, key, appointmentId) {
  const cfg = classesConfig.find((c) => c.key === key);
  if (!cfg) {
    await bot.sendMessage(chatId, 'Неизвестное направление.');
    return;
  }

  const existing = store[chatId];
  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }
  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  try {
    const tokenData = resolveAppointmentToken(chatId, appointmentId);
    if (!tokenData) {
      // Если не удалось найти занятие - показываем список занятий заново
      await handleSelectClassDirection(chatId, key);
      return;
    }

    const passToken = await ensurePassToken(chatId, existing);

    let cls = tokenData.raw || {};
    try {
      const desc = await ApiHelper.getClassDescription(passToken, tokenData.appointment_id);
      cls = mergeClassDescription(cls, desc);
      tokenData.raw = cls;
    } catch (e) {
      console.warn('Не удалось обновить class_description перед отменой:', e.message);
    }

    if (cls.canceled) {
      await bot.sendMessage(chatId, 'Занятие отменено.');
      return;
    }

    const res = await cancelClassBooking(passToken, tokenData.appointment_id);
    if (res.success) {
      tokenData.raw = { ...tokenData.raw, recorded: false };
      const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
      const d = new Date(cls.start_date);
      const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
        2,
        '0'
      )}`;
      const weekday = wd[d.getDay()] || '';
      const title = cls.service_title || cls.service?.title || 'Занятие';
      const trainerFull = cls.employee?.name || cls.employee_name || 'Тренер не указан';
      const em = (cfg && cfg.emojis) || {};
      const availableEmoji = em.available || '🚲';
      const header = `❌ Запись отменена. ${availableEmoji}`;
      const lines = [header, `${weekday} ${time}`, `Услуга: ${title}`, `Тренер: ${trainerFull}`];
      await bot.sendMessage(chatId, lines.join('\n'));
      
      // Показываем список ближайших занятий
      await handleSelectClassDirection(chatId, key);
    } else {
      await bot.sendMessage(
        chatId,
        `Не удалось отменить запись: ${res.reason || 'неизвестная ошибка'}`
      );
      console.warn('cancelClassBooking fail:', res);
    }
  } catch (error) {
    console.error('Ошибка handleUnbookClass:', error.message);
    await bot.sendMessage(chatId, 'Не удалось отменить запись.');
  }
}

async function handlePurchaseSelection(chatId, key, token) {
  const cfg = classesConfig.find((c) => c.key === key);
  if (!cfg) {
    await bot.sendMessage(chatId, 'Неизвестное направление.');
    return;
  }

  const existing = store[chatId];
  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }
  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  try {
    const purchaseInfo = resolvePurchaseToken(chatId, token);
    if (!purchaseInfo) {
      await bot.sendMessage(chatId, 'Не удалось найти выбранный товар. Попробуйте снова.');
      return;
    }

    const passToken = await ensurePassToken(chatId, existing);
    const clubId = existing.oneC?.clubId;
    if (!clubId) {
      await bot.sendMessage(chatId, 'Не удалось определить клуб. Попробуйте позже.');
      return;
    }

    // Получаем информацию о занятии из контекста (если есть)
    const lastClass = store[chatId]?.lastSelectedClass || {};
    const appointmentId = lastClass.appointment_id || null;
    const serviceId = lastClass.service_id || null;

    // Получаем стоимость корзины
    const cartData = await ApiHelper.getCartCost(passToken, purchaseInfo.purchase_id, clubId, serviceId);
    const totalAmount = parseFloat(cartData.total_amount || 0);

    // Получаем лицевые счета
    const deposits = await ApiHelper.getDeposits(passToken);
    const mainDeposit = findMainDeposit(deposits, 'Основной');

    let depositId = null;
    let depositBalance = 0;
    let canPayFull = false;
    let canPayPartial = false;
    let remainingAmount = totalAmount;

    if (mainDeposit && mainDeposit.exists === true) {
      depositBalance = parseFloat(mainDeposit.balance || 0);
      depositId = mainDeposit.id || mainDeposit.deposit_id || mainDeposit.uuid;

      if (depositBalance > 0) {
        if (depositBalance >= totalAmount) {
          canPayFull = true;
        } else {
          canPayPartial = true;
          remainingAmount = totalAmount - depositBalance;
        }
      }
    }

    // Если нет лицевого счета с положительным балансом - сразу создаем долг и записываем
    if (!mainDeposit || depositBalance <= 0) {
      try {
        // Создаем оплату с долгом
        const paymentList = [
          {
            type: 'card',
            amount: 0.0001, // Эмуляция для создания долга
          },
        ];

        const result = await ApiHelper.createPayment(
          passToken,
          cartData,
          clubId,
          paymentList,
          serviceId
        );

        if (result.success) {
          await bot.sendMessage(
            chatId,
            `✅ Оплата успешно оформлена!\nСоздан долг на сумму ${totalAmount.toFixed(2)} рублей. Оплатите на рецепции.`
          );

          // Записываем на занятие классическим методом
          if (appointmentId) {
            await bookClassAfterPayment(chatId, passToken, appointmentId, clubId, key);
          }
        } else {
          await bot.sendMessage(chatId, `Не удалось оформить оплату: ${result.reason || 'неизвестная ошибка'}`);
        }
      } catch (error) {
        console.error('Ошибка при создании долга:', error.message);
        await bot.sendMessage(chatId, 'Не удалось оформить оплату. Попробуйте позже или обратитесь на рецепцию.');
      }
      return;
    }

    // Если есть лицевой счет - показываем варианты оплаты
    const depositName = mainDeposit.name || mainDeposit.title || mainDeposit.deposit_name || 'Лицевой счёт';

    // Сохраняем информацию для оплаты
    const paymentToken = rememberPaymentToken(chatId, {
      purchase_id: purchaseInfo.purchase_id,
      cartData,
      clubId,
      serviceId,
      appointmentId,
      cfgKey: key, // Сохраняем ключ направления для возврата к списку занятий
      totalAmount,
      depositId,
      depositBalance,
      canPayFull,
      canPayPartial,
      remainingAmount,
    });

    // Формируем сообщение
    const message = `Обнаружен лицевой счёт "${depositName}" ${depositBalance.toFixed(2)} руб.\n\nДоступные варианты оплаты:`;

    const keyboard = [];
    if (canPayFull) {
      const remainder = depositBalance - totalAmount;
      keyboard.push([
        {
          text: `Полностью с ЛС (остаток: ${remainder.toFixed(2)} руб.)`,
          callback_data: `pay:full:${paymentToken}`,
        },
      ]);
    }
    if (canPayPartial) {
      keyboard.push([
        {
          text: `Частично с ЛС (долг ${remainingAmount.toFixed(2)} рублей)`,
          callback_data: `pay:partial:${paymentToken}`,
        },
      ]);
    }
    keyboard.push([{ text: `На рецепции (долг ${totalAmount.toFixed(2)} руб.)`, callback_data: `pay:reception:${paymentToken}` }]);
    keyboard.push([{ text: '↩️ Закрыть', callback_data: `close:pay:0` }]);

    await bot.sendMessage(chatId, message, {
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error) {
    console.error('Ошибка handlePurchaseSelection:', error.message);
    await bot.sendMessage(chatId, 'Не удалось обработать выбор товара. Попробуйте позже.');
  }
}

// Функция для записи на занятие после оплаты
async function bookClassAfterPayment(chatId, passToken, appointmentId, clubId, cfgKey) {
  try {
    // Функция записи без ticket_id - система сама найдет основание
    const doBookingOnce = async () => {
      const res = await ApiHelper.bookClass(passToken, appointmentId, clubId, null);
      return res;
    };

    // Первая попытка записи
    const firstBooking = await doBookingOnce();
    if (!firstBooking.success) {
      await bot.sendMessage(
        chatId,
        `Оплата прошла успешно, но не удалось записаться на занятие: ${firstBooking.reason || 'неизвестная ошибка'}. Обратитесь на рецепцию.`
      );
      return;
    }

    const status =
      firstBooking.data?.status || firstBooking.raw?.data?.status || firstBooking.raw?.status || null;

    // Если временная бронь - отменяем и пробуем еще раз
    if (status === 'temporarily_reserved_need_payment') {
      await ApiHelper.cancelClassBooking(passToken, appointmentId).catch(() => {});
      const retry = await doBookingOnce();
      if (!retry.success) {
        await bot.sendMessage(
          chatId,
          `Оплата прошла успешно, но не удалось записаться на занятие: ${retry.reason || 'неизвестная ошибка'}. Обратитесь на рецепцию.`
        );
        return;
      }
      const statusRetry =
        retry.data?.status || retry.raw?.data?.status || retry.raw?.status || null;
      if (statusRetry === 'temporarily_reserved_need_payment') {
        await bot.sendMessage(
          chatId,
          `Оплата прошла успешно, но не удалось записаться на занятие. Обратитесь на рецепцию.`
        );
        return;
      }
    }

    // Успешная запись - формируем сообщение
    const cls = store[chatId]?.lastSelectedClass || {};
    const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    let timeStr = '';
    let weekdayStr = '';
    let titleStr = '';
    let trainerStr = '';

    if (cls.start_date) {
      const d = new Date(cls.start_date);
      timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      weekdayStr = wd[d.getDay()] || '';
    }
    titleStr = cls.service_title || 'Занятие';
    trainerStr = cls.trainerFull || 'Тренер не указан';

    const cfg = classesConfig.find((c) => c.key === cfgKey);
    const em = (cfg && cfg.emojis) || {};
    const recordedEmoji = em.recorded || '🚴';
    const successMessage = [
      `✅ Запись оформлена! ${recordedEmoji}`,
      `${weekdayStr} ${timeStr}`,
      `Услуга: ${titleStr}`,
      `Тренер: ${trainerStr}`,
    ]
      .filter(Boolean)
      .join('\n');

    await bot.sendMessage(chatId, successMessage);

    // Показываем список занятий снова
    if (cfgKey) {
      await handleSelectClassDirection(chatId, cfgKey);
    }
  } catch (error) {
    console.error('Ошибка при записи на занятие после оплаты:', error.message);
    await bot.sendMessage(
      chatId,
      `Оплата прошла успешно, но не удалось записаться на занятие. Обратитесь на рецепцию.`
    );
  }
}

async function handlePayment(chatId, type, token) {
  const existing = store[chatId];
  if (!existing || existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  try {
    const paymentInfo = resolvePaymentToken(chatId, token);
    if (!paymentInfo) {
      await bot.sendMessage(chatId, 'Не удалось найти информацию об оплате. Попробуйте снова.');
      return;
    }

    const passToken = await ensurePassToken(chatId, existing);
    const paymentList = [];

    if (type === 'full' && paymentInfo.canPayFull && paymentInfo.depositId) {
      // Полная оплата с лицевого счета
      paymentList.push({
        type: 'deposit',
        id: paymentInfo.depositId,
        amount: parseFloat(paymentInfo.totalAmount.toFixed(2)),
      });
    } else if (type === 'partial' && paymentInfo.canPayPartial && paymentInfo.depositId) {
      // Частичная оплата с лицевого счета + долг
      paymentList.push({
        type: 'deposit',
        id: paymentInfo.depositId,
        amount: parseFloat(paymentInfo.depositBalance.toFixed(2)),
      });
      paymentList.push({
        type: 'card',
        amount: 0.0001, // Эмуляция для создания долга
      });
    } else if (type === 'reception') {
      // Полная оплата на рецепции (долг)
      paymentList.push({
        type: 'card',
        amount: 0.0001, // Эмуляция для создания долга
      });
    } else {
      await bot.sendMessage(chatId, 'Выбранный вариант оплаты недоступен.');
      return;
    }

    try {
      const result = await ApiHelper.createPayment(
        passToken,
        paymentInfo.cartData,
        paymentInfo.clubId,
        paymentList,
        paymentInfo.serviceId
      );

      if (result.success) {
        let message = '✅ Оплата успешно оформлена!\n';
        if (type === 'full') {
          const remainder = paymentInfo.depositBalance - paymentInfo.totalAmount;
          message += `Оплачено полностью с лицевого счета. Остаток на счету: ${remainder.toFixed(2)} рублей.`;
        } else if (type === 'partial') {
          message += `Оплачено частично с лицевого счета на сумму ${paymentInfo.depositBalance.toFixed(2)} рублей.\n`;
          message += `Осталось доплатить: ${paymentInfo.remainingAmount.toFixed(2)} рублей.`;
        } else {
          message += `Создан долг на сумму ${paymentInfo.totalAmount.toFixed(2)} рублей. Оплатите на рецепции.`;
        }
        await bot.sendMessage(chatId, message);

        // Если есть занятие — записываем клиента на него "по старинке" (без ticket_id)
        if (paymentInfo.appointmentId) {
          await bookClassAfterPayment(
            chatId,
            passToken,
            paymentInfo.appointmentId,
            paymentInfo.clubId,
            paymentInfo.cfgKey
          );
        }
      }
    } catch (error) {
      await bot.sendMessage(chatId, `Не удалось оформить оплату: ${error.message || 'неизвестная ошибка'}`);
    }
  } catch (error) {
    console.error('Ошибка handlePayment:', error.message);
    await bot.sendMessage(chatId, 'Не удалось обработать оплату. Попробуйте позже или обратитесь на рецепцию.');
  }
}

function findMainDeposit(deposits, depositName) {
  const normalizedName = depositName.toLowerCase().trim();
  for (const deposit of deposits) {
    const name = (deposit.name || deposit.title || deposit.deposit_name || '').toLowerCase().trim();
    if (name === normalizedName && deposit.exists === true) {
      return deposit;
    }
  }
  return null;
}

function rememberPaymentToken(chatId, info) {
  if (!purchaseTokens[chatId]) purchaseTokens[chatId] = {};
  const token = Math.random().toString(36).slice(2, 10);
  purchaseTokens[chatId][`payment_${token}`] = info;
  return token;
}

function resolvePaymentToken(chatId, token) {
  return purchaseTokens[chatId]?.[`payment_${token}`] || null;
}

bot.on('callback_query', async (query) => {
  const { data, message } = query;
  if (!data || !message) return;
  const chatId = message.chat.id;

  // Логируем callback_data
  console.log('Callback data:', data);

  if (data.startsWith('back:classes')) {
    // Возвращаемся к выбору направления
    if (!classesConfig.length) {
      await bot.sendMessage(chatId, 'Список направлений пока пуст.');
      return;
    }

    const keyboard = classesConfig.map((c) => [
      { text: c.button || c.roomTitle, callback_data: `cls:${c.key}` },
    ]);

    await bot.sendMessage(chatId, 'Выберите направление:', {
      reply_markup: { inline_keyboard: keyboard },
    });
    return;
  }

  if (data.startsWith('cls:')) {
    const key = data.split(':')[1];
    await handleSelectClassDirection(chatId, key);
  }

  if (data.startsWith('clsitem:')) {
    const [, key, token] = data.split(':');
    await showClassDetails(chatId, key, token, message.message_id, query);
  }

  if (data.startsWith('book:')) {
    const [, key, token] = data.split(':');
    await handleBookClass(chatId, key, token);
  }

  if (data.startsWith('unbook:')) {
    const [, key, token] = data.split(':');
    await handleUnbookClass(chatId, key, token);
  }

  if (data.startsWith('buy:')) {
    const [, key, token] = data.split(':');
    await handlePurchaseSelection(chatId, key, token);
  }

  if (data.startsWith('pay:')) {
    const [, type, token] = data.split(':');
    await handlePayment(chatId, type, token);
  }

  if (data.startsWith('close:')) {
    try {
      await bot.deleteMessage(chatId, message.message_id);
    } catch (e) {
      console.warn('Не удалось удалить сообщение:', e.message);
    }
  }

  bot.answerCallbackQuery(query.id);
});

async function showClassDetails(chatId, key, token, messageId, query = null) {
  const cfg = classesConfig.find((c) => c.key === key);
  if (!cfg) {
    await bot.sendMessage(chatId, 'Неизвестное направление.');
    return;
  }

  const existing = store[chatId];
  if (!existing) {
    await bot.sendMessage(chatId, 'Сначала нажмите /start и поделитесь контактом.');
    return;
  }
  if (existing.status === 'logged_out') {
    await bot.sendMessage(chatId, 'Чтобы войти нажмите /start.');
    return;
  }

  const tokenData = resolveAppointmentToken(chatId, token);
  if (!tokenData) {
    // Если не удалось найти занятие - показываем список занятий заново
    await handleSelectClassDirection(chatId, key);
    return;
  }

  const passToken = await ensurePassToken(chatId, existing);

  // Флаг для отслеживания, был ли уже ответ на callback query
  let queryAnswered = false;

  // Функция для показа всплывающего уведомления
  const showNotification = async (text) => {
    if (query && !queryAnswered) {
      try {
        await bot.answerCallbackQuery(query.id, {
          text: text,
          show_alert: false,
        });
        queryAnswered = true; // Помечаем, что query уже обработан
      } catch (e) {
        // Игнорируем ошибки, если query уже был обработан
        queryAnswered = true;
      }
    }
  };

  // Вспомогательная функция для получения class_description с одной повторной попыткой
  const getClassDescriptionWithRetry = async (appointmentId) => {
    try {
      return await ApiHelper.getClassDescription(passToken, appointmentId);
    } catch (e) {
      console.warn(`[class_descriptions] Первая попытка не удалась: ${e.message}, повторная попытка...`);
      try {
        return await ApiHelper.getClassDescription(passToken, appointmentId);
      } catch (retryError) {
        console.warn(`[class_descriptions] Повторная попытка также не удалась: ${retryError.message}`);
        throw retryError;
      }
    }
  };

  // Функция для обновления сообщения
  const updateMessage = async (text, messageIdToUpdate, keyboard = null) => {
    try {
      const options = {
        chat_id: chatId,
        message_id: messageIdToUpdate,
      };
      if (keyboard) {
        options.reply_markup = keyboard;
      }
      await bot.editMessageText(text, options);
      return messageIdToUpdate;
    } catch (e) {
      // Если не удалось обновить (например, текст не изменился), возвращаем текущий ID
      return messageIdToUpdate;
    }
  };

  // Функция для удаления сообщения
  const deleteMessageWithAnimation = async (messageIdToDelete) => {
    try {
      await bot.deleteMessage(chatId, messageIdToDelete);
    } catch (e) {
      console.warn('Не удалось удалить сообщение:', e.message);
    }
  };

  // Функция для удаления сообщения (без анимации, для обратной совместимости)
  const deleteMessage = async (messageIdToDelete) => {
    try {
      await bot.deleteMessage(chatId, messageIdToDelete);
    } catch (e) {
      console.warn('Не удалось удалить сообщение:', e.message);
    }
  };

  // Шаг 1: Показываем начальное сообщение о проверке
  const checkText = 'Проверяю, записаны ли вы на занятие...';
  let statusMessage = await bot.sendMessage(chatId, checkText);
  let statusMessageId = statusMessage.message_id;
  await showNotification(checkText);

  // Получаем актуальное описание занятия
  let cls = tokenData.raw || {};
  try {
    let desc = await getClassDescriptionWithRetry(tokenData.appointment_id);

    // Если статус временной брони с требованием оплаты — сразу отменяем запись
    if (desc.status === 'temporarily_reserved_need_payment') {
      try {
        await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id);
      } catch (e) {
        console.warn('[cancel_after_temp_reserved] Ошибка при отмене записи:', e.reason || e.message || e);
      }

      try {
        desc = await getClassDescriptionWithRetry(tokenData.appointment_id);
      } catch (e) {
        console.warn('[class_descriptions] Не удалось перечитать описание после отмены:', e.message);
      }
    }

    cls = mergeClassDescription(cls, desc);
    tokenData.raw = cls;
  } catch (e) {
    console.warn('Не удалось получить class_description для карточки:', e.message);
  }

  // Уточняем статус записи клиента через /appointments
  let inCanceledList = false;
  let isRecorded = false;
  try {
    const appointments = await ApiHelper.getClientAppointments(passToken);
    const appt = appointments.find((a) => a.appointment_id === tokenData.appointment_id);
    if (appt) {
      const arrivalStatus = appt.arrival_status;
      const st = appt.status;
      if (
        arrivalStatus === 'canceled' ||
        arrivalStatus === 'cancelled' ||
        st === 'canceled'
      ) {
        inCanceledList = true;
      } else if (st === 'planned') {
        isRecorded = true;
      }
    }
  } catch (e) {
    console.warn('Не удалось получить appointments для уточнения статуса:', e.message);
  }

  // Если клиент в отменённых – считаем, что он НЕ записан
  if (inCanceledList) {
    cls = { ...cls, recorded: false, already_booked: false };
    isRecorded = false;
  }

  // Формируем детали занятия
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const d = new Date(cls.start_date);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const weekday = wd[d.getDay()] || '';
  const title = cls.service_title || cls.service?.title || 'Занятие';
  const trainerFull = cls.employee?.name || cls.employee_name || 'Тренер не указан';
  const details = `${weekday} ${time}\nУслуга: ${title}\nТренер: ${trainerFull}`;

  // Шаг 2: Если записан - показываем сообщение и завершаем
  if (isRecorded && !inCanceledList) {
    const recordedEmoji = cfg.emojis?.recorded || '🚴';
    const message = `✅ Вы уже записаны на занятие\n${details}`;
    const keyboard = {
      inline_keyboard: [
        [{ text: '❌ Отменить запись', callback_data: `unbook:${key}:${token}` }],
        [{ text: '↩️ Закрыть', callback_data: `close:${key}:${token}` }],
      ],
    };
    await updateMessage(message, statusMessageId, keyboard);
    return;
  }

  // Шаг 3: Если не записан - обновляем сообщение и пытаемся записать
  const checkingText = 'Вы не записаны на занятие, проверяю возможность записи...';
  await updateMessage(checkingText, statusMessageId);
  await showNotification(checkingText);

  // Логируем информацию о занятии и клиенте
  console.log(`[BOOKING] ========== НАЧАЛО ПОПЫТКИ ЗАПИСИ ==========`);
  console.log(`[BOOKING] Занятие: appointment_id=${tokenData.appointment_id}, service_title=${cls.service_title || cls.service?.title || 'N/A'}, start_date=${cls.start_date}`);
  console.log(`[BOOKING] Статус занятия: canceled=${cls.canceled}, free_places=${cls.free_places}, capacity=${cls.capacity}`);
  console.log(`[BOOKING] Клиент: chatId=${chatId}, clubId=${existing.oneC?.clubId || 'N/A'}, inCanceledList=${inCanceledList}, isRecorded=${isRecorded}`);

  // Сохраняем информацию о занятии для покупки (если понадобится)
  if (!store[chatId].lastSelectedClass) store[chatId].lastSelectedClass = {};
  store[chatId].lastSelectedClass.appointment_id = tokenData.appointment_id;
  store[chatId].lastSelectedClass.service_id = tokenData.service_id || cls.service?.id || null;
  store[chatId].lastSelectedClass.start_date = cls.start_date || null;
  store[chatId].lastSelectedClass.service_title = cls.service_title || cls.service?.title || null;
  store[chatId].lastSelectedClass.trainerFull = cls.employee?.name || cls.employee_name || null;
  saveStore(store);

  // Базовая проверка статуса занятия
  if (cls.canceled) {
    console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ: Занятие отменено`);
    const canceledText = 'Занятие отменено, запись невозможна.';
    await updateMessage(canceledText, statusMessageId);
    await showNotification(canceledText);
    return;
  }

  const clubId = cls.club_id || tokenData.club_id || existing.oneC?.clubId || null;
  console.log(`[BOOKING] clubId=${clubId}`);

  // Вспомогательная функция выбора билета
  const pickTicket = async () => {
    const tickets = await getTickets(passToken, null);
    console.log(`[BOOKING] Получено билетов: ${tickets.length}`);
    tickets.forEach((t, idx) => {
      console.log(`[BOOKING] Билет ${idx + 1}: type=${t.type}, status=${t.status}, title=${t.title}, count=${t.count}, ticket_id=${t.ticket_id}`);
    });
    
    const suitable =
      tickets.find((t) => {
        if (t.status && t.status !== 'active') return false;
        if (t.type && !['membership', 'package'].includes(t.type)) return false;
        if (t.count === null || t.count > 0) return true;
        if (Array.isArray(t.service_list)) {
          return t.service_list.some((s) => s.count === null || s.count > 0);
        }
        return false;
      }) || null;
    
    if (suitable) {
      console.log(`[BOOKING] Выбран подходящий билет: ticket_id=${suitable.ticket_id}, type=${suitable.type}, status=${suitable.status}, title=${suitable.title}`);
    } else {
      console.log(`[BOOKING] Подходящий билет не найден`);
    }
    
    return suitable ? suitable.ticket_id : null;
  };

  const doBookingOnce = async () => {
    // Не передаем ticketId - система сама найдет подходящее основание
    console.log(`[BOOKING] Попытка записи: appointment_id=${tokenData.appointment_id}, clubId=${clubId}, ticketId=null (система сама выберет)`);
    const res = await ApiHelper.bookClass(passToken, tokenData.appointment_id, clubId, null);
    console.log(`[BOOKING] Результат записи: success=${res.success}, reason=${res.reason || 'N/A'}, status=${res.data?.status || res.raw?.data?.status || res.raw?.status || 'N/A'}`);
    if (res.raw) {
      console.log(`[BOOKING] Полный ответ API:`, JSON.stringify(res.raw, null, 2));
    }
    return res;
  };

  // Если клиент был в отменённых — сначала удаляем из состава занятия, затем пробуем записать заново
  if (inCanceledList) {
    console.log(`[BOOKING] Клиент был в списке отменённых, отменяем запись перед повторной попыткой`);
    await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch((err) =>
      console.warn('[BOOKING] cancelClassBooking (from canceled) error:', err.reason || err)
    );
    const firstTry = await doBookingOnce();
    if (!firstTry.success) {
      console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ (клиент был в отменённых, первая попытка): reason=${firstTry.reason || 'N/A'}`);
      await deleteMessageWithAnimation(statusMessageId);
      await handleNoGroundsAfterCheck(chatId, cfg, passToken, details, statusMessageId, query);
      return;
    }
    const status1 =
      firstTry.data?.status || firstTry.raw?.data?.status || firstTry.raw?.status || null;
    console.log(`[BOOKING] Первая попытка (после отменённых): status=${status1}`);
    if (status1 === 'temporarily_reserved_need_payment') {
      console.log(`[BOOKING] Получен статус temporarily_reserved_need_payment, отменяем и пробуем ещё раз`);
      await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch(() => {});
      const secondTry = await doBookingOnce();
      if (!secondTry.success) {
        console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ (клиент был в отменённых, вторая попытка): reason=${secondTry.reason || 'N/A'}`);
        await deleteMessageWithAnimation(statusMessageId);
        await handleNoGroundsAfterCheck(chatId, cfg, passToken, details, statusMessageId, query);
        return;
      }
      const status2 =
        secondTry.data?.status || secondTry.raw?.data?.status || secondTry.raw?.status || null;
      console.log(`[BOOKING] Вторая попытка (после отменённых): status=${status2}`);
      if (status2 === 'temporarily_reserved_need_payment') {
        console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ (клиент был в отменённых, после второй попытки всё ещё temporarily_reserved_need_payment)`);
        await deleteMessageWithAnimation(statusMessageId);
        await handleNoGroundsAfterCheck(chatId, cfg, passToken, details, statusMessageId, query);
        return;
      }
      console.log(`[BOOKING] ✅ УСПЕШНО ЗАПИСАН (после отменённых, вторая попытка): appointment_id=${tokenData.appointment_id}`);
      const recordedEmoji = cfg.emojis?.recorded || '🚴';
      const message = `✅ Вы записаны на занятие\n${details}`;
      await updateMessage(message, statusMessageId);
      await showNotification('✅ Вы записаны на занятие');
      console.log(`[BOOKING] ========== КОНЕЦ ПОПЫТКИ ЗАПИСИ (УСПЕХ) ==========`);
      return;
    }
    console.log(`[BOOKING] ✅ УСПЕШНО ЗАПИСАН (после отменённых, первая попытка): appointment_id=${tokenData.appointment_id}`);
    const recordedEmoji = cfg.emojis?.recorded || '🚴';
    const message = `✅ Вы записаны на занятие\n${details}`;
    await updateMessage(message, statusMessageId);
    await showNotification('✅ Вы записаны на занятие');
    console.log(`[BOOKING] ========== КОНЕЦ ПОПЫТКИ ЗАПИСИ (УСПЕХ) ==========`);
    return;
  }

  // Клиент еще не записан — пробуем записать
  const free = cls.free_places === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Number(cls.free_places ?? 0);
  console.log(`[BOOKING] Проверка свободных мест: free_places=${cls.free_places}, free=${free}`);
  if (!(free > 0)) {
    console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ: Нет свободных мест (free=${free})`);
    await deleteMessageWithAnimation(statusMessageId);
    await handleNoGroundsAfterCheck(chatId, cfg, passToken, details, statusMessageId, query);
    return;
  }

  console.log(`[BOOKING] Начало попытки записи: appointment_id=${tokenData.appointment_id}, free_places=${free}`);
  const firstBooking = await doBookingOnce();
  if (!firstBooking.success) {
    console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ (первая попытка): reason=${firstBooking.reason || 'N/A'}`);
    await deleteMessageWithAnimation(statusMessageId);
    await handleNoGroundsAfterCheck(chatId, cfg, passToken, details, statusMessageId, query);
    return;
  }
  const status =
    firstBooking.data?.status || firstBooking.raw?.data?.status || firstBooking.raw?.status || null;
  console.log(`[BOOKING] Первая попытка записи: status=${status}`);
  if (status === 'temporarily_reserved_need_payment') {
    console.log(`[BOOKING] Получен статус temporarily_reserved_need_payment, отменяем и пробуем ещё раз`);
    await ApiHelper.cancelClassBooking(passToken, tokenData.appointment_id).catch(() => {});
    const retry = await doBookingOnce();
    if (!retry.success) {
      console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ (повторная попытка после temporarily_reserved_need_payment): reason=${retry.reason || 'N/A'}`);
      await deleteMessageWithAnimation(statusMessageId);
      await handleNoGroundsAfterCheck(chatId, cfg, passToken, details, statusMessageId, query);
      return;
    }
    const statusRetry =
      retry.data?.status || retry.raw?.data?.status || retry.raw?.status || null;
    console.log(`[BOOKING] Повторная попытка записи: status=${statusRetry}`);
    if (statusRetry === 'temporarily_reserved_need_payment') {
      console.log(`[BOOKING] ❌ НЕ УДАЛОСЬ ЗАПИСАТЬ: После повторной попытки всё ещё temporarily_reserved_need_payment`);
      await deleteMessageWithAnimation(statusMessageId);
      await handleNoGroundsAfterCheck(chatId, cfg, passToken, details, statusMessageId, query);
      return;
    }
  }

  // Успешная запись
  console.log(`[BOOKING] ✅ УСПЕШНО ЗАПИСАН на занятие: appointment_id=${tokenData.appointment_id}`);
  const recordedEmoji = cfg.emojis?.recorded || '🚴';
  const message = `✅ Вы записаны на занятие\n${details}`;
  await updateMessage(message, statusMessageId);
  await showNotification('✅ Вы записаны на занятие');
  console.log(`[BOOKING] ========== КОНЕЦ ПОПЫТКИ ЗАПИСИ (УСПЕХ) ==========`);
}

// Вспомогательная функция для обработки отсутствия оснований после проверки
async function handleNoGroundsAfterCheck(chatId, cfg, passToken, details, previousMessageId, query = null) {
  console.log(`[BOOKING] ========== НЕТ ОСНОВАНИЙ ДЛЯ ЗАПИСИ ==========`);
  console.log(`[BOOKING] Вызывается handleNoGroundsAfterCheck для chatId=${chatId}, appointment_id=${store[chatId]?.lastSelectedClass?.appointment_id || 'N/A'}`);
  
  const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const cls = store[chatId]?.lastSelectedClass || {};
  const d = cls.start_date ? new Date(cls.start_date) : new Date();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const weekday = wd[d.getDay()] || '';
  const title = cls.service_title || 'занятие';
  
  console.log(`[BOOKING] Подготавливаю варианты покупки для занятия: ${title}, ${weekday} ${time}`);

  // Функция для показа всплывающего уведомления
  // Примечание: query уже был обработан в showClassDetails, поэтому здесь уведомления не показываются
  const showNotification = async (text) => {
    // Query уже обработан, поэтому не показываем уведомления здесь
    // Уведомления показываются только через текстовые сообщения
  };

  // Функция для удаления сообщения
  const deleteMessageWithAnimation = async (messageIdToDelete) => {
    try {
      await bot.deleteMessage(chatId, messageIdToDelete);
    } catch (e) {
      console.warn('Не удалось удалить сообщение:', e.message);
    }
  };

  // Показываем сообщение о подготовке вариантов
  const preparingText = 'У вас нет основания для записи на занятие, подготавливаю варианты для покупки тренировок...';
  const preparingMessage = await bot.sendMessage(chatId, preparingText);
  await showNotification(preparingText);

  // Удаляем предыдущее сообщение (оно уже удалено с анимацией в showClassDetails, но на всякий случай)
  try {
    await bot.deleteMessage(chatId, previousMessageId);
  } catch (e) {
    // Игнорируем ошибку, если сообщение уже удалено
  }

  // Подготавливаем варианты покупки
  await suggestPurchaseOptions(chatId, cfg, passToken, {
    weekday,
    time,
    title,
    trainerFull: cls.trainerFull || 'Тренер не указан',
  });

  // Удаляем сообщение о подготовке с анимацией
  await deleteMessageWithAnimation(preparingMessage.message_id);
}
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});
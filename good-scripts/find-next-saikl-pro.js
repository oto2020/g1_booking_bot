// Скрипт для поиска ближайшего занятия "САЙКЛ PRO" в расписании
//
// Документация: https://fitness1cv3.docs.apiary.io/#reference/0/classes
//
// Что делает:
// 1. Получает pass_token для клиента +79785667199
// 2. Получает данные клиента и club_id
// 3. Запрашивает расписание занятий через GET /classes
// 4. Фильтрует занятия, где service.title содержит "САЙКЛ PRO"
// 5. Находит ближайшее занятие по дате
// 6. Выводит подробную информацию о занятии
//
// Как запускать:
//   cd /root/grelka_yookassa_bot
//   node scripts/good-scripts/find-next-saikl-pro.js

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

// Отключаем проверку SSL сертификата
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Конфигурация
const PHONE = '+79785667199';
const SEARCH_TEXT = 'САЙКЛ PRO';

// Проверяем наличие переменных окружения
const API_HOSTNAME = process.env.API_HOSTNAME;
const API_PORT = process.env.API_PORT;
const API_PATH = process.env.API_PATH;
const API_KEY = process.env.API_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const AUTHORIZATION = process.env.AUTHORIZATION;

if (!API_HOSTNAME || !API_PORT || !API_PATH || !API_KEY || !SECRET_KEY || !AUTHORIZATION) {
  console.error('❌ Не все переменные окружения установлены');
  console.error('Проверьте файл .env и убедитесь, что установлены:');
  console.error('  - API_HOSTNAME');
  console.error('  - API_PORT');
  console.error('  - API_PATH');
  console.error('  - API_KEY');
  console.error('  - SECRET_KEY');
  console.error('  - AUTHORIZATION');
  process.exit(1);
}

/**
 * Получение pass_token для клиента
 */
async function getPassToken(phone) {
  console.log('\n📞 Получение pass_token...');
  
  // Убираем + из номера телефона для подписи
  const phoneForSign = phone.replace('+', '');
  
  // Создаем подпись
  const signString = `phone:${phoneForSign};key:${SECRET_KEY}`;
  const sign = crypto.createHash('sha256').update(signString).digest('hex');
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/pass_token?phone=${phoneForSign}&sign=${sign}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION
      },
      httpsAgent
    });
    
    if (response.data.result && response.data.data && response.data.data.pass_token) {
      const passToken = response.data.data.pass_token;
      console.log(`✅ pass_token получен: ${passToken.substring(0, 20)}...`);
      return passToken;
    } else {
      throw new Error('Неверный формат ответа от pass_token');
    }
  } catch (error) {
    console.error(`❌ Ошибка получения pass_token:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Получение данных клиента
 */
async function getClient(passToken) {
  console.log('\n👤 Получение данных клиента...');
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/client`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    if (!response.data.result || !response.data.data) {
      throw new Error('Неверный формат ответа от /client');
    }
    
    const clientData = response.data.data;
    console.log(`✅ Клиент: ${clientData.name} ${clientData.last_name || ''}`);
    console.log(`   ID: ${clientData.id}`);
    
    if (!clientData.club || !clientData.club.id) {
      throw new Error('club_id не найден');
    }
    
    console.log(`   Клуб ID: ${clientData.club.id}`);
    return clientData;
  } catch (error) {
    console.error(`❌ Ошибка получения данных клиента:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Получение расписания занятий
 */
async function getClasses(passToken, clubId, startDate, endDate) {
  console.log('\n📅 Получение расписания занятий...');
  console.log(`   Период: ${startDate} - ${endDate}`);
  
  const params = new URLSearchParams({
    club_id: clubId,
    start_date: startDate,
    end_date: endDate
  });
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/classes/?${params.toString()}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    if (!response.data.result) {
      throw new Error(`Ошибка API: ${response.data.error_message || response.data.error}`);
    }
    
    const classes = Array.isArray(response.data.data) ? response.data.data : [];
    console.log(`✅ Получено занятий: ${classes.length}`);
    return classes;
  } catch (error) {
    console.error(`❌ Ошибка получения расписания:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Поиск ближайшего занятия "САЙКЛ PRO"
 */
function findNextSaiklPro(classes, searchText) {
  const now = new Date();
  
  // Фильтруем занятия, где service.title содержит искомый текст
  const filtered = classes.filter(cls => {
    const serviceTitle = cls.service?.title || '';
    return serviceTitle.toUpperCase().includes(searchText.toUpperCase());
  });
  
  if (filtered.length === 0) {
    return null;
  }
  
  // Фильтруем только будущие занятия
  const futureClasses = filtered.filter(cls => {
    if (!cls.start_date) return false;
    const classDate = new Date(cls.start_date);
    return classDate > now && !cls.canceled;
  });
  
  if (futureClasses.length === 0) {
    return null;
  }
  
  // Сортируем по дате начала и берем первое (ближайшее)
  futureClasses.sort((a, b) => {
    const dateA = new Date(a.start_date);
    const dateB = new Date(b.start_date);
    return dateA - dateB;
  });
  
  return futureClasses[0];
}

/**
 * Проверка наличия активного членства
 */
async function checkActiveMembership(passToken) {
  try {
    // Проверяем через tickets (членства)
    const ticketsUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/tickets`;
    const ticketsResponse = await axios.get(ticketsUrl, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    let tickets = [];
    if (Array.isArray(ticketsResponse.data)) {
      tickets = ticketsResponse.data;
    } else if (ticketsResponse.data && Array.isArray(ticketsResponse.data.data)) {
      tickets = ticketsResponse.data.data;
    }
    
    // Проверяем наличие активного членства
    const activeMembership = tickets.find(ticket => 
      ticket.status === 'active' && ticket.type === 'membership'
    );
    
    if (activeMembership) {
      return true;
    }
    
    // Также проверяем через deposits
    const depositsUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/deposits`;
    const depositsResponse = await axios.get(depositsUrl, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    let deposits = [];
    if (Array.isArray(depositsResponse.data)) {
      deposits = depositsResponse.data;
    } else if (depositsResponse.data && Array.isArray(depositsResponse.data.data)) {
      deposits = depositsResponse.data.data;
    } else if (depositsResponse.data && Array.isArray(depositsResponse.data.deposits)) {
      deposits = depositsResponse.data.deposits;
    }
    
    // Проверяем наличие активных депозитов (членств)
    const activeDeposits = deposits.filter(deposit => {
      if (deposit.exists === true) {
        const balance = parseFloat(deposit.balance || 0);
        return balance > 0 || (deposit.type && deposit.type.name && 
          (deposit.type.name.toLowerCase().includes('членство') || 
           deposit.type.name.toLowerCase().includes('абонемент') ||
           deposit.type.name.toLowerCase().includes('membership')));
      }
      return false;
    });
    
    return activeDeposits.length > 0;
  } catch (error) {
    console.log(`   ⚠️  Не удалось проверить членство: ${error.message}`);
    return false;
  }
}

/**
 * Получение списка билетов (членств, пакетов услуг) клиента
 */
async function getTickets(passToken) {
  console.log('\n🎫 Получение списка билетов клиента...');
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/tickets`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    if (!response.data || !Array.isArray(response.data)) {
      return [];
    }
    
    // Фильтруем активные билеты (членства и пакеты услуг)
    const tickets = response.data.filter(ticket => 
      ticket.status === 'active' && 
      (ticket.type === 'membership' || ticket.type === 'package')
    );
    
    if (tickets.length > 0) {
      console.log(`✅ Найдено активных билетов: ${tickets.length}`);
      tickets.forEach((ticket, index) => {
        console.log(`   ${index + 1}. ${ticket.title} (${ticket.type}) - остаток: ${ticket.count !== null ? ticket.count : 'неограничено'}`);
      });
    } else {
      console.log(`⚠️  Активных билетов не найдено`);
    }
    
    return tickets;
  } catch (error) {
    console.error(`❌ Ошибка получения билетов:`, error.response?.data || error.message);
    return [];
  }
}

/**
 * Получение прайс-листа
 */
async function getPricelist(passToken) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': API_KEY,
    'Authorization': AUTHORIZATION,
    'usertoken': passToken
  };

  // Пробуем разные варианты названия endpoint
  const possibleEndpoints = ['pricelist', 'price_list', 'prices', 'price-list'];
  
  for (const endpoint of possibleEndpoints) {
    const url = `${baseUrl}/${endpoint}`;
    
    try {
      const response = await axios.get(url, {
        headers,
        httpsAgent,
        timeout: 10000
      });

      let items = [];
      if (Array.isArray(response.data)) {
        items = response.data;
      } else if (response.data && Array.isArray(response.data.data)) {
        items = response.data.data;
      } else if (response.data && Array.isArray(response.data.items)) {
        items = response.data.items;
      } else if (response.data && Array.isArray(response.data.pricelist)) {
        items = response.data.pricelist;
      } else if (response.data && Array.isArray(response.data.prices)) {
        items = response.data.prices;
      }

      if (items.length > 0 || (response.data && response.data.result !== false)) {
        return items;
      }
    } catch (error) {
      continue;
    }
  }

  throw new Error('Не удалось получить прайс-лист');
}

/**
 * Получение вариантов для покупки из каталога, соответствующего помещению
 */
async function getPurchaseOptions(passToken, roomTitle) {
  console.log(`\n💰 Поиск вариантов для покупки...`);
  console.log(`   Каталог (помещение): "${roomTitle}"`);
  
  try {
    // Проверяем наличие активного членства
    console.log(`\n💳 Проверка активного членства...`);
    const hasActiveMembership = await checkActiveMembership(passToken);
    console.log(`   ${hasActiveMembership ? '✅ ЕСТЬ активное членство' : '❌ НЕТ активного членства'}`);
    
    // Получаем прайс-лист
    console.log(`\n📋 Получение прайс-листа...`);
    const pricelist = await getPricelist(passToken);
    console.log(`   ✅ Получено позиций: ${pricelist.length}`);
    
    // Фильтруем позиции по категории (название категории = название помещения)
    console.log(`\n🎯 Фильтрация позиций по каталогу "${roomTitle}"...`);
    let filteredItems = pricelist.filter(item => {
      if (!item.category) return false;
      if (typeof item.category === 'object' && item.category.title) {
        return item.category.title === roomTitle;
      }
      return false;
    });
    console.log(`   Найдено позиций в каталоге: ${filteredItems.length}`);
    
    if (filteredItems.length === 0) {
      console.log(`   ⚠️  В каталоге "${roomTitle}" позиций не найдено`);
      return [];
    }
    
    // Фильтруем по наличию "Не ЧК" в зависимости от членства
    // Правила:
    // - Если в названии позиции есть "Не ЧК" - это позиция "Не ЧК"
    // - Если в названии позиции НЕТ "Не ЧК" - это позиция "ЧК" (или без обозначения)
    // - Если у клиента ЕСТЬ активное членство → показываем только позиции БЕЗ "Не ЧК" (т.е. с "ЧК" или без обозначения)
    // - Если у клиента НЕТ активного членства → показываем только позиции С "Не ЧК"
    const titleFilteredItems = filteredItems.filter(item => {
      const title = item.title || item.name || item.title_ru || '';
      const hasNotCK = title.includes('Не ЧК');
      
      if (hasActiveMembership) {
        // Если ЕСТЬ активное членство → показываем только БЕЗ "Не ЧК" (т.е. с "ЧК" или без обозначения)
        return !hasNotCK;
      } else {
        // Если НЕТ активного членства → показываем только "Не ЧК"
        return hasNotCK;
      }
    });
    
    console.log(`   Фильтр по ЧК/Не ЧК: ${hasActiveMembership ? 'Показываем БЕЗ "Не ЧК"' : 'Показываем ТОЛЬКО "Не ЧК"'}`);
    console.log(`   Итого отфильтровано: ${titleFilteredItems.length} позиций`);
    
    return titleFilteredItems;
  } catch (error) {
    console.error(`❌ Ошибка получения вариантов для покупки:`, error.message);
    return [];
  }
}

/**
 * Получение стоимости корзины с покупками
 */
async function getCartCost(passToken, purchaseId, clubId, serviceId = null) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  
  // Формируем структуру корзины
  const cartArray = [{
    purchase_id: purchaseId,
    count: 1
  }];
  
  // Если есть service_id (для записи на занятие), добавляем его
  if (serviceId) {
    cartArray[0].service_id = serviceId;
  }
  
  const cartJson = JSON.stringify({ cart_array: cartArray });
  
  const params = new URLSearchParams({
    cart: cartJson,
    club_id: clubId
  });
  
  const url = `${baseUrl}/cart_cost/?${params.toString()}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    if (response.data.result && response.data.data) {
      return response.data.data;
    } else {
      throw new Error(response.data.error_message || `Ошибка ${response.data.error}`);
    }
  } catch (error) {
    if (error.response) {
      const errorData = error.response.data;
      throw new Error(errorData.error_message || `Ошибка ${errorData.error || error.response.status}`);
    }
    throw error;
  }
}

/**
 * Создание долга (продажи без оплаты) из корзины
 */
async function createDebtFromCart(passToken, cartData, clubId, serviceId = null, appointmentId = null) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  
  // Формируем cart из данных корзины
  const cart = cartData.cart.map(item => {
    const cartItem = {
      purchase_id: item.purchase?.id || item.purchase_id,
      count: item.count || 1
    };
    
    // Добавляем price_type_id если есть
    if (item.price_type?.id) {
      cartItem.price_type_id = item.price_type.id;
    }
    
    // Добавляем service_id если есть (для привязки к занятию)
    if (serviceId) {
      cartItem.service_id = serviceId;
    }
    
    return cartItem;
  });
  
  // Для создания долга БЕЗ оплаты используем:
  // payment_list с полной суммой, но type: "card" БЕЗ card_id
  // Это создаст долг без реального списания с карты
  
  const totalAmount = cartData.total_amount || 0;
  
  // Используем вариант: card с полной суммой, но БЕЗ card_id
  // Это создаст долг без реального списания
  const payment_list = [{
    type: "card",
    amount: totalAmount
    // НЕ передаем card_id - это создаст долг без реальной оплаты
  }];
  
  // Генерируем уникальный transaction_id
  const transaction_id = `debt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  
  const requestBody = {
    transaction_id: transaction_id,
    cart: cart,
    payment_list: payment_list,
    club_id: clubId
  };
  
  // Добавляем org_id если есть в cartData
  if (cartData.org_id) {
    requestBody.org_id = cartData.org_id;
  }
  
  const url = `${baseUrl}/payment`;
  
  try {
    console.log(`\n📤 ЗАПРОС К API (создание долга):`);
    console.log(`   URL: ${url}`);
    console.log(`   Method: POST`);
    console.log(`   Transaction ID: ${transaction_id}`);
    console.log(`   Товаров в корзине: ${cart.length}`);
    if (serviceId) {
      console.log(`   Service ID (для занятия): ${serviceId}`);
    }
    if (appointmentId) {
      console.log(`   Appointment ID: ${appointmentId}`);
    }
    console.log(`\n📋 Тело запроса:`);
    console.log(JSON.stringify(requestBody, null, 2));
    
    const response = await axios.post(url, requestBody, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    console.log(`\n📥 ОТВЕТ ОТ API:`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`\n📋 Тело ответа:`);
    console.log(JSON.stringify(response.data, null, 2));
    
    // Проверяем результат
    if (!response.data.result) {
      throw new Error(response.data.error_message || `Ошибка создания долга: ${response.data.error || 'Неизвестная ошибка'}`);
    }
    
    console.log(`\n✅ Долг успешно создан (result: true)`);
    
    return {
      success: true,
      transaction_id: transaction_id,
      data: response.data.data,
      fullResponse: response.data
    };
  } catch (error) {
    console.log(`\n❌ ОШИБКА ПРИ СОЗДАНИИ ДОЛГА:`);
    if (error.response) {
      console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
      console.log(`   Response Data:`, JSON.stringify(error.response.data, null, 2));
      const errorData = error.response.data;
      throw new Error(errorData.error_message || `Ошибка ${errorData.error || error.response.status}`);
    }
    console.log(`   Error: ${error.message}`);
    throw error;
  }
}

/**
 * Получение информации о занятии
 */
async function getClassDescription(passToken, appointmentId, clubId) {
  const params = new URLSearchParams({
    appointment_id: appointmentId,
    club_id: clubId
  });
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/class_descriptions/?${params.toString()}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    if (response.data.result && response.data.data) {
      return response.data.data;
    } else {
      throw new Error(response.data.error_message || `Ошибка ${response.data.error}`);
    }
  } catch (error) {
    if (error.response) {
      const errorData = error.response.data;
      throw new Error(errorData.error_message || `Ошибка ${errorData.error || error.response.status}`);
    }
    throw error;
  }
}

/**
 * Получение списка занятий клиента
 */
async function getClientAppointments(passToken) {
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/appointments`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    } else if (response.data.data && Array.isArray(response.data.data)) {
      return response.data.data;
    }
    return [];
  } catch (error) {
    console.error(`Ошибка получения списка занятий: ${error.response?.data || error.message}`);
    return [];
  }
}

/**
 * Отмена записи клиента на групповое занятие
 */
async function cancelClassBooking(passToken, appointmentId) {
  console.log('\n🗑️  Отмена записи на занятие...');
  console.log(`   ID занятия: ${appointmentId}`);
  
  const params = new URLSearchParams({
    appointment_id: appointmentId
  });
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/client_from_class/?${params.toString()}`;
  
  console.log(`\n📤 ЗАПРОС К API (отмена записи):`);
  console.log(`   URL: ${url}`);
  console.log(`   Method: DELETE (или GET, в зависимости от API)`);
  console.log(`   Headers:`);
  console.log(`     Content-Type: application/json`);
  console.log(`     apikey: ${API_KEY.substring(0, 20)}...`);
  console.log(`     Authorization: ${AUTHORIZATION.substring(0, 20)}...`);
  console.log(`     usertoken: ${passToken.substring(0, 20)}...`);
  
  try {
    // Пробуем DELETE метод
    let response;
    try {
      response = await axios.delete(url, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY,
          'Authorization': AUTHORIZATION,
          'usertoken': passToken
        },
        httpsAgent
      });
    } catch (deleteError) {
      // Если DELETE не работает, пробуем GET
      if (deleteError.response && deleteError.response.status === 405) {
        response = await axios.get(url, {
          headers: {
            'Content-Type': 'application/json',
            'apikey': API_KEY,
            'Authorization': AUTHORIZATION,
            'usertoken': passToken
          },
          httpsAgent
        });
      } else {
        throw deleteError;
      }
    }
    
    console.log(`\n📥 ОТВЕТ ОТ API (отмена записи):`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Headers:`);
    Object.keys(response.headers).forEach(key => {
      console.log(`     ${key}: ${response.headers[key]}`);
    });
    console.log(`   Body (полный ответ):`);
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.result) {
      console.log(`\n✅ Результат: success (result: true)`);
      if (response.data.data) {
        console.log(`   Данные ответа:`);
        console.log(JSON.stringify(response.data.data, null, 2));
      }
      return response.data.data;
    } else {
      console.log(`\n❌ Результат: failure (result: false)`);
      console.log(`   Ошибка: ${response.data.error || 'Не указана'}`);
      console.log(`   Сообщение: ${response.data.error_message || 'Не указано'}`);
      throw new Error(response.data.error_message || `Ошибка ${response.data.error}`);
    }
  } catch (error) {
    console.log(`\n❌ ОШИБКА ПРИ ЗАПРОСЕ (отмена записи):`);
    if (error.response) {
      console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
      console.log(`   Headers:`);
      Object.keys(error.response.headers).forEach(key => {
        console.log(`     ${key}: ${error.response.headers[key]}`);
      });
      console.log(`   Body (полный ответ):`);
      console.log(JSON.stringify(error.response.data, null, 2));
      
      const errorData = error.response.data;
      throw new Error(errorData.error_message || `Ошибка ${errorData.error || error.response.status}`);
    } else {
      console.log(`   Тип ошибки: ${error.name || 'Unknown'}`);
      console.log(`   Сообщение: ${error.message}`);
      if (error.stack) {
        console.log(`   Stack:`);
        console.log(error.stack);
      }
    }
    throw error;
  }
}

/**
 * Запись клиента на групповое занятие
 */
async function bookClass(passToken, appointmentId, clubId, ticketId = null) {
  console.log('\n📝 Запись на занятие...');
  console.log(`   ID занятия: ${appointmentId}`);
  if (ticketId) {
    console.log(`   Основание оплаты: ${ticketId}`);
  }
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/client_to_class`;
  
  const body = {
    appointment_id: appointmentId
  };
  
  if (ticketId) {
    body.ticket_id = ticketId;
  }
  
  if (clubId) {
    body.club_id = clubId;
  }
  
  console.log(`\n📤 ЗАПРОС К API:`);
  console.log(`   URL: ${url}`);
  console.log(`   Method: POST`);
  console.log(`   Headers:`);
  console.log(`     Content-Type: application/json`);
  console.log(`     apikey: ${API_KEY.substring(0, 20)}...`);
  console.log(`     Authorization: ${AUTHORIZATION.substring(0, 20)}...`);
  console.log(`     usertoken: ${passToken.substring(0, 20)}...`);
  console.log(`   Body:`);
  console.log(JSON.stringify(body, null, 2));
  
  try {
    const response = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
    
    console.log(`\n📥 ОТВЕТ ОТ API:`);
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Headers:`);
    Object.keys(response.headers).forEach(key => {
      console.log(`     ${key}: ${response.headers[key]}`);
    });
    console.log(`   Body (полный ответ):`);
    console.log(JSON.stringify(response.data, null, 2));
    
    if (response.data.result) {
      console.log(`\n✅ Результат: success (result: true)`);
      if (response.data.data) {
        console.log(`   Данные ответа:`);
        console.log(JSON.stringify(response.data.data, null, 2));
      }
      return response.data.data;
    } else {
      console.log(`\n❌ Результат: failure (result: false)`);
      console.log(`   Ошибка: ${response.data.error || 'Не указана'}`);
      console.log(`   Сообщение: ${response.data.error_message || 'Не указано'}`);
      throw new Error(response.data.error_message || `Ошибка ${response.data.error}`);
    }
  } catch (error) {
    console.log(`\n❌ ОШИБКА ПРИ ЗАПРОСЕ:`);
    if (error.response) {
      console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
      console.log(`   Headers:`);
      Object.keys(error.response.headers).forEach(key => {
        console.log(`     ${key}: ${error.response.headers[key]}`);
      });
      console.log(`   Body (полный ответ):`);
      console.log(JSON.stringify(error.response.data, null, 2));
      
      const errorData = error.response.data;
      throw new Error(errorData.error_message || `Ошибка ${errorData.error || error.response.status}`);
    } else {
      console.log(`   Тип ошибки: ${error.name || 'Unknown'}`);
      console.log(`   Сообщение: ${error.message}`);
      if (error.stack) {
        console.log(`   Stack:`);
        console.log(error.stack);
      }
    }
    throw error;
  }
}

/**
 * Вывод информации о занятии
 */
function printClassInfo(cls) {
  console.log('\n' + '='.repeat(80));
  console.log('🎯 БЛИЖАЙШЕЕ ЗАНЯТИЕ "САЙКЛ PRO"');
  console.log('='.repeat(80));
  
  console.log(`\n📋 Основная информация:`);
  console.log(`   ID занятия: ${cls.appointment_id}`);
  console.log(`   Услуга: ${cls.service?.title || 'Не указано'}`);
  console.log(`   Направление: ${cls.service?.course?.title || 'Не указано'}`);
  console.log(`   Группа: ${cls.group?.title || 'Не указано'}`);
  
  console.log(`\n📅 Время:`);
  console.log(`   Начало: ${cls.start_date || 'Не указано'}`);
  console.log(`   Окончание: ${cls.end_date || 'Не указано'}`);
  console.log(`   Продолжительность: ${cls.duration || 'Не указано'} минут`);
  
  if (cls.start_date_replacement && cls.start_date_replacement !== cls.start_date) {
    console.log(`   ⚠️  Первоначальное время: ${cls.start_date_replacement}`);
  }
  
  console.log(`\n👤 Тренер:`);
  if (cls.employee?.id) {
    console.log(`   Имя: ${cls.employee.name || 'Не указано'}`);
    console.log(`   ID: ${cls.employee.id}`);
    console.log(`   Должность: ${cls.employee.position?.title || 'Не указано'}`);
    if (cls.employee.photo) {
      console.log(`   Фото: ${cls.employee.photo}`);
    }
  } else {
    console.log(`   Тренер не назначен`);
  }
  
  if (cls.employee_replacement?.id && cls.employee_replacement.id !== cls.employee?.id) {
    console.log(`   ⚠️  Замена тренера: ${cls.employee_replacement.name || 'Не указано'}`);
  }
  
  console.log(`\n🏠 Помещение:`);
  console.log(`   Название: ${cls.room?.title || 'Не указано'}`);
  console.log(`   ID: ${cls.room?.id || 'Не указано'}`);
  
  if (cls.room_replacement?.id && cls.room_replacement.id !== cls.room?.id) {
    console.log(`   ⚠️  Замена помещения: ${cls.room_replacement.title || 'Не указано'}`);
  }
  
  console.log(`\n👥 Запись:`);
  console.log(`   Записано: ${cls.booked || 0} из ${cls.capacity || 'неограничено'}`);
  console.log(`   Онлайн записей: ${cls.web_booked || 0}`);
  console.log(`   Емкость онлайн: ${cls.web_capacity || 'Не указано'}`);
  console.log(`   Уже записан: ${cls.already_booked ? 'Да' : 'Нет'}`);
  console.log(`   Онлайн тренировка: ${cls.online ? 'Да' : 'Нет'}`);
  console.log(`   Отменено: ${cls.canceled ? 'Да' : 'Нет'}`);
  if (cls.canceled && cls.reason_for_cancellation) {
    console.log(`   Причина отмены: ${cls.reason_for_cancellation}`);
  }
  
  console.log(`\n📝 Дополнительно:`);
  console.log(`   Тип: ${cls.type || 'Не указано'}`);
  console.log(`   Коммерческое: ${cls.commercial ? 'Да' : 'Нет'}`);
  console.log(`   Онлайн запись: ${cls.booking_online ? 'Доступна' : 'Недоступна'}`);
  
  if (cls.booking_window) {
    console.log(`   Окно записи:`);
    console.log(`     Начало: ${cls.booking_window.start_date_time || 'Не указано'}`);
    console.log(`     Окончание: ${cls.booking_window.end_date_time || 'Не указано'}`);
  }
  
  if (cls.course) {
    console.log(`\n📚 Секция:`);
    console.log(`   Название: ${cls.course.title || 'Не указано'}`);
    console.log(`   ID: ${cls.course.id || 'Не указано'}`);
    if (cls.course.cycle_period) {
      console.log(`   Период цикла: ${cls.course.cycle_period.title || 'Не указано'}`);
      console.log(`     Начало: ${cls.course.cycle_period.start_date || 'Не указано'}`);
      console.log(`     Окончание: ${cls.course.cycle_period.end_date || 'Не указано'}`);
    }
  }
  
  if (cls.service_replacement && cls.service_replacement.id !== cls.service?.id) {
    console.log(`\n⚠️  Замена услуги:`);
    console.log(`   Первоначальная услуга: ${cls.service_replacement.title || 'Не указано'}`);
  }
  
  if (cls.badges && cls.badges.length > 0) {
    console.log(`\n🏷️  Бейджи:`);
    cls.badges.forEach(badge => {
      console.log(`   ${badge.unicode || ''} ${badge.title || 'Не указано'}`);
    });
  }
  
  if (cls.use_waiting_list !== undefined) {
    console.log(`\n📋 Лист ожидания: ${cls.use_waiting_list ? 'Доступен' : 'Недоступен'}`);
  }
  
  console.log(`\n${'='.repeat(80)}\n`);
}

/**
 * Главная функция
 */
async function main() {
  try {
    console.log('🚀 Поиск ближайшего занятия "САЙКЛ PRO"');
    console.log('='.repeat(80));
    
    // 1. Получаем pass_token
    const passToken = await getPassToken(PHONE);
    
    // 2. Получаем данные клиента и club_id
    const clientData = await getClient(passToken);
    const clubId = clientData.club.id;
    
    // 3. Формируем период поиска (сегодня + 30 дней)
    const now = new Date();
    const startDate = now.toISOString().slice(0, 16).replace('T', ' ');
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 16).replace('T', ' ');
    
    // 4. Получаем расписание
    const classes = await getClasses(passToken, clubId, startDate, endDate);
    
    // 5. Ищем ближайшее занятие "САЙКЛ PRO"
    console.log(`\n🔍 Поиск занятий с текстом "${SEARCH_TEXT}"...`);
    const nextClass = findNextSaiklPro(classes, SEARCH_TEXT);
    
    if (!nextClass) {
      console.log(`\n❌ Занятия "${SEARCH_TEXT}" не найдены в ближайшие 30 дней`);
      console.log(`   Или все найденные занятия уже прошли или отменены`);
      return;
    }
    
    // 6. Проверяем статус занятия и запись клиента
    console.log('\n🔍 Проверка статуса занятия и записи клиента...');
    
    // Проверяем, не отменено ли само занятие
    if (nextClass.canceled) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('❌ ЗАНЯТИЕ ОТМЕНЕНО');
      console.log('='.repeat(80));
      console.log(`\n📋 Информация:`);
      console.log(`   Дата и время: ${nextClass.start_date || 'Не указано'}`);
      if (nextClass.reason_for_cancellation) {
        console.log(`   Причина отмены: ${nextClass.reason_for_cancellation}`);
      }
      console.log(`\n⚠️  Запись на отмененное занятие невозможна`);
      console.log(`\n✅ Скрипт выполнен. Занятие найдено, но отменено.`);
      return; // Завершаем выполнение
    }
    
    let alreadyBooked = false;
    let isCanceled = false;
    let appointmentStatus = null;
    let existingAppointment = null;
    
    // Проверяем через already_booked из занятия
    if (nextClass.already_booked) {
      alreadyBooked = true;
      console.log(`   ✅ Клиент УЖЕ записан на это занятие`);
    }
    
    // Проверяем через список занятий клиента
    const clientAppointments = await getClientAppointments(passToken);
    existingAppointment = clientAppointments.find(apt => 
      apt.appointment_id === nextClass.appointment_id
    );
    
    if (existingAppointment) {
      alreadyBooked = true;
      appointmentStatus = existingAppointment.status;
      const arrivalStatus = existingAppointment.arrival_status;
      console.log(`   ✅ Занятие найдено в списке занятий клиента`);
      console.log(`   Статус: ${appointmentStatus || 'Не указан'}`);
      console.log(`   Статус прибытия: ${arrivalStatus || 'Не указан'}`);
      console.log(`   В листе ожидания: ${existingAppointment.waiting_list ? 'Да' : 'Нет'}`);
      
      // Проверяем статус прибытия - если canceled/cancelled, клиент в отмененных
      if (arrivalStatus === 'canceled' || arrivalStatus === 'cancelled') {
        isCanceled = true;
        console.log(`   ⚠️  Клиент в числе ОТМЕНЕННЫХ (arrival_status: ${arrivalStatus})`);
        if (existingAppointment.reason_client) {
          console.log(`   Причина отмены клиентом: ${existingAppointment.reason_client}`);
        }
      }
      
      // Также проверяем статус занятия
      if (appointmentStatus === 'canceled') {
        isCanceled = true;
        console.log(`   ⚠️  Запись клиента ОТМЕНЕНА (status: canceled)`);
        if (existingAppointment.reason_appointment) {
          console.log(`   Причина отмены: ${existingAppointment.reason_appointment}`);
        }
        if (existingAppointment.reason_client) {
          console.log(`   Причина отмены клиентом: ${existingAppointment.reason_client}`);
        }
      }
    } else if (!nextClass.already_booked) {
      console.log(`   ℹ️  Клиент НЕ записан на это занятие`);
    }
    
    // Если клиент в отмененных (arrival_status === 'canceled') - удаляем из состава занятия
    if (isCanceled) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('⚠️  КЛИЕНТ В ОТМЕНЕННЫХ');
      console.log('='.repeat(80));
      console.log(`\n📋 Информация:`);
      if (existingAppointment) {
        console.log(`   Статус занятия: ${existingAppointment.status || 'Не указан'}`);
        console.log(`   Статус прибытия: ${existingAppointment.arrival_status || 'Не указан'}`);
        
        if (existingAppointment.arrival_status === 'canceled' || existingAppointment.arrival_status === 'cancelled') {
          console.log(`   ⚠️  Клиент отменил запись (arrival_status: ${existingAppointment.arrival_status})`);
        }
        
        if (existingAppointment.status === 'canceled') {
          console.log(`   ⚠️  Запись отменена (status: canceled)`);
        }
        
        if (existingAppointment.reason_appointment) {
          console.log(`   Причина отмены: ${existingAppointment.reason_appointment}`);
        }
        if (existingAppointment.reason_client) {
          console.log(`   Причина отмены клиентом: ${existingAppointment.reason_client}`);
        }
        
        if (existingAppointment.payment) {
          console.log(`\n💳 Основание оплаты:`);
          console.log(`   Название: ${existingAppointment.payment.title || 'Не указано'}`);
          console.log(`   Тип: ${existingAppointment.payment.type || 'Не указан'}`);
          console.log(`   ID билета: ${existingAppointment.payment.ticket_id || 'Не указан'}`);
        }
      }
      
      // Удаляем клиента из состава занятия через /client_from_class
      try {
        const cancelResult = await cancelClassBooking(passToken, nextClass.appointment_id);
        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ КЛИЕНТ БЫЛ В ОТМЕНЕННЫХ, ПОЭТОМУ БЫЛ УДАЛЕН ИЗ СОСТАВА ЗАНЯТИЯ ОКОНЧАТЕЛЬНО');
        console.log('='.repeat(80));
        if (cancelResult) {
          console.log(`\n📋 Результат удаления:`);
          console.log(`   Статус: ${cancelResult.status || 'Не указан'}`);
          if (cancelResult.appointment) {
            console.log(`   Занятие: ${cancelResult.appointment.title || 'Не указано'}`);
            console.log(`   Дата: ${cancelResult.appointment.date_time || 'Не указано'}`);
          }
        }
        
        // После удаления записываем клиента заново
        console.log(`\n${'='.repeat(80)}`);
        console.log('🔄 ПОВТОРНАЯ ЗАПИСЬ НА ЗАНЯТИЕ');
        console.log('='.repeat(80));
        console.log(`\n💡 Пытаемся записать клиента заново (даже если билетов не найдено)`);
        console.log(`   Система сама найдет доступные билеты`);
        
        // Получаем список активных билетов для записи (для информации)
        const ticketsForReBooking = await getTickets(passToken);
        
        let ticketId = null;
        if (ticketsForReBooking.length > 0) {
          // Выбираем подходящий билет
          const suitableTicket = ticketsForReBooking.find(ticket => {
            if (ticket.service_list && Array.isArray(ticket.service_list)) {
              return ticket.service_list.some(service => 
                service.count === null || service.count > 0
              );
            }
            return ticket.count === null || ticket.count > 0;
          }) || ticketsForReBooking[0];
          
          ticketId = suitableTicket.ticket_id;
          console.log(`\n🎫 Используем билет для повторной записи: ${suitableTicket.title} (${suitableTicket.type})`);
          console.log(`   ID билета: ${ticketId}`);
        } else {
          console.log(`\n⚠️  Активных билетов не найдено через API`);
          console.log(`   Пробуем записаться БЕЗ ticket_id - система сама найдет доступные билеты`);
        }
        
        // Записываем клиента заново (даже если ticketId = null)
        const bookingResult = await bookClass(
          passToken, 
          nextClass.appointment_id, 
          clientData.club.id,
          ticketId
        );
        
        // Выводим результат повторной записи
        console.log(`\n${'='.repeat(80)}`);
        console.log('📋 РЕЗУЛЬТАТ ПОВТОРНОЙ ПОПЫТКИ ЗАПИСИ НА ЗАНЯТИЕ');
        console.log('='.repeat(80));
        console.log(`\n📋 Статус записи: ${bookingResult.status || 'Не указан'}`);
        console.log(`   Временно зарезервировано: ${bookingResult.temporarily_reserved ? 'Да' : 'Нет'}`);
        console.log(`   Онлайн тренировка: ${bookingResult.online ? 'Да' : 'Нет'}`);
        
        if (bookingResult.appointment) {
          console.log(`\n📅 Информация о занятии:`);
          console.log(`   ID: ${bookingResult.appointment.id || 'Не указано'}`);
          console.log(`   Название: ${bookingResult.appointment.title || 'Не указано'}`);
          console.log(`   Тренер: ${bookingResult.appointment.employee_name || 'Не указано'}`);
          console.log(`   Дата и время: ${bookingResult.appointment.date_time || 'Не указано'}`);
        }
        
        if (bookingResult.customer) {
          console.log(`\n👤 Клиент:`);
          console.log(`   ID: ${bookingResult.customer.id || 'Не указано'}`);
          console.log(`   ФИО: ${bookingResult.customer.client_name || 'Не указано'}`);
        }
        
        console.log(`\n${'='.repeat(80)}`);
        
        // Проверяем статус - если temporarily_reserved_need_payment, отменяем и пробуем заново
        if (bookingResult.status === 'temporarily_reserved_need_payment') {
          console.log(`\n⚠️  Статус ${bookingResult.status} - это может быть от предыдущей попытки`);
          console.log(`   Отменяем запись и пробуем записаться заново...\n`);
          
          // Отменяем запись
          try {
            await cancelClassBooking(passToken, nextClass.appointment_id);
            console.log(`✅ Запись отменена`);
          } catch (cancelError) {
            console.log(`⚠️  Ошибка при отмене записи: ${cancelError.message}`);
          }
          
          // Получаем билеты для повторной попытки
          const ticketsForRetry = await getTickets(passToken);
          let ticketIdForRetry = null;
          
          if (ticketsForRetry.length > 0) {
            const suitableTicket = ticketsForRetry.find(ticket => {
              if (ticket.service_list && Array.isArray(ticket.service_list)) {
                return ticket.service_list.some(service => 
                  service.count === null || service.count > 0
                );
              }
              return ticket.count === null || ticket.count > 0;
            }) || ticketsForRetry[0];
            
            ticketIdForRetry = suitableTicket.ticket_id;
            console.log(`🎫 Используем билет для повторной попытки: ${suitableTicket.title}`);
          } else {
            console.log(`⚠️  Активных билетов не найдено, пробуем без ticket_id`);
          }
          
          // Пробуем записаться заново
          console.log(`\n🔄 Повторная попытка записи...`);
          const retryBookingResult = await bookClass(
            passToken, 
            nextClass.appointment_id, 
            clientData.club.id,
            ticketIdForRetry
          );
          
          console.log(`\n📋 Статус после повторной попытки: ${retryBookingResult.status || 'Не указан'}`);
          
          // Если снова temporarily_reserved_need_payment, значит действительно нет оснований
          if (retryBookingResult.status === 'temporarily_reserved_need_payment') {
            console.log(`\n⚠️  КЛИЕНТ НЕ ЗАПИСАН: отсутствуют основания для записи`);
            console.log(`   Статус ${retryBookingResult.status} означает, что запись не подтверждена`);
            console.log(`   Необходимо приобрести один из вариантов ниже для подтверждения записи\n`);
            
            // Выводим варианты для покупки
            const roomTitle = nextClass.room?.title;
            if (roomTitle) {
              console.log(`🔍 Поиск вариантов для покупки в категории "${roomTitle}"...`);
              const purchaseOptions = await getPurchaseOptions(passToken, roomTitle);
              
              if (purchaseOptions.length > 0) {
                console.log(`\n✅ Найдено вариантов для приобретения: ${purchaseOptions.length}\n`);
                console.log(`📋 Варианты для приобретения (с учетом ЧК/Не ЧК):\n`);
                
                purchaseOptions.forEach((option, index) => {
                  console.log(`   ${index + 1}. ${option.title || option.name || 'Без названия'}`);
                  console.log(`      ID: ${option.id || option.purchase_id || 'Не указан'}`);
                  if (option.price !== undefined && option.price !== null) {
                    console.log(`      Цена: ${option.price} ₽`);
                  }
                  console.log('');
                });
                
                // Создаем корзину с первым вариантом
                const firstOption = purchaseOptions[0];
                const purchaseId = firstOption.id || firstOption.purchase_id;
                const serviceId = nextClass.service?.id || null;
                
                if (purchaseId) {
                  console.log(`\n🛒 Создание корзины с первым вариантом...`);
                  console.log(`   Товар: ${firstOption.title || firstOption.name || 'Без названия'}`);
                  console.log(`   ID: ${purchaseId}`);
                  
                  try {
                    const cartData = await getCartCost(passToken, purchaseId, clientData.club.id, serviceId);
                    
                    // Дополнительная проверка: убеждаемся, что корзина действительно создана
                    if (!cartData || !cartData.cart || cartData.cart.length === 0) {
                      throw new Error('Корзина не была создана: данные корзины отсутствуют или корзина пуста');
                    }
                    
                    console.log(`\n✅ Корзина успешно создана и проверена через API`);
                    console.log(`\n${'='.repeat(80)}`);
                    console.log('🛒 ИНФОРМАЦИЯ О КОРЗИНЕ');
                    console.log('='.repeat(80));
                    
                    if (cartData.cart && cartData.cart.length > 0) {
                      const cartItem = cartData.cart[0];
                      console.log(`\n📦 Товар в корзине:`);
                      console.log(`   Название: ${cartItem.purchase?.title || 'Не указано'}`);
                      console.log(`   ID: ${cartItem.purchase?.id || 'Не указан'}`);
                      console.log(`   Количество: ${cartItem.count || 1}`);
                      
                      if (cartItem.price_type) {
                        console.log(`\n💰 Тип цены:`);
                        console.log(`   Название: ${cartItem.price_type.title || 'Не указано'}`);
                        console.log(`   ID: ${cartItem.price_type.id || 'Не указан'}`);
                        console.log(`   Цена за единицу: ${cartItem.price || 0} ₽`);
                      }
                      
                      console.log(`\n💵 Стоимость:`);
                      console.log(`   Цена: ${cartItem.price || 0} ₽`);
                      console.log(`   Скидка: ${cartItem.discount_sum || 0} ₽`);
                      console.log(`   К оплате: ${cartItem.payment_amount || 0} ₽`);
                      
                      if (cartItem.tax_sum !== undefined && cartItem.tax_sum !== null) {
                        console.log(`   НДС: ${cartItem.tax_sum || 0} ₽`);
                      }
                    }
                    
                    console.log(`\n📊 Итого по корзине:`);
                    console.log(`   Общая стоимость: ${cartData.total_amount || 0} ₽`);
                    console.log(`   Общая скидка: ${cartData.total_discount || 0} ₽`);
                    
                    if (cartData.may_be_payment && cartData.may_be_payment.length > 0) {
                      console.log(`\n💳 Возможные способы оплаты:`);
                      cartData.may_be_payment.forEach((payment, index) => {
                        console.log(`   ${index + 1}. ${payment.title || 'Не указано'}`);
                        console.log(`      ID: ${payment.id || 'Не указан'}`);
                        console.log(`      Тип: ${payment.type || 'Не указан'}`);
                        console.log(`      Сумма: ${payment.payment_amount || 0} ₽`);
                        if (payment.balance !== undefined) {
                          console.log(`      Баланс: ${payment.balance || 0} ₽`);
                        }
                      });
                    }
                    
                    if (cartData.promotions && cartData.promotions.length > 0) {
                      console.log(`\n🎁 Маркетинговые акции:`);
                      cartData.promotions.forEach((promo, index) => {
                        console.log(`   ${index + 1}. ${promo.title || 'Не указано'}`);
                        console.log(`      Тип: ${promo.type || 'Не указан'}`);
                        if (promo.amount !== undefined) {
                          console.log(`      Сумма: ${promo.amount || 0} ₽`);
                        }
                        if (promo.count !== undefined) {
                          console.log(`      Количество: ${promo.count || 0}`);
                        }
                      });
                    }
                    
                    console.log(`\n${'='.repeat(80)}`);
                    
                    // Создаем долг из корзины
                    try {
                      console.log(`\n💳 Создание долга из корзины...`);
                      const debtResult = await createDebtFromCart(
                        passToken, 
                        cartData, 
                        clientData.club.id, 
                        serviceId,
                        nextClass.appointment_id
                      );
                      
                      console.log(`\n${'='.repeat(80)}`);
                      console.log('✅ ДОЛГ УСПЕШНО СОЗДАН');
                      console.log('='.repeat(80));
                      console.log(`\n📋 Информация о долге:`);
                      console.log(`   Transaction ID: ${debtResult.transaction_id}`);
                      console.log(`   Статус: Успешно создан`);
                      if (debtResult.fullResponse) {
                        console.log(`   Данные ответа:`, JSON.stringify(debtResult.fullResponse, null, 2));
                      }
                      
                      // Проверяем долги клиента после создания
                      console.log(`\n${'='.repeat(80)}`);
                      console.log('🔍 ПРОВЕРКА ДОЛГОВ КЛИЕНТА ПОСЛЕ СОЗДАНИЯ');
                      console.log('='.repeat(80));
                      
                      try {
                        const debtsUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/debts`;
                        const debtsResponse = await axios.get(debtsUrl, {
                          headers: {
                            'Content-Type': 'application/json',
                            'apikey': API_KEY,
                            'Authorization': AUTHORIZATION,
                            'usertoken': passToken
                          },
                          httpsAgent
                        });
                        
                        if (debtsResponse.data.result && debtsResponse.data.data) {
                          const debts = debtsResponse.data.data;
                          const clubDebts = debts.find(d => d.club.id === clientData.club.id);
                          
                          if (clubDebts && clubDebts.debts && clubDebts.debts.length > 0) {
                            // Берем последний долг (самый свежий)
                            const lastDebt = clubDebts.debts[clubDebts.debts.length - 1];
                            console.log(`\n📋 Последний созданный долг:`);
                            console.log(`   ID: ${lastDebt.id}`);
                            console.log(`   Дата: ${lastDebt.date}`);
                            console.log(`   Общая сумма: ${lastDebt.total_amount} ₽`);
                            console.log(`   Оплачено: ${lastDebt.paid_amount} ₽`);
                            console.log(`   Задолженность: ${lastDebt.debt_amount} ₽`);
                            console.log(`   К оплате: ${lastDebt.payable_amount} ₽`);
                            console.log(`   Описание: ${lastDebt.description || 'Не указано'}`);
                            
                            if (lastDebt.debt_amount > 0) {
                              console.log(`\n✅ Долг НЕ оплачен (задолженность: ${lastDebt.debt_amount} ₽)`);
                              console.log(`   Долг создан БЕЗ оплаты. После оплаты запись на занятие будет подтверждена.`);
                            } else {
                              console.log(`\n⚠️  Долг оплачен полностью (paid_amount: ${lastDebt.paid_amount} ₽)`);
                              console.log(`   Возможно, долг был автоматически оплачен при создании.`);
                            }
                          }
                        }
                      } catch (debtsError) {
                        console.log(`\n⚠️  Не удалось проверить долги: ${debtsError.message}`);
                      }
                      
                      console.log(`\n${'='.repeat(80)}`);
                    } catch (debtError) {
                      console.error(`\n${'='.repeat(80)}`);
                      console.error('❌ ОШИБКА ПРИ СОЗДАНИИ ДОЛГА');
                      console.error('='.repeat(80));
                      console.error(`\n❌ ${debtError.message}`);
                      if (debtError.response) {
                        console.error(`\n📥 Ответ от API:`);
                        console.error(`   Status: ${debtError.response.status} ${debtError.response.statusText}`);
                        console.error(`   Data:`, JSON.stringify(debtError.response.data, null, 2));
                      }
                      console.log(`\n⚠️  Корзина создана, но долг не был создан.`);
                      console.log(`\n${'='.repeat(80)}`);
                    }
                  } catch (cartError) {
                    console.error(`\n❌ Ошибка при создании корзины: ${cartError.message}`);
                  }
                }
                
                console.log(`\n💡 Для подтверждения записи создайте продажу одного из указанных вариантов.`);
              } else {
                console.log(`\n⚠️  Варианты для приобретения не найдены в категории "${roomTitle}".`);
              }
            } else {
              console.log(`\n⚠️  Не удалось определить название помещения для поиска вариантов покупки.`);
            }
            
            console.log(`\n✅ Скрипт выполнен. Клиент удален из отмененных, но не записан (нет оснований).`);
          } else {
            console.log(`\n✅ Скрипт выполнен. Клиент удален из отмененных и записан заново.`);
          }
        } else {
          console.log(`\n✅ Скрипт выполнен. Клиент удален из отмененных и записан заново.`);
        }
      } catch (error) {
        console.error(`\n❌ Ошибка при удалении/повторной записи:`);
        console.error(`   ${error.message}`);
        console.log(`\n⚠️  Клиент в отмененных, но операция не удалась.`);
        console.log(`\n✅ Скрипт выполнен.`);
      }
      return; // Завершаем выполнение
    }
    
    // Если клиент уже записан и НЕ в отмененных - проверяем статус
    if (alreadyBooked && !isCanceled) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('📋 ПРОВЕРКА СТАТУСА ЗАПИСИ КЛИЕНТА');
      console.log('='.repeat(80));
      
      // Получаем статус записи для проверки
      let currentAppointmentStatus = appointmentStatus;
      let roomTitle = null;
      
      if (existingAppointment) {
        console.log(`\n📋 Подробная информация о записи:`);
        console.log(`   ID записи: ${existingAppointment.appointment_id || 'Не указан'}`);
        console.log(`   Статус занятия: ${appointmentStatus || 'Не указан'}`);
        
        // Сохраняем статус из existingAppointment, если есть
        if (existingAppointment.status) {
          currentAppointmentStatus = existingAppointment.status;
        }
        
        const arrivalStatus = existingAppointment.arrival_status;
        console.log(`   Статус прибытия: ${arrivalStatus || 'Не указан'}`);
        
        if (arrivalStatus === 'arrived') {
          console.log(`   ✅ Клиент прибыл на занятие`);
        } else if (arrivalStatus === 'not_arrived') {
          console.log(`   ⏳ Клиент еще не прибыл`);
        } else if (arrivalStatus === 'canceled' || arrivalStatus === 'cancelled') {
          console.log(`   ❌ Клиент отменил посещение`);
        }
        
        console.log(`   Тип занятия: ${existingAppointment.type || 'Не указан'}`);
        console.log(`   В листе ожидания: ${existingAppointment.waiting_list ? 'Да' : 'Нет'}`);
        
        if (existingAppointment.reason_appointment) {
          console.log(`   Причина отмены занятия: ${existingAppointment.reason_appointment}`);
        }
        if (existingAppointment.reason_client) {
          console.log(`   Причина отмены клиентом: ${existingAppointment.reason_client}`);
        }
        
        if (existingAppointment.start_date) {
          console.log(`\n📅 Время занятия:`);
          console.log(`   Начало: ${existingAppointment.start_date || 'Не указано'}`);
          console.log(`   Окончание: ${existingAppointment.end_date || 'Не указано'}`);
          console.log(`   Продолжительность: ${existingAppointment.duration || 'Не указано'} минут`);
        }
        
        if (existingAppointment.service) {
          console.log(`\n🎯 Услуга:`);
          console.log(`   Название: ${existingAppointment.service.title || 'Не указано'}`);
          console.log(`   ID: ${existingAppointment.service.id || 'Не указан'}`);
          if (existingAppointment.service.description) {
            console.log(`   Описание: ${existingAppointment.service.description.substring(0, 100)}${existingAppointment.service.description.length > 100 ? '...' : ''}`);
          }
        }
        
        if (existingAppointment.employee) {
          console.log(`\n👤 Тренер:`);
          console.log(`   Имя: ${existingAppointment.employee.name || 'Не указано'}`);
          console.log(`   ID: ${existingAppointment.employee.id || 'Не указан'}`);
          if (existingAppointment.employee.position) {
            console.log(`   Должность: ${existingAppointment.employee.position.title || 'Не указана'}`);
          }
        }
        
        if (existingAppointment.room) {
          console.log(`\n🏠 Помещение:`);
          console.log(`   Название: ${existingAppointment.room.title || 'Не указано'}`);
          console.log(`   ID: ${existingAppointment.room.id || 'Не указан'}`);
          roomTitle = existingAppointment.room.title;
        }
        
        if (existingAppointment.payment) {
          console.log(`\n💳 Основание оплаты:`);
          console.log(`   Название: ${existingAppointment.payment.title || 'Не указано'}`);
          console.log(`   Тип: ${existingAppointment.payment.type || 'Не указан'}`);
          console.log(`   ID билета: ${existingAppointment.payment.ticket_id || 'Не указан'}`);
        }
        
        if (existingAppointment.cost !== undefined && existingAppointment.cost !== null) {
          console.log(`\n💰 Стоимость занятия: ${existingAppointment.cost} ₽`);
        }
        
        if (existingAppointment.pre_entry !== undefined) {
          console.log(`   Предварительная запись: ${existingAppointment.pre_entry ? 'Разрешена' : 'Запрещена'}`);
        }
        
        if (existingAppointment.commercial !== undefined) {
          console.log(`   Коммерческое занятие: ${existingAppointment.commercial ? 'Да' : 'Нет'}`);
        }
        
        if (existingAppointment.marketing_badges && existingAppointment.marketing_badges.length > 0) {
          console.log(`\n🏷️  Бейджи:`);
          existingAppointment.marketing_badges.forEach(badge => {
            console.log(`   - ${badge || 'Не указано'}`);
          });
        }
      } else {
        // Если нет данных в existingAppointment, но already_booked = true
        // Используем информацию из самого занятия и дополнительно получаем через class_descriptions
        console.log(`\n📋 Подробная информация о записи:`);
        console.log(`   ID занятия: ${nextClass.appointment_id || 'Не указан'}`);
        console.log(`   Клиент записан: Да (already_booked: true)`);
        
        // Пробуем получить дополнительную информацию через class_descriptions
        let classInfo = null;
        try {
          classInfo = await getClassDescription(passToken, nextClass.appointment_id, clientData.club.id);
          
          console.log(`\n📊 Детальный статус записи:`);
          console.log(`   Статус записи: ${classInfo.already_booked ? 'Записан' : 'Не записан'}`);
          // Обновляем статус из classInfo
          currentAppointmentStatus = classInfo.status || currentAppointmentStatus || 'Не указан';
          console.log(`   Статус занятия: ${currentAppointmentStatus}`);
          console.log(`   Требуется оплата: ${classInfo.payment_required ? 'Да' : 'Нет'}`);
          console.log(`   Отменено: ${classInfo.canceled ? 'Да' : 'Нет'}`);
          
          if (classInfo.client_in_the_waiting_list) {
            console.log(`   ⚠️  Клиент в листе ожидания: Да`);
          }
          
          if (classInfo.waiting_list_client_status) {
            console.log(`   Действие в листе ожидания: ${classInfo.waiting_list_client_status}`);
          }
          
          if (classInfo.waiting_list_message) {
            console.log(`   Сообщение: ${classInfo.waiting_list_message}`);
          }
          
          console.log(`\n👥 Свободные места: ${classInfo.available_slots || 'Не указано'}`);
          console.log(`   Емкость: ${classInfo.capacity || 'Не указано'}`);
          
          if (classInfo.cost !== undefined && classInfo.cost !== null) {
            console.log(`   Стоимость занятия: ${classInfo.cost} ₽`);
          }
        } catch (error) {
          console.log(`   ⚠️  Не удалось получить детальную информацию: ${error.message}`);
        }
        
        if (nextClass.start_date) {
          console.log(`\n📅 Время занятия:`);
          console.log(`   Начало: ${nextClass.start_date || 'Не указано'}`);
          console.log(`   Окончание: ${nextClass.end_date || 'Не указано'}`);
          console.log(`   Продолжительность: ${nextClass.duration || 'Не указано'} минут`);
        }
        
        if (nextClass.service) {
          console.log(`\n🎯 Услуга:`);
          console.log(`   Название: ${nextClass.service.title || 'Не указано'}`);
          console.log(`   ID: ${nextClass.service.id || 'Не указан'}`);
        }
        
        if (nextClass.employee) {
          console.log(`\n👤 Тренер:`);
          console.log(`   Имя: ${nextClass.employee.name || 'Не указано'}`);
          console.log(`   ID: ${nextClass.employee.id || 'Не указан'}`);
          if (nextClass.employee.position) {
            console.log(`   Должность: ${nextClass.employee.position.title || 'Не указана'}`);
          }
        }
        
        if (nextClass.room) {
          console.log(`\n🏠 Помещение:`);
          console.log(`   Название: ${nextClass.room.title || 'Не указано'}`);
          console.log(`   ID: ${nextClass.room.id || 'Не указан'}`);
          roomTitle = nextClass.room.title;
        }
        
        console.log(`\n👥 Информация о записи:`);
        console.log(`   Записано: ${nextClass.booked || 0} из ${nextClass.capacity || 'неограничено'}`);
        console.log(`   Онлайн записей: ${nextClass.web_booked || 0}`);
        console.log(`   Емкость онлайн: ${nextClass.web_capacity || 'Не указано'}`);
        console.log(`   Онлайн тренировка: ${nextClass.online ? 'Да' : 'Нет'}`);
        console.log(`   Отменено: ${nextClass.canceled ? 'Да' : 'Нет'}`);
        
        if (nextClass.commercial !== undefined) {
          console.log(`   Коммерческое занятие: ${nextClass.commercial ? 'Да' : 'Нет'}`);
        }
        
        if (nextClass.booking_online !== undefined) {
          console.log(`   Онлайн запись: ${nextClass.booking_online ? 'Доступна' : 'Недоступна'}`);
        }
        
        if (nextClass.badges && nextClass.badges.length > 0) {
          console.log(`\n🏷️  Бейджи:`);
          nextClass.badges.forEach(badge => {
            console.log(`   ${badge.unicode || ''} ${badge.title || 'Не указано'}`);
          });
        }
      }
      
      // Проверяем статус temporarily_reserved_need_payment - отменяем и пробуем заново
      if (currentAppointmentStatus === 'temporarily_reserved_need_payment') {
        console.log(`\n${'='.repeat(80)}`);
        console.log('⚠️  Статус temporarily_reserved_need_payment - это может быть от предыдущей попытки');
        console.log('='.repeat(80));
        console.log(`\n🔄 Отменяем запись и пробуем записаться заново...\n`);
        
        // Отменяем запись
        try {
          await cancelClassBooking(passToken, nextClass.appointment_id);
          console.log(`✅ Запись отменена`);
        } catch (cancelError) {
          console.log(`⚠️  Ошибка при отмене записи: ${cancelError.message}`);
        }
        
        // Получаем билеты для повторной попытки
        const ticketsForRetry = await getTickets(passToken);
        let ticketIdForRetry = null;
        
        if (ticketsForRetry.length > 0) {
          const suitableTicket = ticketsForRetry.find(ticket => {
            if (ticket.service_list && Array.isArray(ticket.service_list)) {
              return ticket.service_list.some(service => 
                service.count === null || service.count > 0
              );
            }
            return ticket.count === null || ticket.count > 0;
          }) || ticketsForRetry[0];
          
          ticketIdForRetry = suitableTicket.ticket_id;
          console.log(`🎫 Используем билет для повторной попытки: ${suitableTicket.title}`);
        } else {
          console.log(`⚠️  Активных билетов не найдено, пробуем без ticket_id`);
        }
        
        // Пробуем записаться заново
        console.log(`\n🔄 Повторная попытка записи...`);
        const retryBookingResult = await bookClass(
          passToken, 
          nextClass.appointment_id, 
          clientData.club.id,
          ticketIdForRetry
        );
        
        console.log(`\n📋 Статус после повторной попытки: ${retryBookingResult.status || 'Не указан'}`);
        
        // Если снова temporarily_reserved_need_payment, значит действительно нет оснований
        if (retryBookingResult.status === 'temporarily_reserved_need_payment') {
          console.log(`\n⚠️  КЛИЕНТ НЕ ЗАПИСАН: отсутствуют основания для записи`);
          console.log(`   Статус ${retryBookingResult.status} означает, что запись не подтверждена`);
          console.log(`   Необходимо приобрести один из вариантов ниже для подтверждения записи\n`);
          
          if (roomTitle) {
            console.log(`🔍 Поиск вариантов для покупки в категории "${roomTitle}"...`);
            const purchaseOptions = await getPurchaseOptions(passToken, roomTitle);
            
            if (purchaseOptions.length > 0) {
              console.log(`\n✅ Найдено вариантов для приобретения: ${purchaseOptions.length}\n`);
              console.log(`📋 Варианты для приобретения (с учетом ЧК/Не ЧК):\n`);
              
              purchaseOptions.forEach((option, index) => {
                console.log(`   ${index + 1}. ${option.title || option.name || 'Без названия'}`);
                console.log(`      ID: ${option.id || option.purchase_id || 'Не указан'}`);
                if (option.price !== undefined && option.price !== null) {
                  console.log(`      Цена: ${option.price} ₽`);
                }
                console.log('');
              });
              
              // Создаем корзину с первым вариантом
              const firstOption = purchaseOptions[0];
              const purchaseId = firstOption.id || firstOption.purchase_id;
              const serviceId = nextClass.service?.id || null;
              
              if (purchaseId) {
                console.log(`\n🛒 Создание корзины с первым вариантом...`);
                console.log(`   Товар: ${firstOption.title || firstOption.name || 'Без названия'}`);
                console.log(`   ID: ${purchaseId}`);
                
                try {
                  const cartData = await getCartCost(passToken, purchaseId, clientData.club.id, serviceId);
                  
                  // Дополнительная проверка: убеждаемся, что корзина действительно создана
                  if (!cartData || !cartData.cart || cartData.cart.length === 0) {
                    throw new Error('Корзина не была создана: данные корзины отсутствуют или корзина пуста');
                  }
                  
                  console.log(`\n✅ Корзина успешно создана и проверена через API`);
                  console.log(`\n${'='.repeat(80)}`);
                  console.log('🛒 ИНФОРМАЦИЯ О КОРЗИНЕ');
                  console.log('='.repeat(80));
                  
                  if (cartData.cart && cartData.cart.length > 0) {
                    const cartItem = cartData.cart[0];
                    console.log(`\n📦 Товар в корзине:`);
                    console.log(`   Название: ${cartItem.purchase?.title || 'Не указано'}`);
                    console.log(`   ID: ${cartItem.purchase?.id || 'Не указан'}`);
                    console.log(`   Количество: ${cartItem.count || 1}`);
                    
                    if (cartItem.price_type) {
                      console.log(`\n💰 Тип цены:`);
                      console.log(`   Название: ${cartItem.price_type.title || 'Не указано'}`);
                      console.log(`   ID: ${cartItem.price_type.id || 'Не указан'}`);
                      console.log(`   Цена за единицу: ${cartItem.price || 0} ₽`);
                    }
                    
                    console.log(`\n💵 Стоимость:`);
                    console.log(`   Цена: ${cartItem.price || 0} ₽`);
                    console.log(`   Скидка: ${cartItem.discount_sum || 0} ₽`);
                    console.log(`   К оплате: ${cartItem.payment_amount || 0} ₽`);
                    
                    if (cartItem.tax_sum !== undefined && cartItem.tax_sum !== null) {
                      console.log(`   НДС: ${cartItem.tax_sum || 0} ₽`);
                    }
                  }
                  
                  console.log(`\n📊 Итого по корзине:`);
                  console.log(`   Общая стоимость: ${cartData.total_amount || 0} ₽`);
                  console.log(`   Общая скидка: ${cartData.total_discount || 0} ₽`);
                  
                  if (cartData.may_be_payment && cartData.may_be_payment.length > 0) {
                    console.log(`\n💳 Возможные способы оплаты:`);
                    cartData.may_be_payment.forEach((payment, index) => {
                      console.log(`   ${index + 1}. ${payment.title || 'Не указано'}`);
                      console.log(`      ID: ${payment.id || 'Не указан'}`);
                      console.log(`      Тип: ${payment.type || 'Не указан'}`);
                      console.log(`      Сумма: ${payment.payment_amount || 0} ₽`);
                      if (payment.balance !== undefined) {
                        console.log(`      Баланс: ${payment.balance || 0} ₽`);
                      }
                    });
                  }
                  
                  if (cartData.promotions && cartData.promotions.length > 0) {
                    console.log(`\n🎁 Маркетинговые акции:`);
                    cartData.promotions.forEach((promo, index) => {
                      console.log(`   ${index + 1}. ${promo.title || 'Не указано'}`);
                      console.log(`      Тип: ${promo.type || 'Не указан'}`);
                      if (promo.amount !== undefined) {
                        console.log(`      Сумма: ${promo.amount || 0} ₽`);
                      }
                      if (promo.count !== undefined) {
                        console.log(`      Количество: ${promo.count || 0}`);
                      }
                    });
                  }
                  
                  console.log(`\n${'='.repeat(80)}`);
                } catch (cartError) {
                  console.error(`\n❌ Ошибка при создании корзины: ${cartError.message}`);
                }
              }
              
              console.log(`\n💡 Для подтверждения записи создайте продажу одного из указанных вариантов.`);
            } else {
              console.log(`\n⚠️  Варианты для приобретения не найдены в категории "${roomTitle}".`);
            }
          } else {
            console.log(`\n⚠️  Не удалось определить название помещения для поиска вариантов покупки.`);
          }
          
          console.log(`\n${'='.repeat(80)}`);
          console.log(`\n✅ Скрипт выполнен. Клиент не записан (нет оснований).`);
        } else {
          console.log(`\n${'='.repeat(80)}`);
          console.log(`\n✅ Скрипт выполнен. Клиент записан после повторной попытки.`);
        }
        return; // Завершаем выполнение
      }
      
      // Если статус не temporarily_reserved_need_payment, значит клиент действительно записан
      console.log(`\n${'='.repeat(80)}`);
      console.log(`\n✅ Скрипт выполнен. Клиент уже записан на занятие.`);
      return; // Завершаем выполнение
    }
    
    // 7. Выводим информацию о занятии
    printClassInfo(nextClass);
    
    // 8. Пробуем записать клиента на занятие
    try {
      // Получаем список активных билетов клиента
      const tickets = await getTickets(passToken);
      
      // Выбираем подходящий билет
      let ticketId = null;
      if (tickets.length > 0) {
        // Ищем билет с услугами для групповых занятий (если есть информация о service_list)
        // Или просто используем первый активный билет
        const suitableTicket = tickets.find(ticket => {
          // Проверяем, есть ли в билете услуги для групповых занятий
          if (ticket.service_list && Array.isArray(ticket.service_list)) {
            return ticket.service_list.some(service => 
              service.count === null || service.count > 0
            );
          }
          // Если информации о service_list нет, используем билет с неограниченными услугами
          return ticket.count === null || ticket.count > 0;
        }) || tickets[0];
        
        ticketId = suitableTicket.ticket_id;
        console.log(`\n🎫 Используем билет: ${suitableTicket.title} (${suitableTicket.type})`);
        console.log(`   ID билета: ${ticketId}`);
        if (suitableTicket.count !== null) {
          console.log(`   Остаток услуг: ${suitableTicket.count}`);
        } else {
          console.log(`   Услуги: неограничено`);
        }
      } else {
        // НЕТ активных билетов - все равно пытаемся записаться (ticketId = null)
        console.log(`\n⚠️  Активных билетов не найдено, но попытаемся записаться...`);
        console.log(`   Система попытается найти неявное основание (например, неиспользованную тренировку)`);
      }
      
      // Всегда пытаемся записаться (с билетом или без)
      const bookingResult = await bookClass(
        passToken, 
        nextClass.appointment_id, 
        clientData.club.id,
        ticketId
      );
      
      // Выводим результат записи
      console.log('\n' + '='.repeat(80));
      console.log('📋 РЕЗУЛЬТАТ ПОПЫТКИ ЗАПИСИ НА ЗАНЯТИЕ');
      console.log('='.repeat(80));
      
      console.log(`\n📋 Статус записи: ${bookingResult.status || 'Не указан'}`);
      console.log(`   Временно зарезервировано: ${bookingResult.temporarily_reserved ? 'Да' : 'Нет'}`);
      console.log(`   Онлайн тренировка: ${bookingResult.online ? 'Да' : 'Нет'}`);
      
      if (bookingResult.url_online_training) {
        console.log(`\n🌐 Онлайн тренировка:`);
        console.log(`   Название: ${bookingResult.url_online_training.title || 'Не указано'}`);
        console.log(`   Ссылка: ${bookingResult.url_online_training.url || 'Не указано'}`);
      }
      
      if (bookingResult.appointment) {
        console.log(`\n📅 Информация о занятии:`);
        console.log(`   ID: ${bookingResult.appointment.id || 'Не указано'}`);
        console.log(`   Название: ${bookingResult.appointment.title || 'Не указано'}`);
        console.log(`   Тренер: ${bookingResult.appointment.employee_name || 'Не указано'}`);
        console.log(`   Дата и время: ${bookingResult.appointment.date_time || 'Не указано'}`);
      }
      
      if (bookingResult.customer) {
        console.log(`\n👤 Клиент:`);
        console.log(`   ID: ${bookingResult.customer.id || 'Не указано'}`);
        console.log(`   ФИО: ${bookingResult.customer.client_name || 'Не указано'}`);
      }
      
      console.log(`\n${'='.repeat(80)}\n`);
      
      // Проверяем статус - если temporarily_reserved_need_payment, отменяем и пробуем заново
      if (bookingResult.status === 'temporarily_reserved_need_payment') {
        console.log(`\n⚠️  Статус ${bookingResult.status} - это может быть от предыдущей попытки`);
        console.log(`   Отменяем запись и пробуем записаться заново...\n`);
        
        // Отменяем запись
        try {
          await cancelClassBooking(passToken, nextClass.appointment_id);
          console.log(`✅ Запись отменена`);
        } catch (cancelError) {
          console.log(`⚠️  Ошибка при отмене записи: ${cancelError.message}`);
        }
        
        // Получаем билеты для повторной попытки
        const ticketsForRetry = await getTickets(passToken);
        let ticketIdForRetry = null;
        
        if (ticketsForRetry.length > 0) {
          const suitableTicket = ticketsForRetry.find(ticket => {
            if (ticket.service_list && Array.isArray(ticket.service_list)) {
              return ticket.service_list.some(service => 
                service.count === null || service.count > 0
              );
            }
            return ticket.count === null || ticket.count > 0;
          }) || ticketsForRetry[0];
          
          ticketIdForRetry = suitableTicket.ticket_id;
          console.log(`🎫 Используем билет для повторной попытки: ${suitableTicket.title}`);
        } else {
          console.log(`⚠️  Активных билетов не найдено, пробуем без ticket_id`);
        }
        
        // Пробуем записаться заново
        console.log(`\n🔄 Повторная попытка записи...`);
        const retryBookingResult = await bookClass(
          passToken, 
          nextClass.appointment_id, 
          clientData.club.id,
          ticketIdForRetry
        );
        
        console.log(`\n📋 Статус после повторной попытки: ${retryBookingResult.status || 'Не указан'}`);
        
        // Если снова temporarily_reserved_need_payment, значит действительно нет оснований
        if (retryBookingResult.status === 'temporarily_reserved_need_payment') {
          console.log(`\n⚠️  КЛИЕНТ НЕ ЗАПИСАН: отсутствуют основания для записи`);
          console.log(`   Статус ${retryBookingResult.status} означает, что запись не подтверждена`);
          console.log(`   Необходимо приобрести один из вариантов ниже для подтверждения записи\n`);
          
          // Выводим варианты для покупки
          const roomTitle = nextClass.room?.title;
          if (roomTitle) {
            console.log(`🔍 Поиск вариантов для покупки в категории "${roomTitle}"...`);
            const purchaseOptions = await getPurchaseOptions(passToken, roomTitle);
            
            if (purchaseOptions.length > 0) {
              console.log(`\n✅ Найдено вариантов для приобретения: ${purchaseOptions.length}\n`);
              console.log(`📋 Варианты для приобретения (с учетом ЧК/Не ЧК):\n`);
              
              purchaseOptions.forEach((option, index) => {
                console.log(`   ${index + 1}. ${option.title || option.name || 'Без названия'}`);
                console.log(`      ID: ${option.id || option.purchase_id || 'Не указан'}`);
                if (option.price !== undefined && option.price !== null) {
                  console.log(`      Цена: ${option.price} ₽`);
                }
                console.log('');
              });
              
              // Создаем корзину с первым вариантом
              const firstOption = purchaseOptions[0];
              const purchaseId = firstOption.id || firstOption.purchase_id;
              const serviceId = nextClass.service?.id || null;
              
              if (purchaseId) {
                console.log(`\n🛒 Создание корзины с первым вариантом...`);
                console.log(`   Товар: ${firstOption.title || firstOption.name || 'Без названия'}`);
                console.log(`   ID: ${purchaseId}`);
                
                try {
                  const cartData = await getCartCost(passToken, purchaseId, clientData.club.id, serviceId);
                  
                  // Дополнительная проверка: убеждаемся, что корзина действительно создана
                  if (!cartData || !cartData.cart || cartData.cart.length === 0) {
                    throw new Error('Корзина не была создана: данные корзины отсутствуют или корзина пуста');
                  }
                  
                  console.log(`\n✅ Корзина успешно создана и проверена через API`);
                  console.log(`\n${'='.repeat(80)}`);
                  console.log('🛒 ИНФОРМАЦИЯ О КОРЗИНЕ');
                  console.log('='.repeat(80));
                  
                  if (cartData.cart && cartData.cart.length > 0) {
                    const cartItem = cartData.cart[0];
                    console.log(`\n📦 Товар в корзине:`);
                    console.log(`   Название: ${cartItem.purchase?.title || 'Не указано'}`);
                    console.log(`   ID: ${cartItem.purchase?.id || 'Не указан'}`);
                    console.log(`   Количество: ${cartItem.count || 1}`);
                    
                    if (cartItem.price_type) {
                      console.log(`\n💰 Тип цены:`);
                      console.log(`   Название: ${cartItem.price_type.title || 'Не указано'}`);
                      console.log(`   ID: ${cartItem.price_type.id || 'Не указан'}`);
                      console.log(`   Цена за единицу: ${cartItem.price || 0} ₽`);
                    }
                    
                    console.log(`\n💵 Стоимость:`);
                    console.log(`   Цена: ${cartItem.price || 0} ₽`);
                    console.log(`   Скидка: ${cartItem.discount_sum || 0} ₽`);
                    console.log(`   К оплате: ${cartItem.payment_amount || 0} ₽`);
                    
                    if (cartItem.tax_sum !== undefined && cartItem.tax_sum !== null) {
                      console.log(`   НДС: ${cartItem.tax_sum || 0} ₽`);
                    }
                  }
                  
                  console.log(`\n📊 Итого по корзине:`);
                  console.log(`   Общая стоимость: ${cartData.total_amount || 0} ₽`);
                  console.log(`   Общая скидка: ${cartData.total_discount || 0} ₽`);
                  
                  if (cartData.may_be_payment && cartData.may_be_payment.length > 0) {
                    console.log(`\n💳 Возможные способы оплаты:`);
                    cartData.may_be_payment.forEach((payment, index) => {
                      console.log(`   ${index + 1}. ${payment.title || 'Не указано'}`);
                      console.log(`      ID: ${payment.id || 'Не указан'}`);
                      console.log(`      Тип: ${payment.type || 'Не указан'}`);
                      console.log(`      Сумма: ${payment.payment_amount || 0} ₽`);
                      if (payment.balance !== undefined) {
                        console.log(`      Баланс: ${payment.balance || 0} ₽`);
                      }
                    });
                  }
                  
                  if (cartData.promotions && cartData.promotions.length > 0) {
                    console.log(`\n🎁 Маркетинговые акции:`);
                    cartData.promotions.forEach((promo, index) => {
                      console.log(`   ${index + 1}. ${promo.title || 'Не указано'}`);
                      console.log(`      Тип: ${promo.type || 'Не указан'}`);
                      if (promo.amount !== undefined) {
                        console.log(`      Сумма: ${promo.amount || 0} ₽`);
                      }
                      if (promo.count !== undefined) {
                        console.log(`      Количество: ${promo.count || 0}`);
                      }
                    });
                  }
                  
                  console.log(`\n${'='.repeat(80)}`);
                } catch (cartError) {
                  console.error(`\n❌ Ошибка при создании корзины: ${cartError.message}`);
                }
              }
              
              console.log(`\n💡 Для подтверждения записи создайте продажу одного из указанных вариантов.`);
            } else {
              console.log(`\n⚠️  Варианты для приобретения не найдены в категории "${roomTitle}".`);
            }
          } else {
            console.log(`\n⚠️  Не удалось определить название помещения для поиска вариантов покупки.`);
          }
          
          console.log(`\n✅ Скрипт выполнен. Клиент не записан (нет оснований).`);
          return; // Завершаем выполнение, не продолжаем проверку
        } else {
          // Обновляем bookingResult для дальнейшей обработки
          Object.assign(bookingResult, retryBookingResult);
          console.log(`\n✅ После повторной попытки запись успешна, продолжаем проверку...`);
        }
      }
      
      // 10. Проверяем фактическое состояние записи через API
      console.log('🔍 Проверка фактического состояния записи...');
      try {
        // Получаем информацию о занятии
        const classInfo = await getClassDescription(passToken, nextClass.appointment_id, clientData.club.id);
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 ФАКТИЧЕСКОЕ СОСТОЯНИЕ ЗАПИСИ');
        console.log('='.repeat(80));
        
        console.log(`\n📋 Статус записи клиента: ${classInfo.already_booked ? 'Записан' : 'Не записан'}`);
        console.log(`   Статус занятия: ${classInfo.status || 'Не указан'}`);
        console.log(`   Требуется оплата: ${classInfo.payment_required ? 'Да' : 'Нет'}`);
        console.log(`   Отменено: ${classInfo.canceled ? 'Да' : 'Нет'}`);
        
        if (classInfo.client_in_the_waiting_list) {
          console.log(`   ⚠️  Клиент в листе ожидания: Да`);
        }
        
        if (classInfo.waiting_list_client_status) {
          console.log(`   Действие в листе ожидания: ${classInfo.waiting_list_client_status}`);
        }
        
        if (classInfo.waiting_list_message) {
          console.log(`   Сообщение: ${classInfo.waiting_list_message}`);
        }
        
        console.log(`\n👥 Свободные места: ${classInfo.available_slots || 'Не указано'}`);
        console.log(`   Емкость: ${classInfo.capacity || 'Не указано'}`);
        
        console.log(`\n${'='.repeat(80)}\n`);
        
        // Проверяем список занятий клиента
        const clientAppointments = await getClientAppointments(passToken);
        const foundAppointment = clientAppointments.find(apt => 
          apt.appointment_id === nextClass.appointment_id
        );
        
        if (foundAppointment) {
          console.log('✅ Занятие найдено в списке занятий клиента:');
          console.log(`   Статус: ${foundAppointment.status || 'Не указан'}`);
          console.log(`   Статус прибытия: ${foundAppointment.arrival_status || 'Не указан'}`);
          console.log(`   В листе ожидания: ${foundAppointment.waiting_list ? 'Да' : 'Нет'}`);
          
          if (foundAppointment.payment) {
            console.log(`\n💳 Основание оплаты:`);
            console.log(`   Название: ${foundAppointment.payment.title || 'Не указано'}`);
            console.log(`   Тип: ${foundAppointment.payment.type || 'Не указан'}`);
            console.log(`   ID билета: ${foundAppointment.payment.ticket_id || 'Не указан'}`);
          }
        } else {
          console.log('⚠️  Занятие НЕ найдено в списке занятий клиента');
          console.log('\n📌 Возможные причины:');
          console.log('   1. Запись временная (temporarily_reserved_need_payment)');
          console.log('   2. Требуется оплата для подтверждения записи');
          console.log('   3. Клиент не будет виден в 1С до момента оплаты');
          console.log('   4. Нужно создать продажу (долг или с оплатой) для подтверждения записи');
        }
        
        // Анализ статуса записи - проверяем статус из classInfo
        const finalStatus = classInfo.status || bookingResult.status;
        if (finalStatus === 'temporarily_reserved_need_payment') {
          console.log('\n' + '='.repeat(80));
          console.log('⚠️  ВАЖНО: ЗАПИСЬ ВРЕМЕННАЯ И ТРЕБУЕТ ОПЛАТЫ!');
          console.log('='.repeat(80));
          console.log('\n📌 Что это значит:');
          console.log('   - Клиент зарезервирован на занятие');
          console.log('   - Но запись НЕ подтверждена до момента оплаты');
          console.log('   - В 1С клиент может НЕ отображаться в составе группы');
          console.log('   - Клиент может НЕ отображаться в листе ожидания');
          console.log('   - Запись будет подтверждена только после оплаты');
          console.log('\n💡 Что делать:');
          console.log('   1. Проверьте, есть ли у клиента активное членство/пакет услуг');
          console.log('   2. Если нет - нужно создать продажу (долг или с оплатой)');
          
          // Выводим варианты для покупки
          const roomTitle = nextClass.room?.title;
          if (roomTitle) {
            console.log(`\n🔍 Поиск вариантов для покупки в категории "${roomTitle}"...`);
            const purchaseOptions = await getPurchaseOptions(passToken, roomTitle);
            
            if (purchaseOptions.length > 0) {
              console.log(`\n✅ Найдено вариантов для приобретения: ${purchaseOptions.length}\n`);
              console.log(`📋 Варианты для приобретения (с учетом ЧК/Не ЧК):\n`);
              
              purchaseOptions.forEach((option, index) => {
                console.log(`   ${index + 1}. ${option.title || option.name || 'Без названия'}`);
                console.log(`      ID: ${option.id || option.purchase_id || 'Не указан'}`);
                if (option.price !== undefined && option.price !== null) {
                  console.log(`      Цена: ${option.price} ₽`);
                }
                console.log('');
              });
              
              // Создаем корзину с первым вариантом
              const firstOption = purchaseOptions[0];
              const purchaseId = firstOption.id || firstOption.purchase_id;
              const serviceId = nextClass.service?.id || null;
              
              if (purchaseId) {
                console.log(`\n🛒 Создание корзины с первым вариантом...`);
                console.log(`   Товар: ${firstOption.title || firstOption.name || 'Без названия'}`);
                console.log(`   ID: ${purchaseId}`);
                
                try {
                  const cartData = await getCartCost(passToken, purchaseId, clientData.club.id, serviceId);
                  
                  // Дополнительная проверка: убеждаемся, что корзина действительно создана
                  if (!cartData || !cartData.cart || cartData.cart.length === 0) {
                    throw new Error('Корзина не была создана: данные корзины отсутствуют или корзина пуста');
                  }
                  
                  console.log(`\n✅ Корзина успешно создана и проверена через API`);
                  console.log(`\n${'='.repeat(80)}`);
                  console.log('🛒 ИНФОРМАЦИЯ О КОРЗИНЕ');
                  console.log('='.repeat(80));
                  
                  if (cartData.cart && cartData.cart.length > 0) {
                    const cartItem = cartData.cart[0];
                    console.log(`\n📦 Товар в корзине:`);
                    console.log(`   Название: ${cartItem.purchase?.title || 'Не указано'}`);
                    console.log(`   ID: ${cartItem.purchase?.id || 'Не указан'}`);
                    console.log(`   Количество: ${cartItem.count || 1}`);
                    
                    if (cartItem.price_type) {
                      console.log(`\n💰 Тип цены:`);
                      console.log(`   Название: ${cartItem.price_type.title || 'Не указано'}`);
                      console.log(`   ID: ${cartItem.price_type.id || 'Не указан'}`);
                      console.log(`   Цена за единицу: ${cartItem.price || 0} ₽`);
                    }
                    
                    console.log(`\n💵 Стоимость:`);
                    console.log(`   Цена: ${cartItem.price || 0} ₽`);
                    console.log(`   Скидка: ${cartItem.discount_sum || 0} ₽`);
                    console.log(`   К оплате: ${cartItem.payment_amount || 0} ₽`);
                    
                    if (cartItem.tax_sum !== undefined && cartItem.tax_sum !== null) {
                      console.log(`   НДС: ${cartItem.tax_sum || 0} ₽`);
                    }
                  }
                  
                  console.log(`\n📊 Итого по корзине:`);
                  console.log(`   Общая стоимость: ${cartData.total_amount || 0} ₽`);
                  console.log(`   Общая скидка: ${cartData.total_discount || 0} ₽`);
                  
                  if (cartData.may_be_payment && cartData.may_be_payment.length > 0) {
                    console.log(`\n💳 Возможные способы оплаты:`);
                    cartData.may_be_payment.forEach((payment, index) => {
                      console.log(`   ${index + 1}. ${payment.title || 'Не указано'}`);
                      console.log(`      ID: ${payment.id || 'Не указан'}`);
                      console.log(`      Тип: ${payment.type || 'Не указан'}`);
                      console.log(`      Сумма: ${payment.payment_amount || 0} ₽`);
                      if (payment.balance !== undefined) {
                        console.log(`      Баланс: ${payment.balance || 0} ₽`);
                      }
                    });
                  }
                  
                  if (cartData.promotions && cartData.promotions.length > 0) {
                    console.log(`\n🎁 Маркетинговые акции:`);
                    cartData.promotions.forEach((promo, index) => {
                      console.log(`   ${index + 1}. ${promo.title || 'Не указано'}`);
                      console.log(`      Тип: ${promo.type || 'Не указан'}`);
                      if (promo.amount !== undefined) {
                        console.log(`      Сумма: ${promo.amount || 0} ₽`);
                      }
                      if (promo.count !== undefined) {
                        console.log(`      Количество: ${promo.count || 0}`);
                      }
                    });
                  }
                  
                  console.log(`\n${'='.repeat(80)}`);
                } catch (cartError) {
                  console.error(`\n❌ Ошибка при создании корзины: ${cartError.message}`);
                }
              }
              
              console.log(`\n💡 Для подтверждения записи создайте продажу одного из указанных вариантов.`);
            } else {
              console.log(`\n⚠️  Варианты для приобретения не найдены в категории "${roomTitle}".`);
            }
          } else {
            console.log(`\n⚠️  Не удалось определить название помещения для поиска вариантов покупки.`);
          }
        }
        
      } catch (error) {
        console.error(`\n❌ Ошибка при проверке состояния записи: ${error.message}`);
      }
      
      // Анализ статуса записи из bookingResult (если classInfo не был получен)
      if (bookingResult.status === 'temporarily_reserved_need_payment') {
        console.log('\n' + '='.repeat(80));
        console.log('⚠️  ВАЖНО: ЗАПИСЬ ВРЕМЕННАЯ И ТРЕБУЕТ ОПЛАТЫ!');
        console.log('='.repeat(80));
        console.log('\n📌 Что это значит:');
        console.log('   - Клиент зарезервирован на занятие');
        console.log('   - Но запись НЕ подтверждена до момента оплаты');
        console.log('   - В 1С клиент может НЕ отображаться в составе группы');
        console.log('   - Клиент может НЕ отображаться в листе ожидания');
        console.log('   - Запись будет подтверждена только после оплаты');
        console.log('\n💡 Что делать:');
        console.log('   1. Проверьте, есть ли у клиента активное членство/пакет услуг');
        console.log('   2. Если нет - нужно создать продажу (долг или с оплатой)');
        
        // Выводим варианты для покупки
        const roomTitle = nextClass.room?.title;
        if (roomTitle) {
          console.log(`\n🔍 Поиск вариантов для покупки в категории "${roomTitle}"...`);
          const purchaseOptions = await getPurchaseOptions(passToken, roomTitle);
          
          if (purchaseOptions.length > 0) {
            console.log(`\n✅ Найдено вариантов для приобретения: ${purchaseOptions.length}\n`);
            console.log(`📋 Варианты для приобретения (с учетом ЧК/Не ЧК):\n`);
            
            purchaseOptions.forEach((option, index) => {
              console.log(`   ${index + 1}. ${option.title || option.name || 'Без названия'}`);
              console.log(`      ID: ${option.id || option.purchase_id || 'Не указан'}`);
              if (option.price !== undefined && option.price !== null) {
                console.log(`      Цена: ${option.price} ₽`);
              }
              console.log('');
            });
            
            // Создаем корзину с первым вариантом
            const firstOption = purchaseOptions[0];
            const purchaseId = firstOption.id || firstOption.purchase_id;
            const serviceId = nextClass.service?.id || null;
            
            if (purchaseId) {
              console.log(`\n🛒 Создание корзины с первым вариантом...`);
              console.log(`   Товар: ${firstOption.title || firstOption.name || 'Без названия'}`);
              console.log(`   ID: ${purchaseId}`);
              
              try {
                const cartData = await getCartCost(passToken, purchaseId, clientData.club.id, serviceId);
                
                console.log(`\n${'='.repeat(80)}`);
                console.log('🛒 ИНФОРМАЦИЯ О КОРЗИНЕ');
                console.log('='.repeat(80));
                
                if (cartData.cart && cartData.cart.length > 0) {
                  const cartItem = cartData.cart[0];
                  console.log(`\n📦 Товар в корзине:`);
                  console.log(`   Название: ${cartItem.purchase?.title || 'Не указано'}`);
                  console.log(`   ID: ${cartItem.purchase?.id || 'Не указан'}`);
                  console.log(`   Количество: ${cartItem.count || 1}`);
                  
                  if (cartItem.price_type) {
                    console.log(`\n💰 Тип цены:`);
                    console.log(`   Название: ${cartItem.price_type.title || 'Не указано'}`);
                    console.log(`   ID: ${cartItem.price_type.id || 'Не указан'}`);
                    console.log(`   Цена за единицу: ${cartItem.price || 0} ₽`);
                  }
                  
                  console.log(`\n💵 Стоимость:`);
                  console.log(`   Цена: ${cartItem.price || 0} ₽`);
                  console.log(`   Скидка: ${cartItem.discount_sum || 0} ₽`);
                  console.log(`   К оплате: ${cartItem.payment_amount || 0} ₽`);
                  
                  if (cartItem.tax_sum !== undefined && cartItem.tax_sum !== null) {
                    console.log(`   НДС: ${cartItem.tax_sum || 0} ₽`);
                  }
                }
                
                console.log(`\n📊 Итого по корзине:`);
                console.log(`   Общая стоимость: ${cartData.total_amount || 0} ₽`);
                console.log(`   Общая скидка: ${cartData.total_discount || 0} ₽`);
                
                if (cartData.may_be_payment && cartData.may_be_payment.length > 0) {
                  console.log(`\n💳 Возможные способы оплаты:`);
                  cartData.may_be_payment.forEach((payment, index) => {
                    console.log(`   ${index + 1}. ${payment.title || 'Не указано'}`);
                    console.log(`      ID: ${payment.id || 'Не указан'}`);
                    console.log(`      Тип: ${payment.type || 'Не указан'}`);
                    console.log(`      Сумма: ${payment.payment_amount || 0} ₽`);
                    if (payment.balance !== undefined) {
                      console.log(`      Баланс: ${payment.balance || 0} ₽`);
                    }
                  });
                }
                
                if (cartData.promotions && cartData.promotions.length > 0) {
                  console.log(`\n🎁 Маркетинговые акции:`);
                  cartData.promotions.forEach((promo, index) => {
                    console.log(`   ${index + 1}. ${promo.title || 'Не указано'}`);
                    console.log(`      Тип: ${promo.type || 'Не указан'}`);
                    if (promo.amount !== undefined) {
                      console.log(`      Сумма: ${promo.amount || 0} ₽`);
                    }
                    if (promo.count !== undefined) {
                      console.log(`      Количество: ${promo.count || 0}`);
                    }
                  });
                }
                
                console.log(`\n${'='.repeat(80)}`);
              } catch (cartError) {
                console.error(`\n❌ Ошибка при создании корзины: ${cartError.message}`);
              }
            }
            
            console.log(`\n💡 Для подтверждения записи создайте продажу одного из указанных вариантов.`);
          } else {
            console.log(`\n⚠️  Варианты для приобретения не найдены в категории "${roomTitle}".`);
          }
        } else {
          console.log(`\n⚠️  Не удалось определить название помещения для поиска вариантов покупки.`);
        }
        console.log('   3. После оплаты запись автоматически подтвердится');
        console.log('   4. Или используйте ticket_id активного билета при записи');
        console.log(`\n${'='.repeat(80)}\n`);
      } else if (bookingResult.status === 'reserved') {
        console.log('\n✅ Запись подтверждена (reserved)');
        console.log('   Клиент должен быть виден в 1С в составе группы');
      } else if (bookingResult.status === 'reserved_and_payed') {
        console.log('\n✅ Запись подтверждена и оплачена (reserved_and_payed)');
        console.log('   Клиент должен быть виден в 1С в составе группы');
      }
      
      console.log('\n✅ Скрипт выполнен успешно!');
    } catch (error) {
      console.error(`\n❌ Ошибка при записи на занятие:`);
      console.error(`   ${error.message}`);
      console.log(`\n⚠️  Занятие найдено, но запись не удалась.`);
      console.log('✅ Скрипт выполнен (занятие найдено, но запись не удалась).');
    }
  } catch (error) {
    console.error('\n❌ Ошибка выполнения скрипта:');
    console.error(error.message);
    if (error.stack) {
      console.error('\nСтек ошибки:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Запускаем скрипт
main();

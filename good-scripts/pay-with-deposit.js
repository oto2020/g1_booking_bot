// Скрипт для оплаты с лицевого счета "Основной"
//
// Что делает:
// 1. Получает pass_token для клиента
// 2. Находит ближайшее занятие "САЙКЛ PRO"
// 3. Создает корзину с первым вариантом покупки
// 4. Находит лицевой счет "Основной"
// 5. Оплачивает с лицевого счета (полностью или частично)
// 6. Выводит подробную информацию о результате
//
// Как запускать:
//   cd /root/grelka_yookassa_bot
//   node scripts/good-scripts/pay-with-deposit.js

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
const DEPOSIT_NAME = 'Основной'; // Название лицевого счета для оплаты

// Проверяем наличие переменных окружения
const API_HOSTNAME = process.env.API_HOSTNAME;
const API_PORT = process.env.API_PORT;
const API_PATH = process.env.API_PATH;
const API_KEY = process.env.API_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const AUTHORIZATION = process.env.AUTHORIZATION;

if (!API_HOSTNAME || !API_PORT || !API_PATH || !API_KEY || !SECRET_KEY || !AUTHORIZATION) {
  console.error('❌ Не все переменные окружения установлены');
  process.exit(1);
}

/**
 * Получение pass_token для клиента
 */
async function getPassToken(phone) {
  const normalizedPhone = phone.replace(/\D/g, '');
  const sign = crypto.createHash('sha256')
    .update(`phone:${normalizedPhone};key:${SECRET_KEY}`)
    .digest('hex');

  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/pass_token/?phone=${normalizedPhone}&sign=${sign}`;

  const response = await axios.get(url, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': API_KEY,
      'Authorization': AUTHORIZATION
    },
    httpsAgent
  });

  if (!response.data.result || !response.data.data?.pass_token) {
    throw new Error('Не удалось получить pass_token');
  }

  return response.data.data.pass_token;
}

/**
 * Получение данных клиента
 */
async function getClient(passToken) {
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/client`;
  
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
    throw new Error('Не удалось получить данные клиента');
  }

  return response.data.data;
}

/**
 * Получение расписания занятий
 */
async function getClasses(passToken, clubId, startDate, endDate) {
  const params = new URLSearchParams({
    club_id: clubId,
    start_date: startDate,
    end_date: endDate
  });

  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/classes/?${params.toString()}`;

  const response = await axios.get(url, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': API_KEY,
      'Authorization': AUTHORIZATION,
      'usertoken': passToken
    },
    httpsAgent
  });

  if (Array.isArray(response.data)) {
    return response.data;
  } else if (response.data.data && Array.isArray(response.data.data)) {
    return response.data.data;
  }
  return [];
}

/**
 * Поиск ближайшего занятия
 */
function findNextClass(classes, searchText) {
  const now = new Date();
  const filtered = classes.filter(cls => {
    if (!cls.service || !cls.service.title) return false;
    return cls.service.title.includes(searchText);
  });

  const futureClasses = filtered.filter(cls => {
    if (!cls.start_date) return false;
    const classDate = new Date(cls.start_date);
    return classDate > now && !cls.canceled;
  });

  if (futureClasses.length === 0) return null;

  futureClasses.sort((a, b) => {
    return new Date(a.start_date) - new Date(b.start_date);
  });

  return futureClasses[0];
}

/**
 * Проверка активного членства
 */
async function checkActiveMembership(passToken) {
  try {
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
    }
    
    const activeDeposits = deposits.filter(deposit => {
      if (deposit.exists === true) {
        const balance = parseFloat(deposit.balance || 0);
        return balance > 0 || (deposit.type && deposit.type.name && 
          (deposit.type.name.toLowerCase().includes('членство') || 
           deposit.type.name.toLowerCase().includes('абонемент')));
      }
      return false;
    });
    
    return activeDeposits.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Получение прайс-листа
 */
async function getPricelist(passToken) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  const possibleEndpoints = ['pricelist', 'price_list', 'prices', 'price-list'];
  
  for (const endpoint of possibleEndpoints) {
    const url = `${baseUrl}/${endpoint}`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': API_KEY,
          'Authorization': AUTHORIZATION,
          'usertoken': passToken
        },
        httpsAgent,
        timeout: 10000
      });

      let items = [];
      if (Array.isArray(response.data)) {
        items = response.data;
      } else if (response.data && Array.isArray(response.data.data)) {
        items = response.data.data;
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
 * Получение вариантов для покупки
 */
async function getPurchaseOptions(passToken, roomTitle) {
  const hasActiveMembership = await checkActiveMembership(passToken);
  const pricelist = await getPricelist(passToken);
  
  let filteredItems = pricelist.filter(item => {
    if (!item.category) return false;
    if (typeof item.category === 'object' && item.category.title) {
      return item.category.title === roomTitle;
    }
    return false;
  });
  
  const titleFilteredItems = filteredItems.filter(item => {
    const title = item.title || item.name || item.title_ru || '';
    const hasNotCK = title.includes('Не ЧК');
    
    if (hasActiveMembership) {
      return !hasNotCK;
    } else {
      return hasNotCK;
    }
  });
  
  return titleFilteredItems;
}

/**
 * Получение стоимости корзины
 */
async function getCartCost(passToken, purchaseId, clubId, serviceId = null) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  
  const cartArray = [{
    purchase_id: purchaseId,
    count: 1
  }];
  
  if (serviceId) {
    cartArray[0].service_id = serviceId;
  }
  
  const cartJson = JSON.stringify({ cart_array: cartArray });
  
  const params = new URLSearchParams({
    cart: cartJson,
    club_id: clubId
  });
  
  const url = `${baseUrl}/cart_cost/?${params.toString()}`;
  
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
    throw new Error(response.data.error_message || `Ошибка создания корзины: ${response.data.error || 'Неизвестная ошибка'}`);
  }
  
  if (!response.data.data) {
    throw new Error('Корзина не была создана: данные не получены');
  }
  
  const cartData = response.data.data;
  
  if (!cartData.cart || !Array.isArray(cartData.cart) || cartData.cart.length === 0) {
    throw new Error('Корзина не была создана: корзина пуста или не содержит товаров');
  }
  
  const foundItem = cartData.cart.find(item => 
    item.purchase && (item.purchase.id === purchaseId || item.purchase_id === purchaseId)
  );
  
  if (!foundItem) {
    throw new Error(`Корзина не была создана: товар с ID ${purchaseId} не найден в корзине`);
  }
  
  return cartData;
}

/**
 * Получение списка лицевых счетов клиента
 */
async function getDeposits(passToken) {
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/deposits`;
  
  const response = await axios.get(url, {
    headers: {
      'Content-Type': 'application/json',
      'apikey': API_KEY,
      'Authorization': AUTHORIZATION,
      'usertoken': passToken
    },
    httpsAgent
  });
  
  let deposits = [];
  if (Array.isArray(response.data)) {
    deposits = response.data;
  } else if (response.data && Array.isArray(response.data.data)) {
    deposits = response.data.data;
  } else if (response.data && Array.isArray(response.data.deposits)) {
    deposits = response.data.deposits;
  }
  
  return deposits;
}

/**
 * Поиск лицевого счета "Основной"
 */
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

/**
 * Создание продажи с оплатой с лицевого счета или с созданием долга
 * @param {string|null} depositId - ID лицевого счета (null если счет не найден/неактивен/без средств)
 * @param {number} depositAmount - Сумма для оплаты с лицевого счета (0 если создаем долг)
 * @param {boolean} createDebt - если true, создает долг через card amount: 0.0001
 */
async function createSaleWithDepositPayment(passToken, cartData, clubId, depositId, depositAmount, serviceId = null, createDebt = false) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  
  // Формируем cart из данных корзины
  // По документации API: count должен быть number, purchase_id должен быть string
  const cart = cartData.cart.map(item => {
    const cartItem = {
      purchase_id: item.purchase?.id || item.purchase_id,
      count: parseInt(item.count || 1, 10) // Убеждаемся, что count - это число
    };
    
    if (item.price_type?.id) {
      cartItem.price_type_id = item.price_type.id;
    }
    
    if (serviceId) {
      cartItem.service_id = serviceId;
    }
    
    return cartItem;
  });
  
  // Убеждаемся, что totalAmount - это число
  const totalAmount = parseFloat(cartData.total_amount || 0);
  
  // Генерируем уникальный transaction_id
  const transaction_id = `sale_deposit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  
  // URL для запроса
  const paymentUrl = `${baseUrl}/payment`;
  
  // Формируем payment_list с оплатой с лицевого счета
  // По документации API для типа "deposit" нужно использовать поле "id", а не "deposit_id"
  // amount должен быть числом (number), а не строкой
  const payment_list = [];
  
  // Если на лицевом счете есть средства и счет найден, оплачиваем с него
  if (depositAmount > 0 && depositId) {
    payment_list.push({
      type: "deposit",
      id: depositId,
      amount: parseFloat(depositAmount.toFixed(2)) // Убеждаемся, что это число с 2 знаками после запятой
    });
  }
  
  // Эмулируем оплату с карты только если на всех лицевых счетах 0 рублей
  // Это создаст долг без реальной оплаты
  if (createDebt) {
    payment_list.push({
      type: "card",
      amount: 0.0001 // Эмуляция оплаты для создания долга
      // БЕЗ id (card_id) - это создаст долг без реальной оплаты
    });
  }
  
  let requestBody = {
    transaction_id: transaction_id,
    cart: cart,
    payment_list: payment_list,
    club_id: clubId
  };
  
  if (cartData.org_id) {
    requestBody.org_id = cartData.org_id;
  }
  
  console.log(`\n📤 ЗАПРОС К API:`);
  console.log(`   URL: ${paymentUrl}`);
  console.log(`   Method: POST`);
  console.log(`\n📋 Тело запроса:`);
  console.log(JSON.stringify(requestBody, null, 2));
  
  try {
    const response = await axios.post(paymentUrl, requestBody, {
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
    
    if (response.data.result) {
      console.log(`\n✅ УСПЕХ! Продажа успешно создана!`);
      return {
        success: true,
        transaction_id: transaction_id,
        data: response.data.data,
        fullResponse: response.data
      };
    } else {
      throw new Error(response.data.error_message || `Ошибка ${response.data.error}`);
    }
  } catch (error) {
    if (error.response) {
      const errorMessage = error.response.data?.error_message || `Ошибка ${error.response.data?.error || error.response.status}`;
      console.log(`\n📥 ОТВЕТ ОТ API (ошибка):`);
      console.log(`   Status: ${error.response.status} ${error.response.statusText}`);
      console.log(`   Data:`, JSON.stringify(error.response.data, null, 2));
      throw new Error(`Ошибка создания продажи: ${errorMessage}`);
    } else {
      throw new Error(`Ошибка создания продажи: ${error.message}`);
    }
  }
}

/**
 * Основная функция
 */
async function main() {
  console.log('🚀 СКРИПТ: ОПЛАТА С ЛИЦЕВОГО СЧЕТА "ОСНОВНОЙ"');
  console.log('='.repeat(80));
  console.log(`\n📞 Клиент: ${PHONE}`);
  console.log(`🔍 Поиск занятия: "${SEARCH_TEXT}"`);
  console.log(`💰 Лицевой счет: "${DEPOSIT_NAME}"`);
  
  try {
    // 1. Получаем pass_token
    const passToken = await getPassToken(PHONE);
    console.log(`\n✅ pass_token получен`);
    
    // 2. Получаем данные клиента
    const clientData = await getClient(passToken);
    console.log(`\n✅ Данные клиента получены`);
    console.log(`   Имя: ${clientData.name || 'Не указано'}`);
    console.log(`   Club ID: ${clientData.club?.id || 'Не указан'}`);
    
    // 3. Получаем расписание
    const now = new Date();
    const startDate = now.toISOString().slice(0, 19).replace('T', ' ');
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    console.log(`\n📅 Получение расписания...`);
    console.log(`   Период: с ${startDate} по ${endDate}`);
    const classes = await getClasses(passToken, clientData.club.id, startDate, endDate);
    console.log(`   ✅ Получено занятий: ${classes.length}`);
    
    // 4. Находим ближайшее занятие
    const nextClass = findNextClass(classes, SEARCH_TEXT);
    if (!nextClass) {
      throw new Error(`Занятие "${SEARCH_TEXT}" не найдено в расписании`);
    }
    
    console.log(`\n✅ Найдено ближайшее занятие:`);
    console.log(`   ID: ${nextClass.appointment_id}`);
    console.log(`   Название: ${nextClass.service?.title || 'Не указано'}`);
    console.log(`   Дата: ${nextClass.start_date}`);
    console.log(`   Помещение: ${nextClass.room?.title || 'Не указано'}`);
    
    // 5. Получаем варианты для покупки
    const roomTitle = nextClass.room?.title;
    if (!roomTitle) {
      throw new Error('Не удалось определить название помещения');
    }
    
    console.log(`\n💰 Поиск вариантов для покупки в категории "${roomTitle}"...`);
    const purchaseOptions = await getPurchaseOptions(passToken, roomTitle);
    
    if (purchaseOptions.length === 0) {
      throw new Error(`Варианты для покупки не найдены в категории "${roomTitle}"`);
    }
    
    console.log(`\n✅ Найдено вариантов: ${purchaseOptions.length}`);
    const firstOption = purchaseOptions[0];
    const purchaseId = firstOption.id || firstOption.purchase_id;
    const serviceId = nextClass.service?.id || null;
    
    console.log(`\n📦 Используем первый вариант:`);
    console.log(`   Название: ${firstOption.title || firstOption.name || 'Без названия'}`);
    console.log(`   ID: ${purchaseId}`);
    if (serviceId) {
      console.log(`   Service ID (для занятия): ${serviceId}`);
    }
    
    // 6. Создаем корзину
    console.log(`\n${'='.repeat(80)}`);
    console.log('🛒 ЭТАП 1: СОЗДАНИЕ КОРЗИНЫ');
    console.log('='.repeat(80));
    
    const cartData = await getCartCost(passToken, purchaseId, clientData.club.id, serviceId);
    
    console.log(`\n✅ Корзина успешно создана и проверена через API`);
    console.log(`\n📋 Информация о корзине:`);
    if (cartData.cart && cartData.cart.length > 0) {
      const cartItem = cartData.cart[0];
      console.log(`   Товар: ${cartItem.purchase?.title || 'Не указано'}`);
      console.log(`   Количество: ${cartItem.count || 1}`);
      console.log(`   Цена: ${cartItem.price || 0} ₽`);
      console.log(`   Скидка: ${cartItem.discount_sum || 0} ₽`);
      console.log(`   К оплате: ${cartItem.payment_amount || 0} ₽`);
    }
    const totalAmount = cartData.total_amount || 0;
    console.log(`   Общая стоимость: ${totalAmount} ₽`);
    
    // 7. Получаем лицевые счета и находим "Основной"
    console.log(`\n${'='.repeat(80)}`);
    console.log('💳 ЭТАП 2: ПОИСК ЛИЦЕВОГО СЧЕТА "ОСНОВНОЙ"');
    console.log('='.repeat(80));
    
    const deposits = await getDeposits(passToken);
    console.log(`\n✅ Получено лицевых счетов: ${deposits.length}`);
    
    if (deposits.length === 0) {
      throw new Error('У клиента нет лицевых счетов');
    }
    
    // Выводим информацию о всех счетах
    deposits.forEach((deposit, index) => {
      const balance = parseFloat(deposit.balance || 0);
      const name = deposit.name || deposit.title || deposit.deposit_name || 'Без названия';
      const exists = deposit.exists === true;
      console.log(`   ${index + 1}. ${name} - Баланс: ${balance.toFixed(2)} ₽, Активен: ${exists ? 'Да' : 'Нет'}`);
    });
    
    const mainDeposit = findMainDeposit(deposits, DEPOSIT_NAME);
    
    let depositId = null;
    let depositBalance = 0;
    let depositAmount = 0;
    let isFullPayment = false;
    let remainingAmount = totalAmount;
    let createDebt = false;
    
    // Проверяем условия для создания долга через card amount: 0.0001
    if (!mainDeposit) {
      // Лицевой счет не найден
      console.log(`\n⚠️ Лицевой счет "${DEPOSIT_NAME}" не найден`);
      console.log(`   Будет создан долг через эмуляцию оплаты картой (amount: 0.0001)`);
      createDebt = true;
    } else {
      depositBalance = parseFloat(mainDeposit.balance || 0);
      depositId = mainDeposit.id || mainDeposit.deposit_id || mainDeposit.uuid;
      const isActive = mainDeposit.exists === true;
      
      if (!isActive) {
        // Лицевой счет неактивен
        console.log(`\n⚠️ Лицевой счет "${DEPOSIT_NAME}" найден, но неактивен`);
        console.log(`   ID: ${depositId}`);
        console.log(`   Будет создан долг через эмуляцию оплаты картой (amount: 0.0001)`);
        createDebt = true;
        depositId = null; // Не используем неактивный счет
      } else if (depositBalance === 0) {
        // На лицевом счете нет денег
        console.log(`\n⚠️ Лицевой счет "${DEPOSIT_NAME}" найден, но баланс = 0 ₽`);
        console.log(`   ID: ${depositId}`);
        console.log(`   Будет создан долг через эмуляцию оплаты картой (amount: 0.0001)`);
        createDebt = true;
        depositId = null; // Не используем счет с нулевым балансом
      } else {
        // Лицевой счет найден, активен и есть средства
        console.log(`\n✅ Найден лицевой счет "${DEPOSIT_NAME}":`);
        console.log(`   ID: ${depositId}`);
        console.log(`   Баланс: ${depositBalance.toFixed(2)} ₽`);
        console.log(`   Требуется: ${totalAmount.toFixed(2)} ₽`);
        
        // Определяем сумму оплаты с лицевого счета
        depositAmount = Math.min(depositBalance, totalAmount);
        isFullPayment = depositBalance >= totalAmount;
        remainingAmount = totalAmount - depositAmount;
        
        if (isFullPayment) {
          console.log(`\n✅ Средств достаточно для полной оплаты`);
          console.log(`   Остаток на счету после оплаты: ${(depositBalance - totalAmount).toFixed(2)} ₽`);
        } else {
          console.log(`\n⚠️ Средств недостаточно для полной оплаты`);
          console.log(`   Оплачивается с лицевого счета: ${depositAmount.toFixed(2)} ₽`);
          console.log(`   Осталось доплатить: ${remainingAmount.toFixed(2)} ₽ (без создания долга)`);
        }
      }
    }
    
    // 9. Создаем продажу с оплатой с лицевого счета
    console.log(`\n${'='.repeat(80)}`);
    console.log('💳 ЭТАП 3: СОЗДАНИЕ ПРОДАЖИ С ОПЛАТОЙ С ЛИЦЕВОГО СЧЕТА');
    console.log('='.repeat(80));
    
    const saleResult = await createSaleWithDepositPayment(
      passToken, 
      cartData, 
      clientData.club.id,
      depositId,
      depositAmount,
      serviceId,
      createDebt
    );
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ РЕЗУЛЬТАТ: ПРОДАЖА УСПЕШНО СОЗДАНА');
    console.log('='.repeat(80));
    console.log(`\n📋 Информация о продаже:`);
    console.log(`   Transaction ID: ${saleResult.transaction_id}`);
    console.log(`   Статус: Успешно создана`);
    
    // Выводим итоговое сообщение
    console.log(`\n${'='.repeat(80)}`);
    if (createDebt) {
      console.log(`⚠️ Создан долг через эмуляцию оплаты картой (type: card, amount: 0.0001)`);
      if (!mainDeposit) {
        console.log(`   Причина: Лицевой счет "${DEPOSIT_NAME}" не найден`);
      } else if (mainDeposit.exists !== true) {
        console.log(`   Причина: Лицевой счет "${DEPOSIT_NAME}" неактивен`);
      } else {
        console.log(`   Причина: На лицевом счете "${DEPOSIT_NAME}" нет средств (баланс: 0 ₽)`);
      }
    } else if (isFullPayment) {
      console.log(`✅ Оплачено полностью с использованием лицевого счета "${DEPOSIT_NAME}", остаток на счету: ${(depositBalance - totalAmount).toFixed(2)} ₽`);
    } else {
      console.log(`⚠️ Оплачено частично с использованием лицевого счета "${DEPOSIT_NAME}" на сумму ${depositAmount.toFixed(2)} ₽, осталось доплатить: ${remainingAmount.toFixed(2)} ₽`);
    }
    console.log('='.repeat(80));
    
    console.log(`\n💡 Продажа создана. После оплаты запись на занятие будет подтверждена.`);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n✅ Скрипт выполнен успешно!`);
    
  } catch (error) {
    console.error(`\n${'='.repeat(80)}`);
    console.error('❌ ОШИБКА ВЫПОЛНЕНИЯ СКРИПТА');
    console.error('='.repeat(80));
    console.error(`\n❌ ${error.message}`);
    if (error.response) {
      console.error(`\n📥 Ответ от API:`);
      console.error(`   Status: ${error.response.status} ${error.response.statusText}`);
      console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack) {
      console.error(`\n📋 Стек ошибки:`);
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Запускаем скрипт
main();

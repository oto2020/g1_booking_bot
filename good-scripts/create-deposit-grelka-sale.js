// Скрипт для продажи первого попавшегося товара из каталога "ДЕПОЗИТЫ GRELKA"
//
// Что делает:
// 1. Получает pass_token для клиента
// 2. Получает прайс-лист
// 3. Находит первый товар из категории "ДЕПОЗИТЫ GRELKA"
// 4. Создаёт корзину через /cart_cost
// 5. Создаёт продажу через /payment (обычная оплата, НЕ долг)
//
// Как запускать:
//   cd /root/grelka_yookassa_bot
//   node scripts/good-scripts/create-deposit-grelka-sale.js

const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env'),
});
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');

// Отключаем проверку SSL сертификата
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Конфигурация
const PHONE = '+79785667199'; // можно поменять при необходимости
const DEPOSIT_CATEGORY_TITLE = 'ДЕПОЗИТЫ GRELKA';

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
 * Поиск первого товара из каталога "ДЕПОЗИТЫ GRELKA"
 */
function findFirstDepositGrelkaItem(pricelist) {
  const deposits = pricelist.filter(item => {
    if (!item.category) return false;
    if (typeof item.category === 'object' && item.category.title) {
      return item.category.title === DEPOSIT_CATEGORY_TITLE;
    }
    return false;
  });

  if (deposits.length === 0) {
    return null;
  }

  return deposits[0];
}

/**
 * Получение стоимости корзины (создание корзины)
 */
async function getCartCost(passToken, purchaseId, clubId) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  
  const cartArray = [{
    purchase_id: purchaseId,
    count: 1
  }];
  
  const cartJson = JSON.stringify({ cart_array: cartArray });
  
  const params = new URLSearchParams({
    cart: cartJson,
    club_id: clubId
  });
  
  const url = `${baseUrl}/cart_cost/?${params.toString()}`;
  
  let response;
  try {
    response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'apikey': API_KEY,
        'Authorization': AUTHORIZATION,
        'usertoken': passToken
      },
      httpsAgent
    });
  } catch (error) {
    console.error('\n📥 ОТВЕТ ОТ API (ошибка cart_cost):');
    if (error.response) {
      console.error(`   Status: ${error.response.status} ${error.response.statusText}`);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('   Error:', error.message);
    }
    throw error;
  }
  
  if (!response.data.result) {
    console.error('\n❌ cart_cost вернул result = false:');
    console.error(JSON.stringify(response.data, null, 2));
    throw new Error(response.data.error_message || `Ошибка создания корзины: ${response.data.error || 'Неизвестная ошибка'}`);
  }
  
  if (!response.data.data) {
    console.error('\n❌ cart_cost: поле data отсутствует или пустое:');
    console.error(JSON.stringify(response.data, null, 2));
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
  
  if (!response.data) {
    return [];
  }
  
  // API может возвращать данные в разных форматах
  if (Array.isArray(response.data)) {
    return response.data;
  } else if (response.data && Array.isArray(response.data.data)) {
    return response.data.data;
  } else if (response.data && Array.isArray(response.data.deposits)) {
    return response.data.deposits;
  }
  
  return [];
}

/**
 * Создание продажи (обычная оплата, без долга)
 */
async function createSaleFromCart(passToken, cartData, clubId) {
  const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
  
  const cart = cartData.cart.map(item => {
    const cartItem = {
      purchase_id: item.purchase?.id || item.purchase_id,
      count: item.count || 1
    };
    
    if (item.price_type?.id) {
      cartItem.price_type_id = item.price_type.id;
    }
    
    return cartItem;
  });
  
  const totalAmount = cartData.total_amount || 0;
  
  const transaction_id = `sale_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const paymentUrl = `${baseUrl}/payment`;
  
  console.log(`\n🔄 Создание продажи на сумму ${totalAmount} ₽`);
  
  const payment_list = [{
    type: "card",
    amount: 1000
  }];
  
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
  console.log('🚀 СКРИПТ: ПРОДАЖА ПЕРВОГО ТОВАРА ИЗ "ДЕПОЗИТЫ GRELKA"');
  console.log('='.repeat(80));
  console.log(`\n📞 Клиент: ${PHONE}`);
  console.log(`📂 Категория: "${DEPOSIT_CATEGORY_TITLE}"`);
  
  try {
    // 1. Получаем pass_token
    const passToken = await getPassToken(PHONE);
    console.log(`\n✅ pass_token получен`);
    
    // 2. Получаем данные клиента
    const clientData = await getClient(passToken);
    console.log(`\n✅ Данные клиента получены`);
    console.log(`   Имя: ${clientData.name || 'Не указано'}`);
    console.log(`   Club ID: ${clientData.club?.id || 'Не указан'}`);
    
    // 3. Получаем прайс-лист
    console.log(`\n💰 Получение прайс-листа...`);
    const pricelist = await getPricelist(passToken);
    console.log(`   ✅ Позиции в прайсе: ${pricelist.length}`);
    
    // 4. Находим первый товар из "ДЕПОЗИТЫ GRELKA"
    const depositItem = findFirstDepositGrelkaItem(pricelist);
    if (!depositItem) {
      throw new Error(`Товары в категории "${DEPOSIT_CATEGORY_TITLE}" не найдены`);
    }
    
    const purchaseId = depositItem.id || depositItem.purchase_id;
    
    console.log(`\n✅ Найден товар для продажи:`);
    console.log(`   Название: ${depositItem.title || depositItem.name || 'Без названия'}`);
    console.log(`   ID: ${purchaseId}`);
    console.log(`   Категория: ${depositItem.category?.title || 'Не указана'}`);
    console.log(`   Цена: ${depositItem.price_with_discount || depositItem.price || 'Не указана'} ₽`);
    
    // 5. Создаём корзину
    console.log(`\n${'='.repeat(80)}`);
    console.log('🛒 ЭТАП 1: СОЗДАНИЕ КОРЗИНЫ');
    console.log('='.repeat(80));
    
    const cartData = await getCartCost(passToken, purchaseId, clientData.club.id);
    
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
    console.log(`   Общая стоимость: ${cartData.total_amount || 0} ₽`);
    
    // 6. Создаём продажу
    console.log(`\n${'='.repeat(80)}`);
    console.log('💳 ЭТАП 2: СОЗДАНИЕ ПРОДАЖИ ИЗ КОРЗИНЫ');
    console.log('='.repeat(80));
    
    const saleResult = await createSaleFromCart(
      passToken, 
      cartData, 
      clientData.club.id
    );
    
    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ РЕЗУЛЬТАТ: ПРОДАЖА УСПЕШНО СОЗДАНА');
    console.log('='.repeat(80));
    console.log(`\n📋 Информация о продаже:`);
    console.log(`   Transaction ID: ${saleResult.transaction_id}`);
    console.log(`   Статус: Успешно создана`);
    console.log(`   Данные ответа:`, JSON.stringify(saleResult.fullResponse, null, 2));
    
    // Вместо сохранения в БД выводим краткую сводку
    console.log(`\n💾 Сохранение в БД отключено. Сводка по операции:`);
    console.log(`   Клиент: ${clientData.name || 'Не указано'} (${clientData.id || 'нет ID'})`);
    console.log(`   Телефон: ${PHONE}`);
    console.log(`   Товар: ${depositItem.title || depositItem.name || 'Без названия'}`);
    console.log(`   Сумма: ${cartData.total_amount || 0} ₽`);
    console.log(`   Дата/время: ${new Date().toISOString()}`);
    
  } catch (error) {
    console.error(`\n❌ ОШИБКА: ${error.message}`);
  }
}

main();


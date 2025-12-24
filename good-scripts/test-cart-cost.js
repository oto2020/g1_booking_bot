// Скрипт для получения стоимости корзины через /cart_cost
//
// Документация: https://fitness1cv3.docs.apiary.io/#reference/12/cartcost/0
//
// Что делает:
// 1. Читает товар из test-price-sections-output.json (первый элемент)
// 2. Получает pass_token для клиента +79785667199
// 3. Получает данные клиента и club_id
// 4. Рассчитывает стоимость корзины через GET /cart_cost
// 5. Выводит и сохраняет результат
//
// Как запускать:
//   cd /root/grelka_yookassa_bot
//   node scripts/good-scripts/test-cart-cost.js

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Отключаем проверку SSL сертификата
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Конфигурация
const PHONE = '+79785667199';
const PRODUCT_FILE = path.join(__dirname, '..', 'test-price-sections-output.json');

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
 * Получение pass_token по телефону
 */
async function getPassToken(phone) {
  const normalizedPhone = phone.replace(/\D/g, '');
  const sign = crypto.createHash('sha256')
    .update(`phone:${normalizedPhone};key:${SECRET_KEY}`)
    .digest('hex');

  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/pass_token/?phone=${normalizedPhone}&sign=${sign}`;

  console.log('📞 Получение pass_token...');
  console.log(`   Телефон: ${phone} (нормализованный: ${normalizedPhone})`);

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

  const passToken = response.data.data.pass_token;
  console.log(`✅ pass_token получен: ${passToken.substring(0, 20)}...`);
  return passToken;
}

/**
 * Получение данных клиента
 */
async function getClientData(passToken) {
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/client`;

  console.log('\n👤 Получение данных клиента...');

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

  const clientData = response.data.data;
  console.log(`✅ Клиент найден: ${clientData.name} ${clientData.last_name || ''}`);
  console.log(`   ID: ${clientData.id}`);
  console.log(`   Телефон: ${clientData.phone}`);
  
  if (!clientData.club || !clientData.club.id) {
    throw new Error('club_id не найден в данных клиента');
  }
  
  console.log(`   Клуб ID: ${clientData.club.id}`);
  if (clientData.club.name) {
    console.log(`   Название клуба: ${clientData.club.name}`);
  }

  return clientData;
}

/**
 * Чтение товара из файла
 */
function getProductFromFile() {
  if (!fs.existsSync(PRODUCT_FILE)) {
    throw new Error(`Файл ${PRODUCT_FILE} не найден`);
  }

  const fileContent = fs.readFileSync(PRODUCT_FILE, 'utf8');
  const products = JSON.parse(fileContent);

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('Файл не содержит товаров');
  }

  const product = products[0];
  
  console.log('\n📦 Товар из файла:');
  console.log(`   ID: ${product.id}`);
  console.log(`   Название: ${product.title}`);
  console.log(`   Цена: ${product.price} ₽`);

  return product;
}

/**
 * Получение стоимости корзины через cart_cost
 * Документация: GET /cart_cost/?cart=&club_id=&promocode=&certificate=
 */
async function getCartCost(passToken, product, clubId) {
  console.log('\n💰 Расчет стоимости корзины через cart_cost...');
  
  // Формируем cart согласно документации
  // cart - это JSON строка с массивом структур cart_array
  // ВАЖНО: используем purchase_id (как в документации cart_cost), а не nomenclature_id!
  const cartItem = {
    purchase_id: product.id,
    count: 1
  };
  
  // НЕ УКАЗЫВАЕМ ТРЕНЕРА - не добавляем employee_id в cart_cost запрос
  
  const cartData = {
    cart_array: [cartItem]
  };
  
  const cartString = JSON.stringify(cartData);
  
  // Формируем URL с параметрами
  const params = new URLSearchParams({
    cart: cartString,
    club_id: clubId
  });
  
  const url = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}/cart_cost/?${params.toString()}`;
  
  console.log(`   URL: ${url.substring(0, 100)}...`);
  console.log(`   Cart: ${cartString}`);
  
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
      const cartCostData = response.data.data;
      
      console.log(`\n✅ ✅ ✅ СТОИМОСТЬ КОРЗИНЫ РАССЧИТАНА УСПЕШНО! ✅ ✅ ✅`);
      console.log(`\n📊 Результаты расчета:`);
      console.log(`   Общая сумма: ${cartCostData.total_amount || 0} ₽`);
      console.log(`   Скидка: ${cartCostData.total_discount || 0} ₽`);
      console.log(`   Количество позиций в корзине: ${cartCostData.cart?.length || 0}`);
      
      if (cartCostData.cart && cartCostData.cart.length > 0) {
        console.log(`\n📦 Детали корзины:`);
        cartCostData.cart.forEach((item, index) => {
          console.log(`   ${index + 1}. Позиция:`);
          if (item.purchase) {
            console.log(`      Товар: ${item.purchase.title || item.purchase.name || 'Без названия'}`);
            console.log(`      ID: ${item.purchase.id || 'Не указан'}`);
          }
          console.log(`      Количество: ${item.count || 1}`);
          console.log(`      Цена: ${item.price || 0} ₽`);
          if (item.price_type) {
            console.log(`      Вид цен: ${item.price_type.name || item.price_type.title || 'Не указан'}`);
            console.log(`      ID вида цен: ${item.price_type.id || 'Не указан'}`);
          }
          if (item.payment_amount) {
            console.log(`      Сумма к оплате: ${item.payment_amount} ₽`);
          }
        });
      }
      
      if (cartCostData.may_be_payment && cartCostData.may_be_payment.length > 0) {
        console.log(`\n💳 Доступные способы оплаты:`);
        cartCostData.may_be_payment.forEach((payment, index) => {
          console.log(`   ${index + 1}. ${payment.title || payment.name || 'Без названия'}`);
          console.log(`      ID: ${payment.id}`);
          if (payment.balance !== undefined) {
            console.log(`      Баланс: ${payment.balance} ₽`);
          }
        });
      }
      
      if (cartCostData.client) {
        console.log(`\n👤 Информация о клиенте:`);
        console.log(`   ID: ${cartCostData.client.id || 'Не указан'}`);
        if (cartCostData.client.name) {
          console.log(`   Имя: ${cartCostData.client.name} ${cartCostData.client.last_name || ''}`);
        }
      }
      
      if (cartCostData.org_id) {
        console.log(`\n🏢 ID организации: ${cartCostData.org_id}`);
      }
      
      // Сохраняем ответ cart_cost
      const outputPath = path.join(__dirname, '..', 'cartcost-response.json');
      fs.writeFileSync(outputPath, JSON.stringify(response.data, null, 2), 'utf8');
      console.log(`\n💾 Полный ответ сохранен в: ${outputPath}`);
      
      return cartCostData;
    } else {
      throw new Error('Неверный формат ответа от cart_cost');
    }
  } catch (error) {
    console.error(`\n❌ Ошибка при расчете стоимости корзины:`);
    
    if (error.response) {
      console.error(`   Статус: ${error.response.status} ${error.response.statusText}`);
      console.error(`   Ответ:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(`   Ошибка: ${error.message}`);
    }
    
    throw error;
  }
}

/**
 * Главная функция
 */
async function main() {
  try {
    console.log('🚀 Тест получения стоимости корзины через /cart_cost');
    console.log(`   Телефон: ${PHONE}`);
    console.log(`   API: https://${API_HOSTNAME}:${API_PORT}${API_PATH}`);
    console.log('='.repeat(80));

    // 1. Читаем товар из файла
    const product = getProductFromFile();

    // 2. Получаем pass_token
    const passToken = await getPassToken(PHONE);

    // 3. Получаем данные клиента и club_id
    const clientData = await getClientData(passToken);

    // 4. Рассчитываем стоимость корзины через cart_cost
    await getCartCost(passToken, product, clientData.club.id);

    console.log('\n' + '='.repeat(80));
    console.log('✅ Скрипт выполнен успешно!');
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Ошибка выполнения скрипта:');
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


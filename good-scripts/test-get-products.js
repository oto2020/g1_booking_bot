// Тестовый скрипт для получения позиций из категории "Сайкл студия"
//
// Что делает:
// 1. Получает pass_token для пользователя
// 2. Получает прайс-лист
// 3. Фильтрует позиции по категории "Сайкл студия"
// 4. Применяет фильтр по наличию "Не ЧК" в зависимости от активного членства
// 5. Сохраняет результат в test-price-sections-output.json
//
// Как запускать:
//   cd /root/grelka_yookassa_bot
//   node scripts/test-get-products.js

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

// Телефон пользователя
const PHONE = '+79785667199';

// Название категории для фильтрации
const TARGET_CATEGORY = 'Сайкл студия';

// Правила определения ЧК/Не ЧК:
// - Если в названии позиции есть "Не ЧК" - это позиция "Не ЧК"
// - Если в названии позиции НЕТ "Не ЧК" - это позиция "ЧК" (или без обозначения)
// - Если у клиента ЕСТЬ активное членство → показываем только позиции БЕЗ "Не ЧК" (т.е. с "ЧК" или без обозначения)
// - Если у клиента НЕТ активного членства → показываем только позиции С "Не ЧК"

// ============================================
// КОНЕЦ КОНФИГУРАЦИИ
// ============================================

// Отключаем проверку SSL сертификата
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
      console.log(`   Пробуем: GET ${endpoint}`);
      const response = await axios.get(url, {
        headers,
        httpsAgent,
        timeout: 10000
      });

      console.log(`   ✅ Статус: ${response.status}`);

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
        console.log(`   ✅ Найдено позиций: ${items.length}`);
        return items;
      }
    } catch (error) {
      if (error.response && error.response.status !== 404) {
        console.log(`   ❌ ${error.response.status} ${error.response.statusText}`);
      } else {
        console.log(`   ❌ ${error.message}`);
      }
      continue;
    }
  }

  throw new Error('Не удалось получить прайс-лист');
}

/**
 * Проверка наличия активного членства
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
    } else if (depositsResponse.data && Array.isArray(depositsResponse.data.deposits)) {
      deposits = depositsResponse.data.deposits;
    }
    
    // Проверяем наличие активных депозитов (членств)
    // Активное членство = есть депозит с exists === true и balance > 0 или есть активный абонемент
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
 * Основная функция
 */
async function main() {
  console.log('🚀 Получение позиций из категории "' + TARGET_CATEGORY + '"');
  console.log(`   Пользователь: ${PHONE}`);
  console.log(`   API: https://${API_HOSTNAME}:${API_PORT}${API_PATH}`);

  try {
    // 1. Получаем pass_token
    const passToken = await getPassToken(PHONE);

    // 2. Проверяем наличие активного членства
    console.log('\n💳 Проверка активного членства...');
    const hasActiveMembership = await checkActiveMembership(passToken);
    console.log(`   ${hasActiveMembership ? '✅ ЕСТЬ активное членство' : '❌ НЕТ активного членства'}`);

    // 3. Получаем прайс-лист
    console.log('\n💰 Получение прайс-листа...');
    const pricelist = await getPricelist(passToken);
    console.log(`   ✅ Получено позиций: ${pricelist.length}`);

    // 4. Фильтруем позиции по категории
    console.log(`\n🎯 Фильтрация позиций по категории "${TARGET_CATEGORY}"...`);
    let filteredItems = pricelist.filter(item => {
      if (!item.category) return false;
      if (typeof item.category === 'object' && item.category.title) {
        return item.category.title === TARGET_CATEGORY;
      }
      return false;
    });
    console.log(`   Найдено позиций в категории: ${filteredItems.length}`);

    // 5. Фильтруем по наличию "Не ЧК" в зависимости от членства
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

    // 6. Сохраняем результат
    const outputPath = './scripts/test-price-sections-output.json';
    fs.writeFileSync(outputPath, JSON.stringify(titleFilteredItems, null, 2), 'utf8');
    console.log(`\n💾 Результат сохранен в: ${outputPath}`);
    console.log(`   Сохранено позиций: ${titleFilteredItems.length}`);

    console.log('\n✅ Скрипт выполнен успешно!');
  } catch (error) {
    console.error('\n❌ Ошибка выполнения скрипта:', error.message);
    if (error.stack) {
      console.error('\nСтек ошибки:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Запускаем скрипт
main();

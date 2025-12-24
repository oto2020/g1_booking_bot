// Скрипт кэша расписания: каждые 15 минут запрашивает занятия и сохраняет в classes-cache.json
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ApiHelper } = require('./ApiHelper');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CACHE_PHONE = process.env.CACHE_PHONE || process.env.PHONE || process.env.DEFAULT_PHONE;

if (!CACHE_PHONE) {
  console.warn('CACHE_PHONE не задан — скрипт не сможет обновить кэш. Установите CACHE_PHONE.');
}

const CLASSES_PATH = path.join(__dirname, 'classes.json');
const CACHE_PATH = path.join(__dirname, 'classes-cache.json');

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

function selectUpcomingByConfig(classes, cfg, horizonDays = 3) {
  const now = new Date();
  const end = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
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

async function refreshCache() {
  if (!CACHE_PHONE) {
    console.error('CACHE_PHONE отсутствует. Обновление кэша пропущено.');
    return;
  }
  const classesConfig = loadClassesConfig();
  if (!classesConfig.length) {
    console.warn('classes.json пуст. Пропускаю обновление.');
    return;
  }

  console.time('cache-total');
  try {
    console.time('cache-pass-token');
    const passToken = await ApiHelper.getPassTokenByPhone(CACHE_PHONE);
    console.timeEnd('cache-pass-token');

    console.time('cache-client');
    const client = await ApiHelper.getClientByPassToken(passToken);
    console.timeEnd('cache-client');

    const clubId = client?.club?.id;
    if (!clubId) throw new Error('clubId не найден у клиента');

  const now = new Date();
  const end = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const toISO = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

    console.time('cache-classes');
  const classes = await ApiHelper.getClasses(passToken, clubId, toISO(now), toISO(end));
    console.timeEnd('cache-classes');

  // Получаем свободные места для всех занятий
  const appointmentIds = classes
    .map((c) => c.appointment_id || c.id)
    .filter(Boolean);
  let slotsMap = {};
  try {
    console.time('cache-available-slots');
    slotsMap = await getAvailableSlots(passToken, appointmentIds);
    console.timeEnd('cache-available-slots');
  } catch (e) {
    console.warn('Не удалось получить available_slots:', e.message);
  }

    const result = {};
  classesConfig.forEach((cfg) => {
    result[cfg.key] = selectUpcomingByConfig(classes, cfg, 3).map((cls) => ({
      appointment_id: cls.appointment_id || cls.id,
      start_date: cls.start_date,
      room_title: cls.room?.title || '',
      service_title: cls.service?.title || '',
      employee: cls.employee ? { id: cls.employee.id, name: cls.employee.name } : null,
      recorded:
        cls.recorded ??
        cls.is_recorded ??
        cls.enrolled ??
        cls.in_record ??
        cls.client_enrolled ??
        cls.already_booked ??
        false,
    }));
    });

    fs.writeFileSync(
      CACHE_PATH,
      JSON.stringify(
        {
          updated_at: new Date().toISOString(),
          club_id: clubId,
          phone: CACHE_PHONE,
          data: result,
        },
        null,
        2
      ),
      'utf8'
    );

    console.log(`Кэш обновлён: ${CACHE_PATH}`);
  } catch (err) {
    console.error('Ошибка обновления кэша:', err.message);
  } finally {
    console.timeEnd('cache-total');
  }
}

// Первичное обновление и далее каждые 15 минут
refreshCache();
setInterval(refreshCache, 15 * 60 * 1000);


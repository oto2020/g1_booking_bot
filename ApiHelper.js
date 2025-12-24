require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const {
  API_HOSTNAME,
  API_PORT,
  API_PATH,
  API_KEY,
  SECRET_KEY,
  AUTHORIZATION,
} = process.env;

if (!API_HOSTNAME || !API_PORT || !API_PATH || !API_KEY || !SECRET_KEY || !AUTHORIZATION) {
  console.error('Не заданы API_HOSTNAME/API_PORT/API_PATH/API_KEY/SECRET_KEY/AUTHORIZATION');
}

const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;

class ApiHelper {
  static buildHeaders(extra = {}) {
    return {
      'Content-Type': 'application/json',
      apikey: API_KEY,
      Authorization: AUTHORIZATION,
      ...extra,
    };
  }

  static async getPassTokenByPhone(phone) {
    const normalizedPhone = phone.replace(/\D/g, '');
    const sign = crypto.createHash('sha256').update(`phone:${normalizedPhone};key:${SECRET_KEY}`).digest('hex');
    const url = `${baseUrl}/pass_token/?phone=${normalizedPhone}&sign=${sign}`;
    console.log(`[Api] GET /pass_token — получение pass_token по телефону ${normalizedPhone}`);
    const response = await axios.get(url, { headers: this.buildHeaders() });
    if (!response.data?.result || !response.data?.data?.pass_token) {
      throw new Error('Не удалось получить pass_token');
    }
    return response.data.data.pass_token;
  }

  static async getClientByPassToken(passToken) {
    const url = `${baseUrl}/client`;
    console.log('[Api] GET /client — получение карточки клиента по usertoken');
    const response = await axios.get(url, {
      headers: this.buildHeaders({ usertoken: passToken }),
    });
    if (!response.data?.result || !response.data?.data) {
      throw new Error('Карточка не найдена');
    }
    return response.data.data;
  }

  static async getTickets(passToken, type = 'membership') {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    const url = `${baseUrl}/tickets/?${params.toString()}`;
    console.log(`[Api] GET /tickets — список билетов клиента (type=${type || 'all'})`);
    const response = await axios.get(url, {
      headers: this.buildHeaders({ usertoken: passToken }),
    });
    if (!response.data) return [];
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.data.data)) return response.data.data;
    return [];
  }

  static async getPricelist(passToken) {
    const headers = this.buildHeaders({ usertoken: passToken });
    const endpoints = ['pricelist', 'price_list', 'prices', 'price-list'];
    for (const endpoint of endpoints) {
      const url = `${baseUrl}/${endpoint}`;
      try {
        console.log(`[Api] GET /${endpoint} — попытка получить прайс-лист`);
        const resp = await axios.get(url, { headers, timeout: 10000 });
        let items = [];
        if (Array.isArray(resp.data)) items = resp.data;
        else if (resp.data && Array.isArray(resp.data.data)) items = resp.data.data;
        else if (resp.data && Array.isArray(resp.data.items)) items = resp.data.items;
        else if (resp.data && Array.isArray(resp.data.pricelist)) items = resp.data.pricelist;
        else if (resp.data && Array.isArray(resp.data.prices)) items = resp.data.prices;
        if (items.length > 0 || (resp.data && resp.data.result !== false)) return items;
      } catch {
        continue;
      }
    }
    throw new Error('Не удалось получить прайс-лист');
  }

  static async getClasses(passToken, clubId, startDate, endDate) {
    const params = new URLSearchParams({
      club_id: clubId,
      start_date: startDate,
      end_date: endDate,
    });
    const url = `${baseUrl}/classes/?${params.toString()}`;
    console.log('[Api] GET /classes — расписание занятий за период');
    const response = await axios.get(url, {
      headers: this.buildHeaders({ usertoken: passToken }),
    });
    if (!response.data?.result) {
      throw new Error(response.data?.error_message || response.data?.error || 'Ошибка /classes');
    }
    return Array.isArray(response.data.data) ? response.data.data : [];
  }

  static async getClassDescriptions(passToken, appointmentIds) {
    if (!appointmentIds.length) return {};
    const url = `${baseUrl}/class_descriptions`;
    const map = {};
    for (const id of appointmentIds) {
      try {
        console.log(`[Api] GET /class_descriptions — краткое описание занятия ${id}`);
        const response = await axios.get(`${url}/?appointment_id=${id}`, {
          headers: this.buildHeaders({ usertoken: passToken }),
        });
        if (response.data?.result && response.data?.data) {
          map[id] = response.data.data;
        }
      } catch (err) {
        if (err.response) {
          console.error(
            'class_descriptions error:',
            err.response.status,
            err.response.statusText,
            JSON.stringify(err.response.data)
          );
        } else {
          console.error('class_descriptions error:', err.message);
        }
      }
    }
    return map;
  }

  static async getClassDescription(passToken, appointmentId) {
    const url = `${baseUrl}/class_descriptions/?appointment_id=${appointmentId}`;
    console.log(`[Api] GET /class_descriptions — подробное описание занятия ${appointmentId}`);
    const response = await axios.get(url, {
      headers: this.buildHeaders({ usertoken: passToken }),
    });
    if (response.data?.result && response.data?.data) return response.data.data;
    throw new Error(response.data?.error_message || response.data?.error || 'class_description error');
  }

  static async cancelClassBooking(passToken, appointmentId) {
    const url = `${baseUrl}/client_from_class/?appointment_id=${appointmentId}`;
    const headers = this.buildHeaders({ usertoken: passToken });
    const makeResult = (resp) => {
      if (resp?.data?.result) return { success: true, data: resp.data.data };
      return {
        success: false,
        reason: resp?.data?.error_message || resp?.data?.error || 'cancel failed',
        raw: resp?.data,
        status: resp?.status,
      };
    };

    try {
      // Согласно документации — DELETE
      console.log(`[Api] DELETE /client_from_class — отмена записи на занятие ${appointmentId}`);
      const response = await axios.delete(url, { headers });
      return makeResult(response);
    } catch (err) {
      return {
        success: false,
        reason:
          err.response?.data?.error_message || err.response?.data?.error || `HTTP ${err.response?.status || ''}` || err.message,
        raw: err.response?.data,
        status: err.response?.status,
      };
    }
  }

  static async bookClass(passToken, appointmentId, clubId = null, ticketId = null) {
    const url = `${baseUrl}/client_to_class`;
    const body = {
      appointment_id: appointmentId,
      ...(clubId ? { club_id: clubId } : {}),
      ...(ticketId ? { ticket_id: ticketId } : {}),
    };

    try {
      console.log(
        `[Api] POST /client_to_class — запись на занятие ${appointmentId}` +
          (ticketId ? `, ticket_id=${ticketId}` : '')
      );
      const response = await axios.post(url, body, {
        headers: this.buildHeaders({ usertoken: passToken }),
      });
      if (response.data?.result) {
        return { success: true, data: response.data.data, raw: response.data };
      }
      return {
        success: false,
        reason: response.data?.error_message || response.data?.error || 'book failed',
        raw: response.data,
      };
    } catch (err) {
      if (err.response) {
        return {
          success: false,
          reason: err.response.data?.error_message || err.response.data?.error || `HTTP ${err.response.status}`,
          raw: err.response.data,
          status: err.response.status,
        };
      }
      return { success: false, reason: err.message };
    }
  }

  static async getClientAppointments(passToken, params = {}) {
    const search = new URLSearchParams();
    if (params.type) search.append('type', params.type);
    if (params.statuses && Array.isArray(params.statuses)) {
      search.append('statuses', JSON.stringify(params.statuses));
    }
    if (typeof params.requested_offset === 'number') {
      search.append('requested_offset', String(params.requested_offset));
    }
    if (typeof params.page_size === 'number') {
      search.append('page_size', String(params.page_size));
    }
    const qs = search.toString();
    const url = `${baseUrl}/appointments${qs ? `/?${qs}` : ''}`;
    try {
      console.log(
        `[Api] GET /appointments — список занятий клиента${qs ? ` (${qs})` : ''}`
      );
      const response = await axios.get(url, {
        headers: this.buildHeaders({ usertoken: passToken }),
      });
      if (Array.isArray(response.data)) return response.data;
      if (response.data && Array.isArray(response.data.data)) return response.data.data;
      return [];
    } catch (err) {
      console.error('getClientAppointments error:', err.response?.data || err.message);
      return [];
    }
  }

  static async getDeposits(passToken) {
    const url = `${baseUrl}/deposits`;
    console.log('[Api] GET /deposits — список лицевых счетов клиента');
    try {
      const response = await axios.get(url, {
        headers: this.buildHeaders({ usertoken: passToken }),
      });
      let deposits = [];
      if (Array.isArray(response.data)) deposits = response.data;
      else if (response.data && Array.isArray(response.data.data)) deposits = response.data.data;
      else if (response.data && Array.isArray(response.data.deposits)) deposits = response.data.deposits;
      return deposits;
    } catch (err) {
      console.error('getDeposits error:', err.response?.data || err.message);
      return [];
    }
  }

  static async getCartCost(passToken, purchaseId, clubId, serviceId = null) {
    const baseUrl = `https://${API_HOSTNAME}:${API_PORT}${API_PATH}`;
    const cartArray = [{ purchase_id: purchaseId, count: 1 }];
    if (serviceId) cartArray[0].service_id = serviceId;
    const cartJson = JSON.stringify({ cart_array: cartArray });
    const params = new URLSearchParams({ cart: cartJson, club_id: clubId });
    const url = `${baseUrl}/cart_cost/?${params.toString()}`;
    console.log(`[Api] GET /cart_cost — стоимость корзины для purchase_id=${purchaseId}`);
    try {
      const response = await axios.get(url, {
        headers: this.buildHeaders({ usertoken: passToken }),
      });
      if (!response.data?.result) {
        throw new Error(response.data?.error_message || `Ошибка ${response.data?.error || 'Неизвестная ошибка'}`);
      }
      if (!response.data?.data || !response.data.data.cart || !Array.isArray(response.data.data.cart) || response.data.data.cart.length === 0) {
        throw new Error('Корзина не была создана: корзина пуста или не содержит товаров');
      }
      return response.data.data;
    } catch (err) {
      if (err.response) {
        throw new Error(err.response.data?.error_message || `Ошибка ${err.response.data?.error || err.response.status}`);
      }
      throw err;
    }
  }

  static async createPayment(passToken, cartData, clubId, paymentList, serviceId = null) {
    const url = `${baseUrl}/payment`;
    const cart = cartData.cart.map((item) => {
      const cartItem = {
        purchase_id: item.purchase?.id || item.purchase_id,
        count: parseInt(item.count || 1, 10),
      };
      if (item.price_type?.id) cartItem.price_type_id = item.price_type.id;
      if (serviceId) cartItem.service_id = serviceId;
      return cartItem;
    });
    const transaction_id = `sale_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const requestBody = {
      transaction_id,
      cart,
      payment_list: paymentList,
      club_id: clubId,
    };
    if (cartData.org_id) requestBody.org_id = cartData.org_id;
    console.log(`[Api] POST /payment — создание продажи с оплатой (transaction_id=${transaction_id})`);
    try {
      const response = await axios.post(url, requestBody, {
        headers: this.buildHeaders({ usertoken: passToken }),
      });
      if (response.data?.result) {
        return { success: true, transaction_id, data: response.data.data, raw: response.data };
      }
      throw new Error(response.data?.error_message || `Ошибка ${response.data?.error || 'Неизвестная ошибка'}`);
    } catch (err) {
      if (err.response) {
        throw new Error(err.response.data?.error_message || `Ошибка ${err.response.data?.error || err.response.status}`);
      }
      throw err;
    }
  }
}

module.exports = { ApiHelper };


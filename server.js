const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== Middleware ====================
app.use(cors());
app.use(express.json());
app.options('*', cors());

// ==================== Переменные окружения ====================
const { BOT_TOKEN, CHAT_ID, MANAGER_USERNAME, MANAGER_PHONE, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY } = process.env;

if (!BOT_TOKEN || !CHAT_ID) {
    console.error('❌ Ошибка: Не заданы BOT_TOKEN или CHAT_ID');
    process.exit(1);
}

// ==================== ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ====================
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

// Создаём таблицу, если её нет
async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price INTEGER NOT NULL,
        type TEXT NOT NULL,
        weight TEXT NOT NULL,
        description TEXT NOT NULL,
        image TEXT NOT NULL,
        flowwow_link TEXT DEFAULT '',
        active BOOLEAN DEFAULT TRUE
      );
    `);
    console.log('✅ Таблица products готова');
  } catch (err) {
    console.error('❌ Ошибка создания таблицы:', err);
  }
}

initDb();

// ==================== Вспомогательная функция платежа ====================
async function createYooKassaPayment(amount, description, returnUrl) {
    const idempotenceKey = Date.now().toString() + '-' + Math.random().toString(16).slice(2);
    const response = await axios.post(
        'https://api.yookassa.ru/v3/payments',
        {
            amount: { value: amount.toFixed(2), currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: returnUrl },
            capture: true,
            description: description
        },
        {
            auth: { username: YOOKASSA_SHOP_ID, password: YOOKASSA_SECRET_KEY },
            headers: { 'Idempotence-Key': idempotenceKey, 'Content-Type': 'application/json' }
        }
    );
    return response.data;
}

// ==================== ЭНДПОИНТ: Заказы ====================
app.post('/api/order', async (req, res) => {
    try {
        const order = req.body;
        const finalTotal = Number(order.finalTotal) || 0;
        const prepaid = Number(order.prepaid) || 0;
        const remaining = finalTotal - prepaid;
        const itemsList = order.items.map(i => `• ${i.name}: ${i.quantity} ${i.unit} = ${i.total} ₽`).join('\n');

        let deliveryText, addressText;
        if (order.delivery.method === 'pickup') {
            deliveryText = '🚶 Самовывоз: Московский пр-кт, 10 (0 ₽)';
            addressText = '📍 Точка самовывоза: Московский пр-кт, 10';
        } else {
            deliveryText = `🚚 Доставка (зона ${order.delivery.zone}): ${order.deliveryCost} ₽`;
            addressText = `📍 ${order.delivery.address}`;
        }

        const commentText = order.customer.comment ? `\n💬 ${order.customer.comment}` : '';
        const clientLine = order.customer.username ? `👤 Клиент: @${order.customer.username}` : `👤 Клиент (Telegram не указан)`;
        const orderNumber = Date.now().toString().slice(-6);

        let remainingPaymentUrl = null;
        if (remaining > 0 && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY) {
            try {
                const secondPayment = await createYooKassaPayment(remaining, `Доплата за заказ Bakary №${orderNumber}`, 'https://t.me/bakary36_bot/bakary');
                if (secondPayment?.confirmation?.confirmation_url) remainingPaymentUrl = secondPayment.confirmation.confirmation_url;
            } catch (e) { console.error('Ошибка доплаты:', e.response?.data || e.message); }
        }

        const remainingLine = remaining > 0 ? `💰 *Остаток к доплате:* ${remaining} ₽` : '💰 *Остаток к доплате:* 0 ₽';
        const remainingLinkLine = remainingPaymentUrl ? `\n🔗 Ссылка для доплаты: ${remainingPaymentUrl}` : '';

        const message = `
🍰 *НОВЫЙ ЗАКАЗ #${orderNumber}*

${itemsList}

*Итого за товары:* ${order.cartTotal} ₽
${deliveryText}
*К оплате всего:* ${finalTotal} ₽

💳 *Предоплата (50%):* ${prepaid} ₽
${remainingLine}${remainingLinkLine}

📅 ${order.datetime.date} ${order.datetime.time}
${addressText}
📞 ${order.customer.phone}
${clientLine}${commentText}
        `.trim();

        const replyMarkup = order.customer.username ? { inline_keyboard: [ [ { text: '📞 Написать клиенту', url: `https://t.me/${order.customer.username.replace(/^@/, '')}` } ] ] } : undefined;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text: message, parse_mode: 'Markdown', reply_markup: replyMarkup });
        res.status(200).json({ success: true, message: 'Заказ отправлен менеджеру' });
    } catch (error) {
        console.error('Ошибка обработки заказа:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ==================== ЭНДПОИНТЫ ДЛЯ ПЛАТЕЖЕЙ ====================
app.post('/api/create-payment', async (req, res) => {
    try {
        if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) return res.status(500).json({ success: false, error: 'YooKassa credentials not configured' });
        const { amount, description, returnUrl } = req.body;
        const payment = await createYooKassaPayment(amount, description, returnUrl);
        res.status(200).json({ success: true, paymentId: payment.id, status: payment.status, confirmationUrl: payment.confirmation?.confirmation_url || null });
    } catch (error) {
        console.error('Ошибка создания платежа:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Ошибка при создании платежа' });
    }
});

app.post('/api/create-second-payment', async (req, res) => {
    try {
        if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) return res.status(500).json({ success: false, error: 'YooKassa credentials not configured' });
        const { remainingAmount, description, returnUrl } = req.body;
        const payment = await createYooKassaPayment(remainingAmount, description, returnUrl);
        res.status(200).json({ success: true, paymentId: payment.id, status: payment.status, confirmationUrl: payment.confirmation?.confirmation_url || null });
    } catch (error) {
        console.error('Ошибка создания доплаты:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Ошибка при создании доплаты' });
    }
});

// ==================== НОВЫЕ ЭНДПОИНТЫ ДЛЯ ТОВАРОВ (с базой данных) ====================

// Получить все товары
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, price, type, weight, description, image, flowwow_link AS "flowwowLink", active FROM products ORDER BY id ASC'
        );
        res.json(result.rows);
    } catch (e) {
        console.error('Ошибка GET /api/products:', e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Создать товар
app.post('/api/products', async (req, res) => {
    try {
        const { name, price, type, weight, description, image, flowwowLink, active } = req.body;
        const result = await pool.query(
            `INSERT INTO products (name, price, type, weight, description, image, flowwow_link, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING id, name, price, type, weight, description, image, flowwow_link AS "flowwowLink", active`,
            [ name || '', Number(price) || 0, type || 'set4', weight || '', description || '', image || '', flowwowLink || '', active !== undefined ? !!active : true ]
        );
        res.status(201).json(result.rows[0]);
    } catch (e) {
        console.error('Ошибка POST /api/products:', e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Обновить товар
app.put('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, type, weight, description, image, flowwowLink, active } = req.body;
        const result = await pool.query(
            `UPDATE products SET
                name = COALESCE($1, name),
                price = COALESCE($2, price),
                type = COALESCE($3, type),
                weight = COALESCE($4, weight),
                description = COALESCE($5, description),
                image = COALESCE($6, image),
                flowwow_link = COALESCE($7, flowwow_link),
                active = COALESCE($8, active)
             WHERE id = $9
             RETURNING id, name, price, type, weight, description, image, flowwow_link AS "flowwowLink", active`,
            [ name ?? null, price !== undefined ? Number(price) : null, type ?? null, weight ?? null, description ?? null, image ?? null, flowwowLink ?? null, active !== undefined ? !!active : null, id ]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (e) {
        console.error('Ошибка PUT /api/products/:id:', e);
        res.status(500).json({ error: 'DB error' });
    }
});

// Деактивировать товар
app.delete('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE products SET active = FALSE WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) {
        console.error('Ошибка DELETE /api/products/:id:', e);
        res.status(500).json({ error: 'DB error' });
    }
});

// ==================== ЭНДПОИНТ: Проверка здоровья ====================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', time: new Date().toISOString() });
});

// ==================== Запуск сервера ====================
app.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});

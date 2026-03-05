const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Переменные окружения
const { BOT_TOKEN, CHAT_ID, MANAGER_USERNAME, MANAGER_PHONE, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY } = process.env;

// Проверка обязательных переменных
if (!BOT_TOKEN || !CHAT_ID) {
    console.error('❌ Ошибка: Не заданы BOT_TOKEN или CHAT_ID');
    process.exit(1);
}

if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    console.warn('⚠️ Не заданы YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY — оплата не будет работать');
}

// ==================== ЭНДПОИНТ 1: Отправка заказа менеджеру ====================
app.post('/api/order', async (req, res) => {
    try {
        const order = req.body;
        
        const itemsList = order.items.map(i => 
            `• ${i.name}: ${i.quantity} ${i.unit} = ${i.total} ₽`
        ).join('\n');

        const deliveryText = order.delivery.method === 'pickup' 
            ? '🚶 Самовывоз (бесплатно)' 
            : `🚚 Доставка (зона ${order.delivery.zone}): ${order.deliveryCost} ₽`;

        const message = `
🍰 *НОВЫЙ ЗАКАЗ #${Date.now().toString().slice(-6)}*

${itemsList}

*Итого за товары:* ${order.cartTotal} ₽
${deliveryText}
*К оплате всего:* ${order.finalTotal} ₽

💳 *Предоплата 50%:* ${order.prepaid} ₽
💰 *При получении:* ${order.finalTotal - order.prepaid} ₽

📅 ${order.datetime.date} ${order.datetime.time}
📍 ${order.delivery.address}
📞 ${order.customer.phone}
${order.customer.comment ? `💬 ${order.customer.comment}` : ''}

👤 Менеджер: ${MANAGER_USERNAME} (${MANAGER_PHONE})
        `;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });

        res.status(200).json({ success: true, message: 'Заказ отправлен менеджеру' });
    } catch (error) {
        console.error('Ошибка обработки заказа:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ==================== ЭНДПОИНТ 2: Создание платежа в ЮKassa ====================
app.post('/api/create-payment', async (req, res) => {
    try {
        if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
            return res.status(500).json({ success: false, error: 'YooKassa credentials not configured' });
        }

        const { amount, description, returnUrl } = req.body;

        // Идемпотентный ключ (защита от повторных списаний)
        const idempotenceKey = Date.now().toString() + '-' + Math.random().toString(16).slice(2);

        const response = await axios.post(
            'https://api.yookassa.ru/v3/payments',
            {
                amount: {
                    value: amount.toFixed(2),
                    currency: 'RUB'
                },
                confirmation: {
                    type: 'redirect',
                    return_url: returnUrl || 'https://bakary.ru/'
                },
                capture: true,
                description: description || 'Заказ Bakary'
            },
            {
                auth: {
                    username: YOOKASSA_SHOP_ID,
                    password: YOOKASSA_SECRET_KEY
                },
                headers: {
                    'Idempotence-Key': idempotenceKey,
                    'Content-Type': 'application/json'
                }
            }
        );

        const payment = response.data;

        res.status(200).json({
            success: true,
            paymentId: payment.id,
            status: payment.status,
            confirmationUrl: payment.confirmation?.confirmation_url || null
        });
    } catch (error) {
        console.error('Ошибка создания платежа YooKassa:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Ошибка при создании платежа YooKassa' });
    }
});

// ==================== ЭНДПОИНТ 3: Проверка здоровья ====================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});

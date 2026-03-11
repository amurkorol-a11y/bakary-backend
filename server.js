const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== Middleware ====================
app.use(cors());
app.use(express.json());

// Разрешаем preflight CORS-запросы для всех маршрутов
app.options('*', cors());

// ==================== Переменные окружения ====================
const { BOT_TOKEN, CHAT_ID, MANAGER_USERNAME, MANAGER_PHONE, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY } = process.env;

if (!BOT_TOKEN || !CHAT_ID) {
    console.error('❌ Ошибка: Не заданы BOT_TOKEN или CHAT_ID');
    process.exit(1);
}

if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    console.warn('⚠️ Не заданы YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY — оплата не будет работать');
}

// ==================== Вспомогательная функция создания платежа ====================
async function createYooKassaPayment(amount, description, returnUrl) {
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
                return_url: returnUrl
            },
            capture: true,
            description: description
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
    
    return response.data;
}

// ==================== ЭНДПОИНТ 1: Отправка заказа менеджеру ====================
app.post('/api/order', async (req, res) => {
    try {
        const order = req.body;

        // Числа на всякий случай нормализуем
        const finalTotal = Number(order.finalTotal) || 0;
        const prepaid    = Number(order.prepaid) || 0;
        const remaining  = finalTotal - prepaid;

        // Формируем список позиций
        const itemsList = order.items.map(i =>
            `• ${i.name}: ${i.quantity} ${i.unit} = ${i.total} ₽`
        ).join('\n');

        let deliveryText;
        let addressText;

        if (order.delivery.method === 'pickup') {
            deliveryText = '🚶 Самовывоз: Московский пр-кт, 10 (0 ₽)';
            addressText  = '📍 Точка самовывоза: Московский пр-кт, 10';
        } else {
            deliveryText = `🚚 Доставка (зона ${order.delivery.zone}): ${order.deliveryCost} ₽`;
            addressText  = `📍 ${order.delivery.address}`;
        }

        const commentText = order.customer.comment
            ? `\n💬 ${order.customer.comment}`
            : '';

        const clientLine = order.customer.username
            ? `👤 Клиент: @${order.customer.username}`
            : `👤 Клиент (Telegram не указан)`;

        const orderNumber = Date.now().toString().slice(-6);

        // --- Пытаемся сразу создать ссылку на доплату ---
        let remainingPaymentUrl = null;

        if (remaining > 0 && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY) {
            try {
                const secondPayment = await createYooKassaPayment(
                    remaining,
                    `Доплата за заказ Bakary №${orderNumber}`,
                    'https://t.me/bakary36_bot/bakary'
                );
                
                if (secondPayment?.confirmation?.confirmation_url) {
                    remainingPaymentUrl = secondPayment.confirmation.confirmation_url;
                }
            } catch (e) {
                console.error('Не удалось создать ссылку на доплату:', e.response?.data || e.message);
            }
        }

        const remainingLine = remaining > 0
            ? `💰 *Остаток к доплате:* ${remaining} ₽`
            : '💰 *Остаток к доплате:* 0 ₽';

        const remainingLinkLine = remainingPaymentUrl
            ? `\n🔗 Ссылка для доплаты: ${remainingPaymentUrl}`
            : '';

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

👤 Менеджер: ${MANAGER_USERNAME} (${MANAGER_PHONE})
        `.trim();

        const replyMarkup = order.customer.username
            ? {
                inline_keyboard: [
                    [
                        {
                            text: '📞 Написать клиенту',
                            url: `https://t.me/${order.customer.username.replace(/^@/, '')}`
                        }
                    ]
                ]
              }
            : undefined;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup
        });

        res.status(200).json({ success: true, message: 'Заказ отправлен менеджеру' });
    } catch (error) {
        console.error('Ошибка обработки заказа:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// ==================== ЭНДПОИНТ 2: Создание платежа (первая оплата) ====================
app.post('/api/create-payment', async (req, res) => {
    try {
        if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
            return res.status(500).json({ success: false, error: 'YooKassa credentials not configured' });
        }

        const { amount, description, returnUrl } = req.body;

        const payment = await createYooKassaPayment(amount, description, returnUrl);

        res.status(200).json({
            success: true,
            paymentId: payment.id,
            status: payment.status,
            confirmationUrl: payment.confirmation?.confirmation_url || null
        });
    } catch (error) {
        console.error('Ошибка создания платежа:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Ошибка при создании платежа' });
    }
});

// ==================== ЭНДПОИНТ 3: Создание доплаты (вторая ссылка) ====================
app.post('/api/create-second-payment', async (req, res) => {
    try {
        if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
            return res.status(500).json({ success: false, error: 'YooKassa credentials not configured' });
        }

        const { remainingAmount, description, returnUrl } = req.body;

        const payment = await createYooKassaPayment(remainingAmount, description, returnUrl);

        res.status(200).json({
            success: true,
            paymentId: payment.id,
            status: payment.status,
            confirmationUrl: payment.confirmation?.confirmation_url || null
        });
    } catch (error) {
        console.error('Ошибка создания доплаты:', error.response?.data || error.message);
        res.status(500).json({ success: false, error: 'Ошибка при создании доплаты' });
    }
});

// ==================== ЭНДПОИНТ 4: Проверка здоровья ====================
app.get('/health', (req, res) => {
    res.json({ status: 'OK', time: new Date().toISOString() });
});

// ==================== Запуск сервера ====================
app.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});

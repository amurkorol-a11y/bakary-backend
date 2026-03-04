const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Переменные окружения (безопасно!)
const { BOT_TOKEN, CHAT_ID, MANAGER_USERNAME, MANAGER_PHONE } = process.env;

if (!BOT_TOKEN || !CHAT_ID) {
    console.error('Ошибка: Не заданы BOT_TOKEN или CHAT_ID в переменных окружения');
    process.exit(1);
}

// Эндпоинт для приёма заказов
app.post('/api/order', async (req, res) => {
    try {
        const order = req.body;
        
        // Формируем красивое сообщение для Telegram
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

        // Отправляем в Telegram
        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        await axios.post(telegramUrl, {
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

// Здоровье сервера
app.get('/health', (req, res) => {
    res.json({ status: 'OK', time: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 Бэкенд запущен на порту ${PORT}`);
});
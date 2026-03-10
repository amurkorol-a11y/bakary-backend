const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Токен берётся из переменных окружения Vercel — в коде его НЕТ
const TELEGRAM_TOKEN = process.env.CLIENT_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
// URL витрины — тоже из переменных (чтобы можно было менять без правки кода)
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://amurkorol-a11y.github.io/cake-shop/';

// Проверка, что токен задан (чтобы бот не падал молча)
if (!TELEGRAM_TOKEN) {
    console.error('❌ Ошибка: CLIENT_BOT_TOKEN не задан в переменных окружения');
    process.exit(1);
}

// Вебхук для Telegram
app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;

    try {
        if (update?.message) {
            const chatId = update.message.chat.id;
            const text = update.message.text;

            // На /start отправляем кнопку с Mini App
            if (text === '/start') {
                await axios.post(`${API_URL}/sendMessage`, {
                    chat_id: chatId,
                    text: '🍰 Добро пожаловать в Bakary!\nНажмите кнопку, чтобы открыть каталог десертов:',
                    reply_markup: {
                        keyboard: [[
                            {
                                text: '🍰 Перейти в каталог',
                                web_app: { url: WEBAPP_URL }
                            }
                        ]],
                        resize_keyboard: true,
                        one_time_keyboard: false
                    }
                });
            }
        }
        res.sendStatus(200);
    } catch (e) {
        console.error('❌ Telegram webhook error:', e.response?.data || e.message);
        res.sendStatus(500);
    }
});

// Для локального теста (Vercel сам подставит порт)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`✅ Client bot listening on port ${PORT}`);
});

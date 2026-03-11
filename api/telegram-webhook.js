const axios = require('axios');

const TELEGRAM_TOKEN = process.env.CLIENT_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://amurkorol-a11y.github.io/cake-shop/';

if (!TELEGRAM_TOKEN) {
  console.error('❌ Ошибка: CLIENT_BOT_TOKEN не задан в переменных окружения');
}

module.exports = async (req, res) => {
  console.log('➡️ Incoming update:', JSON.stringify(req.body)); // логим всё, что пришло

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const update = req.body;

  try {
    if (update?.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === '/start') {
        await axios.post(`${API_URL}/sendMessage`, {
          chat_id: chatId,
          text: '🍰 Добро пожаловать в Bakary!\nНажмите кнопку, чтобы открыть каталог десертов:',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '🍰 Перейти в каталог',
                web_app: { url: WEBAPP_URL }
              }
            ]]
          }
        });
      }
    }

    res.status(200).end();
  } catch (e) {
    console.error('❌ Telegram webhook error:', e.response?.data || e.message);
    res.status(500).end();
  }
};

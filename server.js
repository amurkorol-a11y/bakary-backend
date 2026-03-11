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

    // Строка о клиенте без id
    const clientLine = order.customer.username
      ? `👤 Клиент: @${order.customer.username}`
      : `👤 Клиент (Telegram не указан)`;

    const orderNumber = Date.now().toString().slice(-6);

    const message = `
🍰 *НОВЫЙ ЗАКАЗ #${orderNumber}*

${itemsList}

*Итого за товары:* ${order.cartTotal} ₽
${deliveryText}
*К оплате всего:* ${finalTotal} ₽

💳 *Предоплата (50%):* ${prepaid} ₽
💰 *Остаток к доплате:* ${remaining} ₽

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
                text: 'Написать клиенту в Telegram',
                url: `https://t.me/${order.customer.username}`
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

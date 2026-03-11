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

    // --- Пытаемся сразу создать ссылку на доплату через наш эндпоинт create-second-payment ---
    let remainingPaymentUrl = null;

    if (remaining > 0 && YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY) {
      try {
        const secondPaymentResp = await axios.post(
          `${req.protocol}://${req.get('host')}/api/create-second-payment`,
          {
            remainingAmount: remaining,
            description: `Доплата за заказ Bakary №${orderNumber}`,
            returnUrl: 'https://t.me/bakary36_bot'
          }
        );

        if (secondPaymentResp.data?.success && secondPaymentResp.data?.confirmationUrl) {
          remainingPaymentUrl = secondPaymentResp.data.confirmationUrl;
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

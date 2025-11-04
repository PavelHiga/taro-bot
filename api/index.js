// Получаем токен из переменных окружения
const TOKEN = process.env.TOKEN;

if (!TOKEN) {
  throw new Error("Bot token is not set in environment variables!");
}

/**
 * Парсим сообщение от Telegram API
 */
function parseMessage(message) {
  console.log("message -->", message);

  if (!message.message || !message.message.text) {
    return [null, null]; // Если нет текста, пропускаем
  }

  const chatId = message.message.chat.id;
  const txt = message.message.text;

  console.log("chat_id -->", chatId);
  console.log("txt -->", txt);

  return [chatId, txt];
}

/**
 * Отправка сообщения в Telegram
 */
async function telSendMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Підтвредити", callback_data: "confirm" },
          { text: "Скасувати", callback_data: "cancel" }
        ]
      ]
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log("Ошибка отправки сообщения:", errorText);
    }

    return response;
  } catch (error) {
    console.error("Ошибка отправки сообщения:", error);
    throw error;
  }
}

/**
 * Удаление сообщения с кнопками
 */
async function deleteMessage(chatId, messageId) {
  const url = `https://api.telegram.org/bot${TOKEN}/deleteMessage?chat_id=${chatId}&message_id=${messageId}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
    });

    const responseText = await response.text();
    console.log(`Удаление сообщения ${messageId}: ${response.status}, ${responseText}`);
    
    if (!response.ok) {
      console.log("Ошибка удаления сообщения:", responseText);
    }

    return response;
  } catch (error) {
    console.error("Ошибка удаления сообщения:", error);
    throw error;
  }
}

/**
 * Обработка вебхука от Telegram
 */
async function handleWebhook(req, res) {
  const msg = req.body;
  console.log("Получен вебхук:", msg);

  // Обработка callback_query (нажатие кнопки)
  if (msg.callback_query) {
    const callback = msg.callback_query;
    const chatId = callback.message.chat.id;
    const messageId = callback.message.message_id;
    console.log(`Нажата кнопка. Удаляю сообщение ${messageId} из чата ${chatId}`);
    
    // Удаляем сообщение
    await deleteMessage(chatId, messageId);

    return res.status(200).json({ status: "deleted" });
  }

  // Обработка обычного сообщения
  const [chatId, txt] = parseMessage(msg);
  if (chatId === null || txt === null) {
    return res.status(200).json({ status: "ignored" });
  }

  if (txt.toLowerCase() === "hi") {
    await telSendMessage(chatId, "Кнопка!!");
  } else {
    await telSendMessage(chatId, "Авторизація");
  }

  return res.status(200).send('ok');
}

/**
 * Установка webhook
 */
async function handleSetWebhook(req, res) {
  const vercelUrl = process.env.VERCEL_URL;
  
  if (!vercelUrl) {
    return res.status(400).send("Vercel URL not found");
  }

  const webhookUrl = `https://api.telegram.org/bot${TOKEN}/setWebhook?url=https://${vercelUrl}/webhook&allowed_updates=%5B%22message%22,%22callback_query%22%5D`;
  
  try {
    const response = await fetch(webhookUrl);
    const responseText = await response.text();

    if (response.ok) {
      return res.status(200).send("Webhook successfully set");
    } else {
      return res.status(response.status).send(`Error setting webhook: ${responseText}`);
    }
  } catch (error) {
    console.error("Ошибка установки webhook:", error);
    return res.status(500).send(`Error setting webhook: ${error.message}`);
  }
}

/**
 * Главный обработчик запросов
 */
export default async function handler(req, res) {
  const { method, url } = req;

  // Определяем маршрут из URL
  const path = url.split('?')[0]; // Убираем query параметры

  try {
    // Маршрут /setwebhook
    if (path === '/setwebhook' && (method === 'POST' || method === 'GET')) {
      return await handleSetWebhook(req, res);
    }

    // Маршрут /webhook
    if (path === '/webhook' && method === 'POST') {
      return await handleWebhook(req, res);
    }

    // Маршрут / (главная страница)
    if (path === '/' && method === 'GET') {
      return res.status(200).send('<h1>Telegram Bot Webhook is Running</h1>');
    }

    // 404 для неизвестных маршрутов
    return res.status(404).send('Not Found');
  } catch (error) {
    console.error("Ошибка обработки запроса:", error);
    return res.status(500).send(`Internal Server Error: ${error.message}`);
  }
}
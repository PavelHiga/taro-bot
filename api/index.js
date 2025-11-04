// Импортируем сервисы Таро
import { taroService } from './taro.service.js';
import { mockTaroService } from './mock-taro.service.js';

// Получаем токен из переменных окружения
const TOKEN = process.env.TOKEN || process.env.BOT_TOKEN;

if (!TOKEN) {
  throw new Error("Bot token is not set in environment variables!");
}

// Выбираем сервис в зависимости от наличия OPENAI_API_KEY
const getTaroService = () => {
  if (process.env.OPENAI_API_KEY) {
    console.log('Using real Taro service with OpenAI');
    return taroService;
  } else {
    console.log('Using mock Taro service');
    return mockTaroService;
  }
};

const tarotService = getTaroService();

// Хранилище для ожидающих оплаты гаданий (в продакшене лучше использовать БД)
const pendingReadings = new Map();

/**
 * Создание invoice link для Telegram Mini App
 */
async function createInvoiceLink(userId, message, cards) {
  try {
    if (!TOKEN) {
      throw new Error('Bot token is not configured');
    }
    
    console.log('Creating invoice link for userId:', userId, 'message:', message?.substring(0, 50));
    
    // Формируем минимальный payload (максимум 128 байт для Telegram)
    const timestamp = Date.now();
    const payload = JSON.stringify({
      u: userId,
      t: timestamp
    });

    if (payload.length > 128) {
      console.error('❌ Payload too long:', payload.length, 'bytes (max 128)');
      throw new Error('Payload exceeds Telegram limit of 128 bytes');
    }

    // Сохраняем данные для после оплаты
    pendingReadings.set(userId, {
      userId: userId,
      message: message,
      cards: cards,
      timestamp: timestamp
    });

    const invoiceParams = {
      title: 'Расклад Таро',
      description: 'Персональный расклад из 3 карт Таро с подробным толкованием от AI',
      payload: payload,
      provider_token: '', // Пустая строка для Telegram Stars
      currency: 'XTR', // Telegram Stars
      prices: [{ label: 'Расклад Таро', amount: 1 }], // 1 звезда
    };

    const url = `https://api.telegram.org/bot${TOKEN}/createInvoiceLink`;
    console.log('Calling Telegram API to create invoice link...');
    
    // Добавляем таймаут для запроса
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(invoiceParams),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Telegram API error:', response.status, errorText);
        throw new Error(`Telegram API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.ok) {
        console.error('❌ Telegram API returned error:', data);
        throw new Error(data.description || 'Failed to create invoice link');
      }
      
      console.log(`✅ Invoice link created for user ${userId}:`, data.result);
      
      return data.result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout: Telegram API did not respond in time');
      }
      throw error;
    }
  } catch (error) {
    console.error('❌ Error creating invoice link:', error);
    throw error;
  }
}

/**
 * Выполнение гадания
 */
async function performReading(chatId, message, cards) {
  try {
    // Выполняем запрос к сервису Таро
    const reading = await tarotService.getTarotReading(message, cards);
    
    if (reading.success && reading.data) {
      // Формируем красивый ответ
      let response = '🔮 *Ваш расклад Таро*\n\n';
      response += `📝 Вопрос: _${message}_\n\n`;
      
      // Добавляем карты
      if (reading.data.cards && reading.data.cards.length > 0) {
        response += '🃏 *Выпавшие карты:*\n';
        reading.data.cards.forEach((card, index) => {
          const positions = ['Прошлое', 'Настоящее', 'Будущее'];
          response += `${index + 1}. ${positions[index]}: ${card.name_ru || card.name_en}\n`;
        });
        response += '\n';
      }
      
      // Добавляем толкование
      if (reading.data.summary && reading.data.summary.length > 0) {
        response += '📖 *Толкование:*\n\n';
        reading.data.summary.forEach((item) => {
          const key = Object.keys(item)[0];
          const value = item[key];
          response += `${value}\n\n`;
        });
      }
      
      // Отправляем результат через Telegram API
      const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: response,
          parse_mode: 'Markdown'
        }),
      });
      
    } else {
      throw new Error('Invalid reading response');
    }
    
  } catch (error) {
    console.error('Error performing reading:', error);
    // Отправляем сообщение об ошибке через Telegram API
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: '❌ Произошла ошибка при выполнении гадания.\nПожалуйста, свяжитесь с поддержкой для возврата средств.',
        parse_mode: 'Markdown'
      }),
    });
  }
}

/**
 * Получение случайных карт
 */
function getRandomCards() {
  const allCards = [
    { name_ru: "Дурак", name_en: "The Fool", image: "m00.jpg" },
    { name_ru: "Маг", name_en: "The Magician", image: "m01.jpg" },
    { name_ru: "Верховная Жрица", name_en: "The High Priestess", image: "m02.jpg" },
    { name_ru: "Императрица", name_en: "The Empress", image: "m03.jpg" },
    { name_ru: "Император", name_en: "The Emperor", image: "m04.jpg" },
    { name_ru: "Иерофант", name_en: "The Hierophant", image: "m05.jpg" },
    { name_ru: "Влюбленные", name_en: "The Lovers", image: "m06.jpg" },
    { name_ru: "Колесница", name_en: "The Chariot", image: "m07.jpg" },
    { name_ru: "Сила", name_en: "Strength", image: "m08.jpg" },
    { name_ru: "Отшельник", name_en: "The Hermit", image: "m09.jpg" },
    { name_ru: "Колесо Фортуны", name_en: "Wheel of Fortune", image: "m10.jpg" },
    { name_ru: "Справедливость", name_en: "Justice", image: "m11.jpg" },
    { name_ru: "Повешенный", name_en: "The Hanged Man", image: "m12.jpg" },
    { name_ru: "Смерть", name_en: "Death", image: "m13.jpg" },
    { name_ru: "Умеренность", name_en: "Temperance", image: "m14.jpg" },
    { name_ru: "Дьявол", name_en: "The Devil", image: "m15.jpg" },
    { name_ru: "Башня", name_en: "The Tower", image: "m16.jpg" },
    { name_ru: "Звезда", name_en: "The Star", image: "m17.jpg" },
    { name_ru: "Луна", name_en: "The Moon", image: "m18.jpg" },
    { name_ru: "Солнце", name_en: "The Sun", image: "m19.jpg" },
    { name_ru: "Суд", name_en: "Judgement", image: "m20.jpg" },
    { name_ru: "Мир", name_en: "The World", image: "m21.jpg" }
  ];

  // Перемешиваем и берем 3 карты
  const shuffled = [...allCards].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3);
}

/**
 * Обработка pre-checkout query
 */
async function answerPreCheckoutQuery(preCheckoutQueryId, ok = true, errorMessage = '') {
  const url = `https://api.telegram.org/bot${TOKEN}/answerPreCheckoutQuery`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pre_checkout_query_id: preCheckoutQueryId,
        ok: ok,
        error_message: errorMessage
      }),
    });

    return response;
  } catch (error) {
    console.error("Ошибка ответа на pre-checkout query:", error);
    throw error;
  }
}

/**
 * Обработка вебхука от Telegram
 */
async function handleWebhook(req, res) {
  const msg = req.body;
  console.log("Получен вебхук:", JSON.stringify(msg, null, 2));

  try {
    // Обработка pre-checkout query
    if (msg.pre_checkout_query) {
      const preCheckoutQuery = msg.pre_checkout_query;
      console.log('Pre-checkout query received:', preCheckoutQuery);
      
      await answerPreCheckoutQuery(preCheckoutQuery.id, true);
      return res.status(200).json({ ok: true });
    }

    // Обработка успешной оплаты
    if (msg.message && msg.message.successful_payment) {
      const payment = msg.message.successful_payment;
      const chatId = msg.message.chat.id;
      const userId = msg.message.from.id;
      
      console.log('Successful payment received:', payment);
      
      // Отправляем сообщение об успешной оплате
      const sendMessageUrl = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
      await fetch(sendMessageUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: '✅ Оплата прошла успешно! Начинаю гадание...',
          parse_mode: 'Markdown'
        }),
      });
      
      // Получаем данные из payload
      let message, cards;
      try {
        const payloadData = JSON.parse(payment.invoice_payload);
        // Если payload содержит только u и t, получаем данные из pendingReadings
        if (payloadData.u && payloadData.t) {
          const pendingData = pendingReadings.get(payloadData.u);
          if (pendingData) {
            message = pendingData.message;
            cards = pendingData.cards;
          } else {
            throw new Error('Pending reading not found');
          }
        } else {
          message = payloadData.message;
          cards = payloadData.cards;
        }
      } catch (error) {
        console.error('Error parsing payload:', error);
        // Пытаемся получить из pendingReadings по userId
        const pendingData = pendingReadings.get(userId);
        if (pendingData) {
          message = pendingData.message;
          cards = pendingData.cards;
        } else {
          throw new Error('Could not retrieve payment data');
        }
      }
      
      // Выполняем гадание
      await performReading(chatId, message, cards);
      
      // Удаляем из ожидания
      pendingReadings.delete(userId);
      pendingReadings.delete(chatId);
      
      return res.status(200).json({ ok: true });
    }

    // Обработка обычного сообщения
    if (msg.message && msg.message.text) {
      const chatId = msg.message.chat.id;
      const txt = msg.message.text;
      
      // Обработка команды /start
      if (txt.toLowerCase() === "/start" || txt.toLowerCase().startsWith("/start ")) {
        const welcomeMessage = 
          '🔮 *Привет! Я помогу тебе с раскладом Таро!*\n\n' +
          '✨ Я создам персональный прогноз на любой твой вопрос.\n\n' +
          '📝 *Как это работает:*\n' +
          '1. Открой приложение Taro AI\n' +
          '2. Задай свой вопрос\n' +
          '3. Выбери 3 карты\n' +
          '4. Получи подробное толкование от AI\n\n' +
          '💡 *Пример вопроса:*\n' +
          '_"Буду ли я встречаться с Никитой?"_\n\n' +
          '🃏 *Пример расклада:*\n' +
          '_"Влюбленные, Справедливость, 6 мечей"_\n\n' +
          '📱 *Как открыть приложение:*\n' +
          'Выбери в левом нижнем углу *"Открыть Taro AI"*\n\n' +
          '_P.S. Если что-то не работает, попробуй написать /start заново_';
        
        const sendMessageUrl = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
        await fetch(sendMessageUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: welcomeMessage,
            parse_mode: 'Markdown'
          }),
        });
        
        return res.status(200).json({ ok: true });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Ошибка обработки вебхука:", error);
    return res.status(200).json({ ok: true }); // Всегда возвращаем 200 для Telegram
  }
}

/**
 * Установка webhook
 */
async function handleSetWebhook(req, res) {
  const vercelUrl = process.env.VERCEL_URL;
  
  if (!vercelUrl) {
    return res.status(400).send("Vercel URL not found");
  }

  const webhookUrl = `https://api.telegram.org/bot${TOKEN}/setWebhook?url=https://${vercelUrl}/webhook&allowed_updates=%5B%22message%22,%22callback_query%22,%22pre_checkout_query%22%5D`;
  
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

    // Маршрут /createInvoiceLink - для Telegram Mini App
    if (path === '/createInvoiceLink') {
      // Устанавливаем CORS заголовки для запросов из браузера
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      // Обработка preflight запросов
      if (method === 'OPTIONS') {
        return res.status(200).end();
      }
      
      if (method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
      }
      
      console.log('POST /createInvoiceLink received');
      console.log('Request headers:', JSON.stringify(req.headers, null, 2));
      
      try {
        // В Vercel serverless functions body обычно уже распарсено автоматически
        let body = req.body;
        
        console.log('Raw body type:', typeof body);
        console.log('Raw body:', body);
        
        // Если body это строка, парсим её
        if (typeof body === 'string') {
          try {
            body = JSON.parse(body);
            console.log('Parsed body from string:', body);
          } catch (parseError) {
            console.error('Error parsing JSON body:', parseError);
            return res.status(400).json({ error: 'Invalid JSON in request body' });
          }
        }
        
        // Если body не определен или пустой
        if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
          console.error('Body is empty or undefined');
          return res.status(400).json({ 
            error: 'Empty request body. Please send JSON with userId, message, and cards fields.',
            hint: 'Make sure to send Content-Type: application/json header'
          });
        }
        
        const { userId, message, cards } = body;
        
        console.log('Extracted fields:', { 
          userId, 
          message: message?.substring(0, 50), 
          cardsCount: cards?.length,
          cardsType: Array.isArray(cards) ? 'array' : typeof cards
        });
        
        // Валидация
        if (!userId) {
          return res.status(400).json({ error: 'Missing required field: userId' });
        }
        if (!message) {
          return res.status(400).json({ error: 'Missing required field: message' });
        }
        if (!cards) {
          return res.status(400).json({ error: 'Missing required field: cards' });
        }
        if (!Array.isArray(cards)) {
          return res.status(400).json({ error: 'Field cards must be an array' });
        }
        if (cards.length === 0) {
          return res.status(400).json({ error: 'Field cards must contain at least 1 card' });
        }

        console.log('All validations passed, creating invoice link...');
        const invoiceLink = await createInvoiceLink(userId, message, cards);
        console.log('Invoice link created successfully:', invoiceLink);
        
        return res.status(200).json({ invoiceLink });
      } catch (error) {
        console.error('Error creating invoice link:', error);
        console.error('Error stack:', error.stack);
        return res.status(500).json({ 
          error: error.message || 'Internal server error',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    }

    // Маршрут /reading-paid - для получения результата гадания после оплаты
    if (path === '/reading-paid') {
      // Устанавливаем CORS заголовки
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      // Обработка preflight запросов
      if (method === 'OPTIONS') {
        return res.status(200).end();
      }
      
      console.log(`${method} /reading-paid received`);
      
      try {
        let userId;
        
        if (method === 'GET') {
          // Получаем userId из query параметров
          const urlObj = new URL(url, `http://${req.headers.host}`);
          userId = urlObj.searchParams.get('userId');
        } else if (method === 'POST') {
          // Получаем userId из body
          let body = req.body;
          
          if (typeof body === 'string') {
            try {
              body = JSON.parse(body);
            } catch (parseError) {
              return res.status(400).json({ error: 'Invalid JSON in request body' });
            }
          }
          
          userId = body?.userId;
        } else {
          return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
        }
        
        if (!userId) {
          return res.status(400).json({ error: 'Missing required field: userId' });
        }
        
        // Преобразуем userId в число если это строка
        const userIdNum = typeof userId === 'string' ? parseInt(userId, 10) : userId;
        
        if (isNaN(userIdNum)) {
          return res.status(400).json({ error: 'Invalid userId format. Must be a number.' });
        }
        
        console.log('Processing reading for userId:', userIdNum);
        
        // Проверяем, есть ли данные в pendingReadings
        const pendingData = pendingReadings.get(userIdNum);
        
        if (!pendingData) {
          return res.status(404).json({ 
            error: 'Reading not found or already processed',
            message: 'No pending reading found for this userId. The reading may have been already processed or payment was not completed.'
          });
        }
        
        // Выполняем гадание через getTarotReading
        console.log('Executing reading via getTarotReading for question:', pendingData.message);
        const reading = await tarotService.getTarotReading(pendingData.message, pendingData.cards);
        
        if (!reading.success || !reading.data) {
          throw new Error('Failed to get reading result from AI');
        }
        
        // Удаляем из pendingReadings после получения результата
        pendingReadings.delete(userIdNum);
        
        console.log('Reading completed successfully for userId:', userIdNum);
        
        // Возвращаем результат гадания
        return res.status(200).json({
          success: true,
          userId: userIdNum,
          question: pendingData.message,
          cards: reading.data.cards,
          summary: reading.data.summary,
          originalMessage: reading.originalMessage,
          cardsData: reading.cards
        });
        
      } catch (error) {
        console.error('Error in /reading-paid:', error);
        return res.status(500).json({ 
          error: error.message || 'Internal server error'
        });
      }
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
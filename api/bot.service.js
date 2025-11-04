import { Telegraf, Markup } from 'telegraf';
import { taroService } from './taro.service.js';

class BotService {
    constructor() {
        this.bot = null;
        this.pendingReadings = new Map(); // Хранилище для ожидающих оплаты гаданий
    }

    async initialize() {
        try {
            const token = process.env.BOT_TOKEN;
            
            if (!token) {
                throw new Error('BOT_TOKEN is not defined in environment variables');
            }

            this.bot = new Telegraf(token);
            
            // Remove webhook if it was set previously
            await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
            
            // Set up bot commands
            this.setupCommands();
            
            // Set up payment handlers
            this.setupPaymentHandlers();
            
            // Launch bot
            await this.bot.launch();
            
            // Get bot info
            const me = await this.bot.telegram.getMe();
            console.log(`✅ Bot launched as @${me.username}`);
            
        } catch (error) {
            console.error('❌ Bot initialization failed:', error);
            throw error;
        }
    }

    setupCommands() {
        // Команда /start
        this.bot.start((ctx) => {
            ctx.reply(
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
                '_P.S. Если что-то не работает, попробуй написать /start заново_',
                { parse_mode: 'Markdown' }
            );
        });
    }

    setupPaymentHandlers() {
        // Обработка pre-checkout запроса
        this.bot.on('pre_checkout_query', async (ctx) => {
            try {
                console.log('Pre-checkout query received:', ctx.preCheckoutQuery);
                await ctx.answerPreCheckoutQuery(true);
            } catch (error) {
                console.error('Error in pre_checkout_query:', error);
                await ctx.answerPreCheckoutQuery(false, 'Произошла ошибка. Попробуйте позже.');
            }
        });

        // Обработка успешной оплаты
        this.bot.on('successful_payment', async (ctx) => {
            try {
                const payment = ctx.message.successful_payment;
                const userId = ctx.from.id;
                
                console.log('Successful payment received:', payment);
                
                await ctx.reply('✅ Оплата прошла успешно! Начинаю гадание...');
                
                // Получаем данные из payload
                const payloadData = JSON.parse(payment.invoice_payload);
                const { message, cards } = payloadData;
                
                // Выполняем запрос к ChatGPT
                await this.performReading(ctx, message, cards);
                
            } catch (error) {
                console.error('Error processing successful payment:', error);
                await ctx.reply('❌ Произошла ошибка при обработке платежа. Пожалуйста, свяжитесь с поддержкой.');
            }
        });
    }

    async sendInvoice(ctx, message, cards) {
        try {
            const userId = ctx.from.id;
            
            // Формируем payload с данными для гадания
            const payload = JSON.stringify({
                userId,
                message,
                cards,
                timestamp: Date.now()
            });

            // Отправляем invoice
            await ctx.replyWithInvoice({
                title: '🔮 Расклад Таро',
                description: 'Персональный расклад из 3 карт Таро с подробным толкованием от AI',
                payload: payload,
                provider_token: '', // Пустая строка для Telegram Stars
                currency: 'XTR', // Telegram Stars
                prices: [{ label: 'Расклад Таро', amount: 50 }], // 50 звезд
            });
            
            console.log(`Invoice sent to user ${userId}`);
            
        } catch (error) {
            console.error('Error sending invoice:', error);
            await ctx.reply('❌ Не удалось создать счет для оплаты. Попробуйте позже.');
        }
    }

    async performReading(ctx, message, cards) {
        try {
            // Показываем индикатор "печатает..."
            await ctx.sendChatAction('typing');
            
            // Выполняем запрос к ChatGPT через taroService
            const reading = await taroService.getTarotReading(message, cards);
            
            if (reading.success && reading.data) {
                // Формируем красивый ответ
                let response = '🔮 *Ваш расклад Таро*\n\n';
                response += `📝 Вопрос: _${message}_\n\n`;
                
                // Добавляем карты
                if (reading.data.cards && reading.data.cards.length > 0) {
                    response += '🃏 *Выпавшие карты:*\n';
                    reading.data.cards.forEach((card, index) => {
                        const positions = ['Прошлое', 'Настоящее', 'Будущее'];
                        response += `${index + 1}. ${positions[index]}: ${card.name_ru}\n`;
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
                
                await ctx.reply(response, { parse_mode: 'Markdown' });
                
            } else {
                throw new Error('Invalid reading response');
            }
            
        } catch (error) {
            console.error('Error performing reading:', error);
            await ctx.reply(
                '❌ Произошла ошибка при выполнении гадания.\n' +
                'Пожалуйста, свяжитесь с поддержкой для возврата средств.'
            );
        }
    }

    // Метод для создания invoice link для Telegram Mini App
    async createInvoiceLink(userId, message, cards) {
        try {
            if (!this.bot) {
                console.error('❌ Bot is not initialized');
                throw new Error('Telegram bot is not initialized');
            }

            console.log('📝 Creating invoice for user:', userId);

            // Формируем минимальный payload (максимум 128 байт для Telegram)
            // Данные будут переданы клиентом после оплаты
            const timestamp = Date.now();
            const payload = JSON.stringify({
                u: userId,
                t: timestamp
            });

            console.log('📝 Payload:', payload);
            console.log('📝 Payload length:', payload.length, 'bytes');
            
            if (payload.length > 128) {
                console.error('❌ Payload too long:', payload.length, 'bytes (max 128)');
                throw new Error('Payload exceeds Telegram limit of 128 bytes');
            }

            const invoiceParams = {
                title: 'Расклад Таро',
                description: 'Персональный расклад из 3 карт Таро с подробным толкованием от AI',
                payload: payload,
                provider_token: '', // Пустая строка для Telegram Stars
                currency: 'XTR', // Telegram Stars
                prices: [{ label: 'Расклад Таро', amount: 1 }], // 50 звезд
            };

            console.log('📝 Invoice params:', JSON.stringify(invoiceParams, null, 2));

            const invoiceLink = await this.bot.telegram.createInvoiceLink(invoiceParams);
            console.log(`✅ Invoice link created for user ${userId}:`, invoiceLink);
            
            return invoiceLink;
        } catch (error) {
            console.error('❌ Error creating invoice link:', error);
            if (error.response) {
                console.error('❌ Telegram API response:', error.response);
            }
            throw error;
        }
    }

    // Метод для получения случайных карт
    getRandomCards() {
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

    // Обработка текстовых сообщений (для получения вопроса)
    handleTextMessage(ctx) {
        const userId = ctx.from.id;
        const pendingReading = this.pendingReadings.get(userId);
        
        if (pendingReading && pendingReading.step === 'awaiting_question') {
            const message = ctx.message.text;
            
            // Генерируем случайные карты
            const cards = this.getRandomCards();
            
            // Удаляем из ожидания
            this.pendingReadings.delete(userId);
            
            // Отправляем invoice
            this.sendInvoice(ctx, message, cards);
        }
    }

    stop() {
        if (this.bot) {
            this.bot.stop('SIGINT');
            console.log('🛑 Bot stopped');
        }
    }
}

export const botService = new BotService();
export default BotService;

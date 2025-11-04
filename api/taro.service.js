// Используем встроенный fetch вместо axios

class TaroService {
    constructor() {
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        this.baseUrl = 'https://api.openai.com/v1/chat/completions';
        
        if (!this.openaiApiKey) {
            console.warn('⚠️ OPENAI_API_KEY is not defined in environment variables');
        }
    }

    async getTarotReading(message, cards) {
        try {
            if (!this.openaiApiKey) {
                throw new Error('OpenAI API key is not configured');
            }

            // Формируем промпт для ChatGPT
            const systemPrompt = `Ты — опытный таролог. Отвечай строго в JSON-формате.

Проанализируй расклад из трёх выпавших карт и дай подробное толкование в следующем формате:

1. Начни с общего вступления (1-2 предложения), которое суммирует основной посыл расклада
2. Затем опиши каждую карту отдельно:
   - Начинай с фразы: Карта "Название карты" говорит о...
   - Дай толкование этой карты в контексте вопроса (2-3 предложения)
3. Между описаниями карт используй связующие слова: "Однако", "Тем не менее", "При этом", "Вместе с тем"
4. Заверши общим выводом (1-2 предложения), который объединяет все карты

ВАЖНО: Названия карт всегда заключай в кавычки "Название".

Формат JSON ответа:
{
  "cards": [
    { "position": "past", "name_ru": "", "name_en": "" },
    { "position": "present", "name_ru": "", "name_en": "" },
    { "position": "future", "name_ru": "", "name_en": "" }
  ],
  "summary": [
    { "Вступление": "Общий посыл расклада..." },
    { "Карта 1": "Карта \"Название\" говорит о..." },
    { "Карта 2": "Однако, \"Название\" призывает..." },
    { "Карта 3": "\"Название\" предвещает..." },
    { "Заключение": "В целом, вас ждет..." }
  ]
}

⚠️ Пиши развернуто и содержательно. Каждое описание карты должно быть 2-3 предложения. Используй обращение на "вы". Вне JSON не пиши ничего. Только строго валидный JSON.`;

            const userPrompt = `Вопрос пользователя: "${message}"

Выпавшие карты:
${cards.map((card, index) => `${index + 1}. ${card.name_ru || card.name_en || card}`).join('\n')}

Проанализируй эти карты в контексте вопроса пользователя и дай подробную расшифровку.`;

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.openaiApiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [
                        {
                            role: 'system',
                            content: systemPrompt
                        },
                        {
                            role: 'user',
                            content: userPrompt
                        }
                    ],
                    max_tokens: 2000,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
                throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
            }

            const responseData = await response.json();
            const aiResponse = responseData.choices[0].message.content;
            
            // Пытаемся распарсить JSON ответ
            try {
                const parsedResponse = JSON.parse(aiResponse);
                
                // Добавляем поле image к картам из входящих данных
                if (parsedResponse.cards && Array.isArray(parsedResponse.cards)) {
                    parsedResponse.cards.forEach((card, index) => {
                        if (cards[index] && cards[index].image) {
                            card.image = cards[index].image;
                        }
                    });
                }
                
                return {
                    success: true,
                    data: parsedResponse,
                    originalMessage: message,
                    cards: cards
                };
            } catch (parseError) {
                console.error('Failed to parse AI response as JSON:', parseError);
                console.error('Raw AI response:', aiResponse);
                
                // Если не удалось распарсить JSON, возвращаем текстовый ответ
                return {
                    success: false,
                    error: 'AI response was not in valid JSON format',
                    rawResponse: aiResponse,
                    originalMessage: message,
                    cards: cards
                };
            }

        } catch (error) {
            console.error('Error in getTarotReading:', error);
            throw error;
        }
    }

    // Метод для получения случайных карт (может пригодиться для фронтенда)
    getRandomCards() {
        const allCards = [
            { name_ru: "Дурак", name_en: "The Fool" },
            { name_ru: "Маг", name_en: "The Magician" },
            { name_ru: "Верховная Жрица", name_en: "The High Priestess" },
            { name_ru: "Императрица", name_en: "The Empress" },
            { name_ru: "Император", name_en: "The Emperor" },
            { name_ru: "Иерофант", name_en: "The Hierophant" },
            { name_ru: "Влюбленные", name_en: "The Lovers" },
            { name_ru: "Колесница", name_en: "The Chariot" },
            { name_ru: "Сила", name_en: "Strength" },
            { name_ru: "Отшельник", name_en: "The Hermit" },
            { name_ru: "Колесо Фортуны", name_en: "Wheel of Fortune" },
            { name_ru: "Справедливость", name_en: "Justice" },
            { name_ru: "Повешенный", name_en: "The Hanged Man" },
            { name_ru: "Смерть", name_en: "Death" },
            { name_ru: "Умеренность", name_en: "Temperance" },
            { name_ru: "Дьявол", name_en: "The Devil" },
            { name_ru: "Башня", name_en: "The Tower" },
            { name_ru: "Звезда", name_en: "The Star" },
            { name_ru: "Луна", name_en: "The Moon" },
            { name_ru: "Солнце", name_en: "The Sun" },
            { name_ru: "Суд", name_en: "Judgement" },
            { name_ru: "Мир", name_en: "The World" }
        ];

        // Перемешиваем массив и берем первые 3 карты
        const shuffled = [...allCards].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 3);
    }
}

export const taroService = new TaroService();
export default TaroService;

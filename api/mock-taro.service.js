class MockTaroService {
    async getTarotReading(message, cards) {
        // Имитация задержки API
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Возвращаем примерный ответ в нужном формате
        const mockCards = [
            { position: "past", name_ru: "Дурак", name_en: "The Fool" },
            { position: "present", name_ru: "Маг", name_en: "The Magician" },
            { position: "future", name_ru: "Верховная Жрица", name_en: "The High Priestess" }
        ];
        
        // Добавляем поле image к картам из входящих данных
        mockCards.forEach((card, index) => {
            if (cards[index] && cards[index].image) {
                card.image = cards[index].image;
            }
        });
        
        return {
            success: true,
            data: {
                cards: mockCards,
                summary: [
                    { "Прошлое": "В прошлом вы были свободны от предрассудков и открыты новым возможностям. Карта Дурак говорит о начале нового пути, полного надежд и энтузиазма." },
                    { "Настоящее": "Сейчас у вас есть все необходимые инструменты и навыки для достижения целей. Маг символизирует волю, концентрацию и способность воплощать идеи в реальность." },
                    { "Будущее": "В будущем вас ждет глубокое понимание скрытых истин. Верховная Жрица призывает довериться интуиции и внутренней мудрости." },
                    { "Совет": "Доверьтесь своему внутреннему голосу и используйте накопленные знания для движения вперед. Новый этап в вашей жизни требует баланса между логикой и интуицией." }
                ]
            },
            originalMessage: message,
            cards: cards
        };
    }
}

export const mockTaroService = new MockTaroService();
export default MockTaroService;

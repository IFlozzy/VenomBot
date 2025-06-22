// src/exchanges/Bybit.js
import fetch from 'node-fetch';

class Bybit {
    constructor() {
        this.apiUrl = 'https://api.bytick.com/v5/market/orderbook';
    }

    async getOrderBook(pair) {
        const params = new URLSearchParams({
            category: 'spot',
            symbol: pair, // Формат: токен+USDT (без роздільників, великими літерами)
            limit: '50'
        });
        try {
            const url = `${this.apiUrl}?${params.toString()}`;
            console.info(`Bybit getOrderBook URL: ${url}`);
                  const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
            const data = await response.json();
            if (data.retCode !== 0) {
                console.error('Помилка отримання ордербуку:', data.retMsg);
                return null;
            }
            return data.result;
        } catch (err) {
            console.error('Bybit getOrderBook error:', err);
            return null;
        }
    }

    // Симуляція покупки токенів за USDT
    async simulateBuy(usdtAmount, pair, commissionRate = 0.0018) {
        const orderbook = await this.getOrderBook(pair);
        if (!orderbook) {
            console.error('simulateBuy: Orderbook is null');
            return null;
        }

        const asks = orderbook.a; // ордери на продаж (сортуються за зростанням ціни)
        let budget = usdtAmount;  // Бюджет для покупки (USDT)
        let tokensBought = 0.0;   // Загальна кількість отриманих токенів (після комісії)

        for (const ask of asks) {
            const price = parseFloat(ask[0]);
            const available = parseFloat(ask[1]);
            const costFull = price * available;

            if (budget <= 0) break;

            if (budget >= costFull) {
                // Купуємо весь рівень
                const tokensPurchased = available;
                const effectiveTokens = tokensPurchased * (1 - commissionRate); // токени після комісії
                tokensBought += effectiveTokens;
                budget -= costFull;
            } else {
                // Купуємо лише ту частину рівня, яку дозволяє бюджет
                const tokensToBuy = budget / price;
                const effectiveTokens = tokensToBuy * (1 - commissionRate);
                tokensBought += effectiveTokens;
                budget = 0;
                break;
            }
        }

        console.log(`Симуляція покупки:
За ${usdtAmount} USDT отримано: ${tokensBought.toFixed(8)} токенів (з урахуванням комісії)
Залишок бюджету: ${budget.toFixed(8)} USDT`);

        return {
            tokensBought,
            usdtSpent: usdtAmount - budget
        };
    }

    // Симуляція продажу токенів за USDT
    async simulateSell(tokensToSell, pair, commissionRate = 0.0018) {
        const orderbook = await this.getOrderBook(pair);
        if (!orderbook) {
            console.error('simulateSell: Orderbook is null');
            return null;
        }

        const bids = orderbook.b; // ордери на покупку (сортуються за спаданням ціни)
        let usdtReceived = 0.0;  // Загальна кількість отриманих USDT (після комісії)

        for (const bid of bids) {
            const price = parseFloat(bid[0]);
            const available = parseFloat(bid[1]);

            if (tokensToSell <= 0) break;

            if (tokensToSell > available) {
                // Продаємо весь доступний обсяг за цього рівня
                const tokensSold = available;
                const effectiveProceeds = tokensSold * price * (1 - commissionRate);
                usdtReceived += effectiveProceeds;
                tokensToSell -= tokensSold;
            } else {
                // Продаємо решту токенів та завершуємо продаж
                const tokensSold = tokensToSell;
                const effectiveProceeds = tokensSold * price * (1 - commissionRate);
                usdtReceived += effectiveProceeds;
                tokensToSell = 0;
                break;
            }
        }

        if (tokensToSell > 0) {
            console.warn("Попередження: не вистачає bid-ордерів для продажу всієї кількості токенів!");
        } else {
            console.log(`Симуляція продажу:
Отримано USDT: ${usdtReceived.toFixed(8)} (з урахуванням комісії)`);
        }

        return {
            usdtReceived,
            tokensSold: tokensToSell
        };
    }
}

export default Bybit;

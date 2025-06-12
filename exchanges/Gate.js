// src/exchanges/Gate.js
class Gate {
    constructor() {
        this.apiUrl = 'https://api.gateio.ws/api/v4/spot/order_book';
    }

    async getOrderBook(pair) {
        const url = `${this.apiUrl}?currency_pair=${pair}&limit=50`;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            return await response.json();
        } catch (err) {
            console.error('Gate getOrderBook error:', err);
            return null;
        }
    }

    // Симуляція покупки токенів за USDT
    async simulateBuy(usdtAmount, pair, commissionRate = 0.0001) {
        const orderBook = await this.getOrderBook(pair);
        if (!orderBook) {
            console.error('simulateBuy: Orderbook is null');
            return null;
        }

        const asks = orderBook.asks; // ордери на продаж (масив [ціна, кількість])
        let budget = usdtAmount;      // бюджет для покупки (USDT)
        let tokensBought = 0.0;       // загальна кількість куплених токенів (після комісії)

        for (const [priceStr, amountStr] of asks) {
            const price = parseFloat(priceStr);
            const available = parseFloat(amountStr);
            const costFull = price * available;

            if (budget <= 0) break;

            if (budget >= costFull) {
                // Купуємо весь рівень
                const tokensPurchased = available;
                const effectiveTokens = tokensPurchased * (1 - commissionRate);
                tokensBought += effectiveTokens;
                budget -= costFull;
            } else {
                // Купуємо лише частину рівня, що покривається бюджетом
                const tokensToBuy = budget / price;
                const effectiveTokens = tokensToBuy * (1 - commissionRate);
                tokensBought += effectiveTokens;
                budget = 0;
                break;
            }
        }

        console.log(`Gate simulateBuy:
За ${usdtAmount} USDT отримано: ${tokensBought.toFixed(8)} токенів (з урахуванням комісії)
Залишок бюджету: ${budget.toFixed(8)} USDT`);

        return {
            tokensBought,
            usdtSpent: usdtAmount - budget
        };
    }

    // Симуляція продажу токенів за USDT
    async simulateSell(tokensToSell, pair, commissionRate = 0.0001) {
        const orderBook = await this.getOrderBook(pair);
        if (!orderBook) {
            console.error('simulateSell: Orderbook is null');
            return null;
        }

        const bids = orderBook.bids; // ордери на купівлю (масив [ціна, кількість])
        let usdtReceived = 0.0;      // загальна кількість USDT, отримана після продажу (з урахуванням комісії)
        let tokensRemaining = tokensToSell;

        for (const [priceStr, amountStr] of bids) {
            const price = parseFloat(priceStr);
            const available = parseFloat(amountStr);

            if (tokensRemaining <= 0) break;

            if (tokensRemaining > available) {
                // Продаємо весь доступний обсяг цього рівня
                const tokensSold = available;
                const effectiveProceeds = tokensSold * price * (1 - commissionRate);
                usdtReceived += effectiveProceeds;
                tokensRemaining -= tokensSold;
            } else {
                // Продаємо решту токенів
                const tokensSold = tokensRemaining;
                const effectiveProceeds = tokensSold * price * (1 - commissionRate);
                usdtReceived += effectiveProceeds;
                tokensRemaining = 0;
                break;
            }
        }

        if (tokensRemaining > 0) {
            console.warn("Попередження: не вистачає bid-ордерів для продажу всієї кількості токенів!");
        } else {
            console.log(`Gate simulateSell:
Отримано USDT: ${usdtReceived.toFixed(8)} (з урахуванням комісії)`);
        }

        return {
            usdtReceived,
            tokensSold: tokensToSell - tokensRemaining
        };
    }
}

export default Gate;

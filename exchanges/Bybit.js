import fetch from 'node-fetch';
import { SocksProxyAgent } from 'socks-proxy-agent';

class Bybit {
    constructor() {
        this.apiUrl = 'https://api.bybit.com/v5/market/orderbook';
        this.proxyUrl = null;
    }

    setProxy(proxyUrl) {
        this.proxyUrl = proxyUrl;
    }

    async getOrderBook(pair) {
        const params = new URLSearchParams({
            category: 'spot',
            symbol: pair, // Формат: токен+USDT (без роздільників, великими літерами)
            limit: '100'
        });
        const url = `${this.apiUrl}?${params.toString()}`;
        console.info(`Bybit getOrderBook URL: ${url}`);

        const options = {};
        if (this.proxyUrl) {
            options.agent = new SocksProxyAgent(this.proxyUrl);
            console.info(`Bybit using proxy: ${this.proxyUrl}`);
        }

        try {
            const response = await fetch(url, options);
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
        let budget = usdtAmount;
        let tokensBought = 0.0;

        for (const ask of asks) {
            const price = parseFloat(ask[0]);
            const available = parseFloat(ask[1]);
            const costFull = price * available;

            if (budget <= 0) break;

            if (budget >= costFull) {
                const effectiveTokens = available * (1 - commissionRate);
                tokensBought += effectiveTokens;
                budget -= costFull;
            } else {
                const tokensToBuy = budget / price;
                tokensBought += tokensToBuy * (1 - commissionRate);
                budget = 0;
                break;
            }
        }

        console.log(`Симуляція покупки:\nЗа ${usdtAmount} USDT отримано: ${tokensBought.toFixed(8)} токенів (з урахуванням комісії)\nЗалишок бюджету: ${budget.toFixed(8)} USDT`);

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
        let usdtReceived = 0.0;
        let tokensRemaining = tokensToSell;

        for (const bid of bids) {
            const price = parseFloat(bid[0]);
            const available = parseFloat(bid[1]);

            if (tokensRemaining <= 0) break;

            if (tokensRemaining > available) {
                usdtReceived += available * price * (1 - commissionRate);
                tokensRemaining -= available;
            } else {
                usdtReceived += tokensRemaining * price * (1 - commissionRate);
                tokensRemaining = 0;
                break;
            }
        }

        if (tokensRemaining > 0) {
            console.warn('Попередження: не вистачає bid-ордерів для продажу всієї кількості токенів!');
        } else {
            console.log(`Симуляція продажу:\nОтримано USDT: ${usdtReceived.toFixed(8)} (з урахуванням комісії)`);
        }

        return {
            usdtReceived,
            tokensSold: tokensToSell - tokensRemaining
        };
    }
}

export default Bybit;

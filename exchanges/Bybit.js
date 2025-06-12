// src/exchanges/Bybit.js
import fetch from 'node-fetch';

class Bybit {
    constructor () {
        this.apiUrl = 'https://api.bybit.com/v5/market/orderbook';

        // Заголовки, аби Cloudflare не сприймав запит за бот-спам
        this.defaultHeaders = {
            'User-Agent': 'Mozilla/5.0 (VenomBot/1.0; +https://github.com/IFlozzy/VenomBot)',
            'Accept':      'application/json'
        };

        // ms → тайм-аут HTTP-запиту
        this.fetchTimeout = 5_000;
    }

    /* --------------------------------------- *
     *            ORDER BOOK (REST)            *
     * --------------------------------------- */
    async getOrderBook (pair) {
        const params = new URLSearchParams({
            category: 'spot',
            symbol:   pair.toUpperCase(), // VENOMUSDT
            limit:    '50'
        });

        const url     = `${this.apiUrl}?${params.toString()}`;
        const options = {
            method:  'GET',
            headers: this.defaultHeaders,
            // тайм-аут через AbortController
            signal:  AbortSignal.timeout(this.fetchTimeout)
        };

        console.info(`Bybit getOrderBook URL: ${url}`);

        try {
            const res = await fetch(url, options);

            // 1) HTTP-код
            if (!res.ok) {
                const txt = await res.text();
                console.error(`Bybit HTTP ${res.status}: ${txt.slice(0, 120)}…`);
                return null;
            }

            // 2) Content-Type
            const ct = res.headers.get('content-type') ?? '';
            const raw = await res.text();
            if (!ct.includes('application/json')) {
                console.error(`Bybit non-JSON (${ct}): ${raw.slice(0, 120)}…`);
                return null;
            }

            const data = JSON.parse(raw);

            if (data.retCode !== 0) {
                console.error('Помилка отримання ордербуку:', data.retMsg);
                return null;
            }
            return data.result;               // успіх
        } catch (err) {
            console.error('Bybit getOrderBook error:', err);
            return null;
        }
    }

    /* --------------------------------------- *
     *           SIMULATE   BUY/SELL           *
     * --------------------------------------- */
    async simulateBuy (usdtAmount, pair, commissionRate = 0.0018) {
        const orderbook = await this.getOrderBook(pair);
        if (!orderbook) {
            console.error('simulateBuy: Orderbook is null');
            return null;
        }

        const asks = orderbook.a;         // [price, size]
        let budget = usdtAmount;
        let tokensBought = 0;

        for (const [priceStr, sizeStr] of asks) {
            const price      = parseFloat(priceStr);
            const available  = parseFloat(sizeStr);
            const costLevel  = price * available;

            if (budget <= 0) break;

            if (budget >= costLevel) {
                // купуємо весь рівень
                tokensBought += available * (1 - commissionRate);
                budget       -= costLevel;
            } else {
                // купуємо частково
                const qty   = budget / price;
                tokensBought += qty * (1 - commissionRate);
                budget = 0;
                break;
            }
        }

        console.log(`Симуляція покупки:
За ${usdtAmount} USDT отримано: ${tokensBought.toFixed(8)} токенів (з урахуванням комісії)
Залишок бюджету: ${budget.toFixed(8)} USDT`);

        return { tokensBought, usdtSpent: usdtAmount - budget };
    }

    async simulateSell (tokensToSell, pair, commissionRate = 0.0018) {
        const orderbook = await this.getOrderBook(pair);
        if (!orderbook) {
            console.error('simulateSell: Orderbook is null');
            return null;
        }

        const bids = orderbook.b;          // [price, size]
        let remaining = tokensToSell;
        let usdtReceived = 0;

        for (const [priceStr, sizeStr] of bids) {
            const price     = parseFloat(priceStr);
            const available = parseFloat(sizeStr);

            if (remaining <= 0) break;

            if (remaining > available) {
                usdtReceived += available * price * (1 - commissionRate);
                remaining    -= available;
            } else {
                usdtReceived += remaining * price * (1 - commissionRate);
                remaining = 0;
                break;
            }
        }

        if (remaining > 0) {
            console.warn('Попередження: не вистачає bid-ордерів для продажу всієї кількості токенів!');
        } else {
            console.log(`Симуляція продажу:
Отримано USDT: ${usdtReceived.toFixed(8)} (з урахуванням комісії)`);
        }

        return { usdtReceived, tokensSold: tokensToSell - remaining };
    }
}

export default Bybit;

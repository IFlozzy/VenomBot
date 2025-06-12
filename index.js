// index.js
import fetch from 'node-fetch';
import Gate from './exchanges/Gate.js';
import Bybit from './exchanges/Bybit.js';
import TelegramNotifier from './telegram/telegramNotifier.js';

const FEE = 0.003; // Комісія для формули Uniswap V2

/**
 * Функція для отримання даних пулу VENOM/USDT з DexScreener
 */
async function fetchPoolData() {
    const url = "https://api.dexscreener.com/latest/dex/pairs/venom/0:56a3f53b5d07da8266c38eb7b4fe1b0e3f3dac6b88ef23a1634d4b9bd4eb2bbe";
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Помилка під час отримання даних із DexScreener: ${response.status}`);
    }
    return await response.json();
}

// Розрахунок swap за Uniswap V2
function getAmountOut(amountIn, reserveIn, reserveOut, fee = FEE) {
    const amountInWithFee = amountIn * (1 - fee);
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn + amountInWithFee;
    return numerator / denominator;
}

// Симуляція покупки на біржі (Gate або Bybit) із використанням ордербуку
async function simulateBuyWithOrderBook(exchange, usdtAmount, orderBook) {
    let commissionRate, asks;
    if (exchange.constructor.name === "Bybit") {
        commissionRate = 0.0018;
        asks = orderBook.a;     // Bybit: масив "a"
    } else {
        commissionRate = 0.0001;
        asks = orderBook.asks;  // Gate: масив "asks"
    }

    let budget = usdtAmount;
    let tokensBought = 0.0;
    for (const level of asks) {
        const price = parseFloat(level[0]);
        const available = parseFloat(level[1]);
        const costFull = price * available;
        if (budget <= 0) break;

        if (budget >= costFull) {
            // Купуємо весь обсяг на цьому рівні
            const tokensPurchased = available;
            const effectiveTokens = tokensPurchased * (1 - commissionRate);
            tokensBought += effectiveTokens;
            budget -= costFull;
        } else {
            // Купуємо частину обсягу на цьому рівні
            const tokensToBuy = budget / price;
            const effectiveTokens = tokensToBuy * (1 - commissionRate);
            tokensBought += effectiveTokens;
            budget = 0;
            break;
        }
    }
    return { tokensBought, usdtSpent: usdtAmount - budget };
}

// Симуляція продажу на біржі (Gate або Bybit) із використанням ордербуку
function simulateSellWithOrderBook(exchange, tokensToSell, orderBook) {
    let commissionRate, bids;
    if (exchange.constructor.name === "Bybit") {
        commissionRate = 0.0018;
        bids = orderBook.b;     // Bybit: масив "b"
    } else {
        commissionRate = 0.0001;
        bids = orderBook.bids;  // Gate: масив "bids"
    }

    let usdtReceived = 0.0;
    let tokensRemaining = tokensToSell;
    for (const level of bids) {
        const price = parseFloat(level[0]);
        const available = parseFloat(level[1]);
        if (tokensRemaining <= 0) break;

        if (tokensRemaining > available) {
            // Продаємо "повний" рівень
            const tokensSold = available;
            const effectiveProceeds = tokensSold * price * (1 - commissionRate);
            usdtReceived += effectiveProceeds;
            tokensRemaining -= tokensSold;
        } else {
            // Продаємо залишок, менший за available
            const tokensSold = tokensRemaining;
            const effectiveProceeds = tokensSold * price * (1 - commissionRate);
            usdtReceived += effectiveProceeds;
            tokensRemaining = 0;
            break;
        }
    }
    return { usdtReceived, tokensSold: tokensToSell - tokensRemaining };
}

// Пошук оптимальних розмірів для Forward
async function findOptimalSizeForward(
    minAmount,
    maxAmount,
    gateOrderBook,
    bybitOrderBook,
    reserveVENOM,
    reserveUSDT
) {
    const gate = new Gate();
    const bybit = new Bybit();

    let optimalForward = { usdtAmount: null, profit: -Infinity };
    const resultsForward = [];

    // Перебираємо всі можливі суми (крок=1)
    for (let usdtAmount = minAmount; usdtAmount <= maxAmount; usdtAmount++) {
        // Купівля на Gate
        const gateResult = await simulateBuyWithOrderBook(gate, usdtAmount, gateOrderBook);
        // Купівля на Bybit
        const bybitResult = await simulateBuyWithOrderBook(bybit, usdtAmount, bybitOrderBook);

        // Порівнюємо, де більше купили VENOM
        const best =
            gateResult.tokensBought > bybitResult.tokensBought
                ? { exchange: "Gate", ...gateResult }
                : { exchange: "Bybit", ...bybitResult };

        // Продаж на Dex за формулою Uniswap з урахуванням додаткової 1% комісії (множимо на 0.99)
        const usdtFromSell = getAmountOut(best.tokensBought, reserveVENOM, reserveUSDT) * 0.99;
        const profit = usdtFromSell - usdtAmount;

        resultsForward.push({
            usdtAmount,
            bestExchange: best.exchange,
            tokensBought: best.tokensBought,
            usdtSpent: best.usdtSpent,
            usdtFromSell,
            profit,
        });

        // Оновлюємо оптимальний варіант
        if (profit > optimalForward.profit) {
            optimalForward = {
                usdtAmount,
                profit,
                bestExchange: best.exchange,
                tokensBought: best.tokensBought,
                usdtFromSell,
            };
        }
    }
    return { resultsForward, optimalForward };
}

// Пошук оптимальних розмірів для Reverse
async function findOptimalSizeReverse(
    minAmount,
    maxAmount,
    gateOrderBook,
    bybitOrderBook,
    reserveVENOM,
    reserveUSDT
) {
    const gate = new Gate();
    const bybit = new Bybit();

    let optimalReverse = { usdtAmount: null, profit: -Infinity };
    const resultsReverse = [];

    for (let usdtAmount = minAmount; usdtAmount <= maxAmount; usdtAmount++) {
        // Купівля на Dex
        const tokensBoughtDex = getAmountOut(usdtAmount, reserveUSDT, reserveVENOM);

        // Продаж на Gate та Bybit
        const gateSell = simulateSellWithOrderBook(gate, tokensBoughtDex, gateOrderBook);
        const bybitSell = simulateSellWithOrderBook(bybit, tokensBoughtDex, bybitOrderBook);

        // Порівнюємо, де отримали більше USDT
        const best =
            gateSell.usdtReceived > bybitSell.usdtReceived
                ? { exchange: "Gate", ...gateSell }
                : { exchange: "Bybit", ...bybitSell };

        const profit = best.usdtReceived - usdtAmount;

        resultsReverse.push({
            usdtAmount,
            bestExchange: best.exchange,
            tokensBoughtOnDex: tokensBoughtDex,
            usdtFromExchangeSale: best.usdtReceived,
            profit,
        });

        if (profit > optimalReverse.profit) {
            optimalReverse = {
                usdtAmount,
                profit,
                bestExchange: best.exchange,
                tokensBoughtOnDex: tokensBoughtDex,
                usdtFromExchangeSale: best.usdtReceived,
            };
        }
    }
    return { resultsReverse, optimalReverse };
}

// Основна функція симуляцій
async function runBothSimulations() {
    const notifier = new TelegramNotifier();

    // Отримуємо дані ордербуків та пулу ліквідності
    let gateOrderBook, bybitOrderBook, poolData;
    try {
        const gate = new Gate();
        const bybit = new Bybit();

        // Паралельно отримуємо все необхідне
        [gateOrderBook, bybitOrderBook, poolData] = await Promise.all([
            gate.getOrderBook("VENOM_USDT"),
            bybit.getOrderBook("VENOMUSDT"),
            fetchPoolData()
        ]);
    } catch (err) {
        console.error("Помилка отримання даних:", err);
        await notifier.sendLog(`Помилка отримання даних: ${err.message}`);
        return;
    }

    if (!gateOrderBook || !bybitOrderBook || !poolData?.pair) {
        await notifier.sendLog("Відсутні коректні дані ордербука або пулу ліквідності.");
        return;
    }

    // Витягуємо резерви з пулу
    const { liquidity } = poolData.pair;
    const reserveUSDT = parseFloat(liquidity.quote);
    const reserveVENOM = parseFloat(liquidity.base);

    // Сценарії
    const scenarios = [
        { name: "100-500",    min: 100,  max: 500,  profitThreshold: 4  },
        { name: "501-1000",   min: 501,  max: 1000, profitThreshold: 7  },
        { name: "1001-1500",  min: 1001, max: 1500, profitThreshold: 10 },
        { name: "1501-2000",  min: 1501, max: 2000, profitThreshold: 20 },
    ];

    // Звіт для логів
    let fullReport = "=== Звіт симуляцій (по сценаріях) ===\n\n";

    for (const scenario of scenarios) {
        try {
            // Запускаємо Forward
            const forward = await findOptimalSizeForward(
                scenario.min,
                scenario.max,
                gateOrderBook,
                bybitOrderBook,
                reserveVENOM,
                reserveUSDT
            );
            // Запускаємо Reverse
            const reverse = await findOptimalSizeReverse(
                scenario.min,
                scenario.max,
                gateOrderBook,
                bybitOrderBook,
                reserveVENOM,
                reserveUSDT
            );

            // Формуємо короткий звіт (залишається назва сценарію)
            fullReport += `Сценарій: ${scenario.name}\n`;
            fullReport += ` - Forward: прибуток = ${forward.optimalForward.profit.toFixed(2)} USDT, сума = ${forward.optimalForward.usdtAmount}\n`;
            fullReport += ` - Reverse: прибуток = ${reverse.optimalReverse.profit.toFixed(2)} USDT, сума = ${reverse.optimalReverse.usdtAmount}\n`;

            // Визначаємо найкращий напрям
            const bestForward = forward.optimalForward.profit;
            const bestReverse = reverse.optimalReverse.profit;

            let mainProfit, mainMessage;
            if (bestForward > bestReverse) {
                // Forward кращий
                mainProfit = forward.optimalForward.profit;
                mainMessage =
                    `Прибуток = ${forward.optimalForward.profit.toFixed(2)} USDT\n` +
                    `${forward.optimalForward.bestExchange} купляємо на ${forward.optimalForward.usdtAmount.toFixed(2)} USDT => ` +
                    `${forward.optimalForward.tokensBought.toFixed(2)} VENOM => ` +
                    `Dex продаємо за ${forward.optimalForward.usdtFromSell.toFixed(2)} USDT`;
            } else {
                // Reverse кращий (або рівний)
                mainProfit = reverse.optimalReverse.profit;
                mainMessage =
                    `Прибуток = ${reverse.optimalReverse.profit.toFixed(2)} USDT\n` +
                    `Dex купляємо на ${reverse.optimalReverse.usdtAmount.toFixed(2)} USDT => ` +
                    `${reverse.optimalReverse.tokensBoughtOnDex.toFixed(2)} VENOM => ` +
                    `${reverse.optimalReverse.bestExchange} продаємо за ${reverse.optimalReverse.usdtFromExchangeSale.toFixed(2)} USDT`;
            }

            // Якщо прибуток у кращому варіанті >= порогового – шлемо в основну групу (без назви сценарію)
            if (mainProfit >= scenario.profitThreshold) {
                await notifier.sendMainMessage(`VENOM - ПОВІДОМЛЕННЯ\n${mainMessage}`);
            }

            // Розділова порожня строка у логу
            fullReport += "\n";
        } catch (err) {
            const msg = `Помилка обробки сценарію ${scenario.name}: ${err.message}`;
            console.error(msg);
            fullReport += msg + "\n";
        }
    }

    // Завжди шлемо логи (fullReport) в Telegram
    await notifier.sendLog(fullReport);
}

async function mainLoop() {
    while (true) {
        try {
            await runBothSimulations();
        } catch (err) {
            console.error("Помилка у mainLoop:", err);
        }
        // Затримка 15 секунд
        await new Promise(resolve => setTimeout(resolve, 15000));
    }
}

// Запуск нескінченного циклу
mainLoop().catch(err => console.error("Непередбачена помилка в mainLoop:", err));

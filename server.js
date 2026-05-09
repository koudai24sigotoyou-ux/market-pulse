const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

loadDotEnv();

const yahooRanges = {
  "1D": { range: "1d", interval: "5m" },
  "1W": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
};

const alphaRanges = {
  "1D": { function: "TIME_SERIES_INTRADAY", interval: "5min", size: "compact" },
  "1W": { function: "TIME_SERIES_DAILY_ADJUSTED", size: "compact", days: 7 },
  "1M": { function: "TIME_SERIES_DAILY_ADJUSTED", size: "compact", days: 31 },
  "3M": { function: "TIME_SERIES_DAILY_ADJUSTED", size: "compact", days: 92 },
  "1Y": { function: "TIME_SERIES_DAILY_ADJUSTED", size: "full", days: 365 },
};

const marketSymbols = [
  { symbol: "^GSPC", name: "S&P 500", currency: "USD" },
  { symbol: "^IXIC", name: "NASDAQ", currency: "USD" },
  { symbol: "^N225", name: "Nikkei 225", currency: "JPY" },
  { symbol: "USDJPY=X", name: "USD/JPY", currency: "JPY" },
];

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(url, request, response);
      return;
    }
    serveStatic(url, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`マーケットパルスを起動しました: http://localhost:${PORT}`);
});

async function handleApi(url, request, response) {
  if (url.pathname === "/api/config") {
    sendJson(response, 200, {
      hasEnvKey: Boolean(process.env.ALPHA_VANTAGE_API_KEY),
      providers: ["Alpha Vantage", "Yahoo Finance fallback"],
    });
    return;
  }

  if (url.pathname === "/api/search") {
    const query = requiredParam(url, "q");
    const apiKey = getApiKey(request);
    const payload = apiKey ? await searchAlpha(query, apiKey) : await searchYahoo(query);
    sendJson(response, 200, payload);
    return;
  }

  if (url.pathname === "/api/chart") {
    const symbol = requiredParam(url, "symbol");
    const range = url.searchParams.get("range") || "1D";
    const apiKey = getApiKey(request);
    const context = {
      name: url.searchParams.get("name") || symbol,
      exchange: url.searchParams.get("exchange") || "",
      currency: url.searchParams.get("currency") || "USD",
    };
    const payload = apiKey
      ? await chartAlpha(symbol, range, apiKey, context)
      : await chartYahoo(symbol, range, context);
    sendJson(response, 200, payload);
    return;
  }

  if (url.pathname === "/api/markets") {
    const markets = await Promise.allSettled(
      marketSymbols.map((item) => chartYahoo(item.symbol, "1D", item)),
    );
    sendJson(response, 200, {
      markets: markets
        .filter((item) => item.status === "fulfilled")
        .map((item) => ({
          name: item.value.name,
          price: item.value.quote.price,
          change: item.value.quote.change,
          changePercent: item.value.quote.changePercent,
          currency: item.value.currency,
        })),
    });
    return;
  }

  sendJson(response, 404, { error: "API route not found" });
}

async function searchAlpha(query, apiKey) {
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", "SYMBOL_SEARCH");
  url.searchParams.set("keywords", query);
  url.searchParams.set("apikey", apiKey);
  const data = await fetchJson(url);
  assertAlphaOk(data);

  const results = (data.bestMatches || []).map((item) => ({
    symbol: item["1. symbol"],
    name: item["2. name"],
    type: item["3. type"],
    exchange: item["4. region"],
    currency: item["8. currency"] || "USD",
  }));

  return { source: "Alpha Vantage", results };
}

async function searchYahoo(query) {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", "12");
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("lang", "en-US");
  url.searchParams.set("region", "US");
  const data = await fetchJson(url);
  const results = (data.quotes || [])
    .filter((item) => item.symbol && item.quoteType !== "OPTION")
    .map((item) => ({
      symbol: item.symbol,
      name: item.shortname || item.longname || item.symbol,
      type: item.quoteType,
      exchange: item.exchDisp || item.exchange || "",
      currency: item.currency || "USD",
    }));

  return { source: "Yahoo Finance fallback", results };
}

async function chartAlpha(symbol, range, apiKey, context) {
  const config = alphaRanges[range] || alphaRanges["1M"];
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", config.function);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("outputsize", config.size);
  if (config.interval) url.searchParams.set("interval", config.interval);

  const data = await fetchJson(url);
  assertAlphaOk(data);
  const key = Object.keys(data).find((item) => item.includes("Time Series"));
  if (!key) throw new Error("Alpha Vantage response did not include a time series.");

  let series = Object.entries(data[key]).map(([time, point]) => ({
    time,
    open: Number(point["1. open"]),
    high: Number(point["2. high"]),
    low: Number(point["3. low"]),
    close: Number(point["4. close"]),
    volume: Number(point["6. volume"] || point["5. volume"]),
  }));

  series = series.sort((a, b) => new Date(a.time) - new Date(b.time));
  if (config.days) {
    const cutoff = Date.now() - config.days * 24 * 60 * 60 * 1000;
    series = series.filter((point) => new Date(point.time).getTime() >= cutoff);
  }
  if (range === "1D") series = series.slice(-90);
  if (series.length < 2) throw new Error("Not enough price points were returned.");

  return buildChartPayload({
    symbol,
    source: "Alpha Vantage",
    context,
    series,
  });
}

async function chartYahoo(symbol, range, context) {
  const config = yahooRanges[range] || yahooRanges["1M"];
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", config.range);
  url.searchParams.set("interval", config.interval);
  url.searchParams.set("includePrePost", "false");
  const data = await fetchJson(url);
  const result = data.chart?.result?.[0];
  const error = data.chart?.error;
  if (error) throw new Error(error.description || "Yahoo Financeからエラーが返されました。");
  if (!result) throw new Error("チャートデータが返されませんでした。");

  const quote = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const meta = result.meta || {};
  const series = timestamps
    .map((timestamp, index) => ({
      time: new Date(timestamp * 1000).toISOString(),
      open: numberOrNull(quote.open?.[index]),
      high: numberOrNull(quote.high?.[index]),
      low: numberOrNull(quote.low?.[index]),
      close: numberOrNull(quote.close?.[index]),
      volume: numberOrNull(quote.volume?.[index]),
    }))
    .filter((point) => Number.isFinite(point.close) && point.close > 0);

  if (series.length < 2) throw new Error("表示に必要な株価データが足りません。");

  return buildChartPayload({
    symbol,
    source: "Yahoo Finance fallback",
    context: {
      ...context,
      currency: meta.currency || context.currency,
      exchange: meta.exchangeName || context.exchange,
      name: context.name || meta.symbol || symbol,
    },
    series,
    previousClose: numberOrNull(meta.chartPreviousClose || meta.previousClose),
  });
}

function buildChartPayload({ symbol, source, context, series, previousClose }) {
  const last = series.at(-1);
  const prior = previousClose || series.at(-2)?.close || last.close;
  const change = last.close - prior;
  const changePercent = prior ? (change / prior) * 100 : 0;

  return {
    symbol,
    name: context.name || symbol,
    exchange: context.exchange || "",
    currency: context.currency || "USD",
    source,
    series,
    quote: {
      price: last.close,
      change,
      changePercent,
      currency: context.currency || "USD",
      timestamp: formatTimestamp(last.time),
    },
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "MarketPulseLocal/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`株価データ提供元からエラーが返されました: ${response.status}`);
  }
  return response.json();
}

function assertAlphaOk(data) {
  if (data["Error Message"]) throw new Error(data["Error Message"]);
  if (data.Note) throw new Error(data.Note);
  if (data.Information) throw new Error(data.Information);
}

function getApiKey(request) {
  return request.headers["x-api-key"] || process.env.ALPHA_VANTAGE_API_KEY || "";
}

function requiredParam(url, name) {
  const value = url.searchParams.get(name);
  if (!value) throw new Error(`必要なパラメータがありません: ${name}`);
  return value.trim();
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function serveStatic(url, response) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("アクセスできません");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("見つかりません");
      return;
    }
    response.writeHead(200, { "content-type": MIME_TYPES[path.extname(filePath)] || "text/plain" });
    response.end(content);
  });
}

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  });
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

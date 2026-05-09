const elements = {
  searchForm: document.querySelector("#searchForm"),
  search: document.querySelector("#searchInput"),
  list: document.querySelector("#stockList"),
  resultCount: document.querySelector("#resultCount"),
  marketStrip: document.querySelector("#marketStrip"),
  status: document.querySelector("#statusBanner"),
  ticker: document.querySelector("#selectedTicker"),
  name: document.querySelector("#selectedName"),
  meta: document.querySelector("#selectedMeta"),
  price: document.querySelector("#selectedPrice"),
  change: document.querySelector("#selectedChange"),
  open: document.querySelector("#statOpen"),
  high: document.querySelector("#statHigh"),
  low: document.querySelector("#statLow"),
  volume: document.querySelector("#statVolume"),
  chart: document.querySelector("#priceChart"),
  tabs: document.querySelectorAll(".range-tabs button"),
  apiKey: document.querySelector("#apiKeyInput"),
  saveKey: document.querySelector("#saveKeyButton"),
  clearKey: document.querySelector("#clearKeyButton"),
  sourceState: document.querySelector("#sourceState"),
  sourceNote: document.querySelector("#sourceNote"),
  savedList: document.querySelector("#savedList"),
  savedCount: document.querySelector("#savedCount"),
};

const state = {
  selected: null,
  selectedRange: "1D",
  latestSeries: [],
  latestQuote: null,
  results: [],
  saved: JSON.parse(localStorage.getItem("market-pulse-symbols") || "[]"),
  apiKey: localStorage.getItem("market-pulse-alpha-key") || "",
};

elements.apiKey.value = state.apiKey;

function setStatus(message, type = "neutral") {
  elements.status.textContent = message;
  elements.status.className = `status-banner ${type}`;
}

function getHeaders() {
  const headers = {};
  if (state.apiKey) headers["x-api-key"] = state.apiKey;
  return headers;
}

async function api(path) {
  const response = await fetch(path, { headers: getHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `リクエストに失敗しました: ${response.status}`);
  }
  return payload;
}

function formatPrice(value, currency = "USD") {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("ja-JP", { notation: "compact" }).format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function normalizeResult(item) {
  return {
    symbol: item.symbol,
    name: item.name || item.shortName || item.longName || item.symbol,
    exchange: item.exchange || item.exchDisp || "",
    type: item.type || item.quoteType || "",
    currency: item.currency || "USD",
  };
}

function formatType(type) {
  const labels = {
    EQUITY: "株式",
    ETF: "ETF",
    INDEX: "指数",
    MUTUALFUND: "投資信託",
    CURRENCY: "為替",
    CRYPTOCURRENCY: "暗号資産",
  };
  return labels[type] || type || "銘柄";
}

function formatSource(source) {
  const labels = {
    Auto: "自動",
    Offline: "オフライン",
    "Alpha Vantage": "Alpha Vantage",
    "Yahoo Finance fallback": "Yahoo Finance",
  };
  return labels[source] || source || "自動";
}

function renderResults(items) {
  elements.resultCount.textContent = String(items.length);
  elements.list.innerHTML = "";

  if (!items.length) {
    elements.list.innerHTML = '<div class="empty-state">検索結果はありません</div>';
    return;
  }

  items.forEach((item) => {
    const result = normalizeResult(item);
    const button = document.createElement("button");
    button.className = `stock-button${state.selected?.symbol === result.symbol ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <strong class="symbol">${result.symbol}</strong>
      <em>${formatType(result.type)}</em>
      <span>${result.name}</span>
      <strong>${result.exchange || "市場"}</strong>
    `;
    button.addEventListener("click", () => selectSymbol(result));
    elements.list.appendChild(button);
  });
}

function renderSaved() {
  elements.savedCount.textContent = String(state.saved.length);
  elements.savedList.innerHTML = "";

  if (!state.saved.length) {
    elements.savedList.innerHTML = '<div class="empty-state">保存済み銘柄はありません</div>';
    return;
  }

  state.saved.forEach((item) => {
    const button = document.createElement("button");
    button.className = "saved-button";
    button.type = "button";
    button.innerHTML = `<strong>${item.symbol}</strong><span>${item.name}</span>`;
    button.addEventListener("click", () => selectSymbol(item));
    elements.savedList.appendChild(button);
  });
}

function saveSelectedSymbol() {
  if (!state.selected) return;
  const exists = state.saved.some((item) => item.symbol === state.selected.symbol);
  if (!exists) {
    state.saved = [state.selected, ...state.saved].slice(0, 10);
    localStorage.setItem("market-pulse-symbols", JSON.stringify(state.saved));
    renderSaved();
  }
}

function drawEmptyChart(label = "チャートデータがありません") {
  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 920;
  const displayHeight = Math.max(canvas.clientHeight, 300);
  canvas.width = displayWidth * ratio;
  canvas.height = displayHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.fillStyle = "#667672";
  ctx.font = "700 16px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(label, displayWidth / 2, displayHeight / 2);
}

function drawChart(series, quote) {
  if (!series.length) {
    drawEmptyChart();
    return;
  }

  const canvas = elements.chart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const displayWidth = canvas.clientWidth || 920;
  const displayHeight = Math.max(canvas.clientHeight, 300);
  canvas.width = displayWidth * ratio;
  canvas.height = displayHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const values = series.map((point) => point.close).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, Math.abs(max) * 0.01, 1);
  const padX = 34;
  const padY = 26;
  const plotWidth = displayWidth - padX * 2;
  const plotHeight = displayHeight - padY * 2;
  const isUp = (quote?.change || 0) >= 0;

  const points = series.map((point, index) => ({
    x: padX + (index / Math.max(series.length - 1, 1)) * plotWidth,
    y: padY + ((max + range * 0.08 - point.close) / (range * 1.16)) * plotHeight,
  }));

  const gradient = ctx.createLinearGradient(0, padY, 0, displayHeight - padY);
  gradient.addColorStop(0, isUp ? "rgba(15, 118, 110, 0.24)" : "rgba(220, 38, 38, 0.18)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points[points.length - 1].x, displayHeight - padY);
  ctx.lineTo(points[0].x, displayHeight - padY);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = isUp ? "#0f766e" : "#dc2626";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = isUp ? "#0f766e" : "#dc2626";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function updateDetails(payload) {
  const { quote, series, source, symbol, name, exchange, currency } = payload;
  const last = series.at(-1) || {};
  state.latestQuote = quote;
  state.latestSeries = series;

  elements.ticker.textContent = symbol;
  elements.name.textContent = name || symbol;
  elements.meta.textContent = [exchange, source, quote?.timestamp].filter(Boolean).join(" · ");
  elements.price.textContent = formatPrice(quote?.price, currency || quote?.currency || "USD");
  elements.change.textContent = `${formatPrice(quote?.change, currency || "USD")} (${formatPercent(quote?.changePercent)})`;
  elements.change.className = quote?.change >= 0 ? "up" : "down";
  elements.open.textContent = formatPrice(last.open, currency || "USD");
  elements.high.textContent = formatPrice(last.high, currency || "USD");
  elements.low.textContent = formatPrice(last.low, currency || "USD");
  elements.volume.textContent = formatNumber(last.volume);
  elements.sourceState.textContent = formatSource(source);

  drawChart(series, quote);
}

async function selectSymbol(item) {
  state.selected = normalizeResult(item);
  renderResults(state.results);
  setStatus(`${state.selected.symbol} を読み込み中...`);

  try {
    const params = new URLSearchParams({
      symbol: state.selected.symbol,
      range: state.selectedRange,
      name: state.selected.name,
      exchange: state.selected.exchange,
      currency: state.selected.currency,
    });
    const payload = await api(`/api/chart?${params}`);
    updateDetails(payload);
    saveSelectedSymbol();
    setStatus(`${new Date().toLocaleTimeString("ja-JP")} に更新しました`, "success");
  } catch (error) {
    setStatus(error.message, "error");
    drawEmptyChart("データを取得できません");
  }
}

async function searchSymbols(query) {
  const trimmed = query.trim();
  if (!trimmed) return;

  setStatus(`${trimmed} を検索中...`);
  elements.list.innerHTML = '<div class="empty-state">検索中...</div>';

  try {
    const payload = await api(`/api/search?q=${encodeURIComponent(trimmed)}`);
    state.results = payload.results.map(normalizeResult);
    renderResults(state.results);
    setStatus(`${formatSource(payload.source)} から ${state.results.length} 件見つかりました`, "success");
    if (state.results[0]) selectSymbol(state.results[0]);
  } catch (error) {
    state.results = [];
    renderResults([]);
    setStatus(error.message, "error");
  }
}

async function loadMarkets() {
  try {
    const payload = await api("/api/markets");
    elements.marketStrip.innerHTML = "";
    payload.markets.forEach((market) => {
      const article = document.createElement("article");
      const changeClass = market.change >= 0 ? "up" : "down";
      article.innerHTML = `
        <span>${market.name}</span>
        <strong>${formatPrice(market.price, market.currency || "USD")}</strong>
        <em class="${changeClass}">${formatPercent(market.changePercent)}</em>
      `;
      elements.marketStrip.appendChild(article);
    });
  } catch (error) {
    elements.marketStrip.innerHTML = `
      <article class="loading-card">
        <span>主要指数を取得できません</span>
        <strong>--</strong>
        <em>${error.message}</em>
      </article>
    `;
  }
}

async function loadConfig() {
  try {
    const payload = await api("/api/config");
    if (payload.hasEnvKey && !state.apiKey) {
      elements.sourceNote.textContent = "サーバー側のALPHA_VANTAGE_API_KEYを使用します。";
      elements.sourceState.textContent = "Alpha Vantage";
    }
  } catch {
    elements.sourceState.textContent = "オフライン";
  }
}

elements.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchSymbols(elements.search.value);
});

elements.tabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedRange = button.dataset.range;
    elements.tabs.forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    if (state.selected) selectSymbol(state.selected);
  });
});

elements.saveKey.addEventListener("click", () => {
  state.apiKey = elements.apiKey.value.trim();
  if (state.apiKey) {
    localStorage.setItem("market-pulse-alpha-key", state.apiKey);
    elements.sourceState.textContent = "Alpha Vantage";
    setStatus("APIキーをこのブラウザに保存しました", "success");
  }
});

elements.clearKey.addEventListener("click", () => {
  state.apiKey = "";
  elements.apiKey.value = "";
  localStorage.removeItem("market-pulse-alpha-key");
  elements.sourceState.textContent = "自動";
  setStatus("APIキーを消去しました", "success");
});

window.addEventListener("resize", () => drawChart(state.latestSeries, state.latestQuote));

drawEmptyChart("銘柄を検索してください");
renderSaved();
loadConfig();
loadMarkets();
searchSymbols("AAPL");

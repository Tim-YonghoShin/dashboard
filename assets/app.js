const DATA_URL = "data/latest.json";
const CLIENT_REFRESH_MS = 5 * 60 * 1000;
const THEME_STORAGE_KEY = "dashboard-theme";

function categoryColorVar(category) {
  return `var(--cat-${category})`;
}

const tickerNavEl = document.getElementById("ticker-nav");
const updatedAtEl = document.getElementById("updated-at");
const themeToggleEl = document.getElementById("theme-toggle");

const numberFmt = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUpdatedAt(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) + " 기준";
}

function deltaDirection(pct) {
  if (pct === null || pct === undefined || pct === 0) return "flat";
  return pct > 0 ? "up" : "down";
}

function deltaText(item) {
  const direction = deltaDirection(item.change_pct);
  const pctText = item.change_pct === null || item.change_pct === undefined
    ? "N/A"
    : `${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`;
  return { direction, pctText };
}

/* ---- 히스토리 CSV (차트 모듈과 공용) ---- */

function parseHistoryCsv(text) {
  return text
    .trim()
    .split("\n")
    .slice(1) // header
    .map((line) => {
      const [date, close] = line.split(",");
      return { date, close: Number(close) };
    });
}

/* ---- 선택 상태 ---- */

let itemsById = new Map();
let selectedIds = [];
let initialized = false;

function toggleSelection(item) {
  const idx = selectedIds.indexOf(item.id);
  if (idx >= 0) {
    selectedIds.splice(idx, 1);
  } else {
    if (selectedIds.length >= MAX_SELECTED) selectedIds.shift();
    selectedIds.push(item.id);
  }
  syncSelection();
}
window.dashboardToggleSelection = toggleSelection;

function syncSelection() {
  tickerNavEl.querySelectorAll(".ticker-row").forEach((row) => {
    const idx = selectedIds.indexOf(row.dataset.id);
    row.classList.toggle("selected", idx >= 0);
    if (idx >= 0) row.style.setProperty("--series-color", DashboardChart.seriesColor(idx));
    else row.style.removeProperty("--series-color");
  });
  const selectedItems = selectedIds.map((id) => itemsById.get(id)).filter(Boolean);
  DashboardChart.setSelection(selectedItems);
}

/* ---- 렌더링 ---- */

function renderTickerRow(item) {
  const { direction, pctText } = deltaText(item);
  const row = document.createElement("div");
  row.className = "ticker-row";
  row.dataset.id = item.id;
  row.tabIndex = 0;
  row.innerHTML = `
    <span class="swatch" aria-hidden="true"></span>
    <span class="ticker-row-name">${item.name}</span>
    <span class="ticker-row-price mono">${numberFmt.format(item.price)}</span>
    <span class="ticker-row-delta ${direction}">${pctText}</span>
  `;
  row.addEventListener("click", () => toggleSelection(item));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSelection(item);
    }
  });
  return row;
}

function renderTickerNav(items) {
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  tickerNavEl.innerHTML = "";
  for (const [category, categoryItems] of byCategory) {
    const group = document.createElement("div");
    group.className = "cat-group";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "cat-header";
    header.style.setProperty("--cat-color", categoryColorVar(category));
    header.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${category}</span><span class="chevron" aria-hidden="true">▾</span>`;
    header.addEventListener("click", () => group.classList.toggle("collapsed"));
    group.appendChild(header);

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "cat-items";
    const inner = document.createElement("div");
    for (const item of categoryItems) inner.appendChild(renderTickerRow(item));
    itemsWrap.appendChild(inner);
    group.appendChild(itemsWrap);

    tickerNavEl.appendChild(group);
  }
}

function renderError(message) {
  tickerNavEl.innerHTML = `<div class="error-banner">${message}</div>`;
}

async function loadData() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updatedAtEl.textContent = formatUpdatedAt(data.updated_at);

    itemsById = new Map(data.items.map((item) => [item.id, item]));
    renderTickerNav(data.items);

    if (!initialized) {
      initialized = true;
      const first = data.items.find((i) => i.hero) || data.items[0];
      if (first) selectedIds = [first.id];
    }
    syncSelection();
  } catch (err) {
    console.error("데이터 로드 실패:", err);
    updatedAtEl.textContent = "갱신 실패";
    renderError("데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
}

/* ---- 테마 토글 ---- */

function applyTheme(theme) {
  // 기본 테마는 dark — data-theme="light"일 때만 라이트로 전환
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
  themeToggleEl.textContent = theme === "light" ? "🌙" : "☀️";
  if (typeof DashboardChart !== "undefined") DashboardChart.applyTheme();
}

function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(stored === "light" ? "light" : "dark");
  themeToggleEl.addEventListener("click", () => {
    const isLight = document.documentElement.dataset.theme === "light";
    const next = isLight ? "dark" : "light";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  });
}

initTheme();
loadData();
setInterval(loadData, CLIENT_REFRESH_MS);

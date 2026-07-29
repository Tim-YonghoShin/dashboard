const DATA_URL = "data/latest.json";
const CLIENT_REFRESH_MS = 5 * 60 * 1000;
const THEME_STORAGE_KEY = "dashboard-theme";

const CATEGORY_ICONS = {
  "국내지수": "🇰🇷",
  "해외지수": "🌍",
  "채권금리": "💵",
  "환율": "💱",
  "원자재": "🛢️",
  "개별종목": "📈",
};

const heroGridEl = document.getElementById("hero-grid");
const sectionsEl = document.getElementById("sections");
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

function deltaArrow(direction) {
  return { up: "▲", down: "▼", flat: "–" }[direction];
}

function deltaText(item) {
  const direction = deltaDirection(item.change_pct);
  const pctText = item.change_pct === null || item.change_pct === undefined
    ? "N/A"
    : `${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`;
  return { direction, pctText };
}

/* ---- 히스토리 CSV (스파크라인 + 차트 모달 공용) ---- */

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

const SPARKLINE_POINTS = 12;
const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 28;

function sparklinePoints(closes) {
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  return closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * SPARKLINE_WIDTH;
      const y = SPARKLINE_HEIGHT - ((c - min) / range) * SPARKLINE_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

async function loadSparkline(id) {
  try {
    const res = await fetch(`data/history/${id}.csv?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const rows = parseHistoryCsv(await res.text());
    const closes = rows.slice(-SPARKLINE_POINTS).map((r) => r.close).filter((c) => !Number.isNaN(c));
    return closes.length >= 2 ? closes : null;
  } catch {
    return null;
  }
}

/* ---- 렌더링 ---- */

function renderHero(items) {
  const heroItems = items.filter((item) => item.hero);
  heroGridEl.innerHTML = "";
  for (const item of heroItems) {
    const { direction, pctText } = deltaText(item);
    const tile = document.createElement("div");
    tile.className = "hero-tile";
    tile.tabIndex = 0;
    tile.innerHTML = `
      <span class="hero-label">${item.name}</span>
      <div class="hero-value">${numberFmt.format(item.price)}</div>
      <span class="tile-delta ${direction}">${deltaArrow(direction)} ${pctText}</span>
    `;
    tile.addEventListener("click", () => DashboardChart.open(item));
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") DashboardChart.open(item);
    });
    heroGridEl.appendChild(tile);
  }
}

function renderTile(item) {
  const { direction, pctText } = deltaText(item);

  const tile = document.createElement("div");
  tile.className = "tile";
  tile.tabIndex = 0;
  tile.innerHTML = `
    <span class="tile-label">${item.name}</span>
    <span class="tile-value">${numberFmt.format(item.price)}</span>
    <svg class="tile-sparkline" width="${SPARKLINE_WIDTH}" height="${SPARKLINE_HEIGHT}" viewBox="0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}" preserveAspectRatio="none" aria-hidden="true"></svg>
    <span class="tile-delta ${direction}">${deltaArrow(direction)} ${pctText}</span>
  `;
  tile.addEventListener("click", () => DashboardChart.open(item));
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") DashboardChart.open(item);
  });

  loadSparkline(item.id).then((closes) => {
    if (!closes) return;
    const svg = tile.querySelector(".tile-sparkline");
    svg.innerHTML = `<polyline points="${sparklinePoints(closes)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
  });

  return tile;
}

function renderSections(items) {
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  sectionsEl.innerHTML = "";
  for (const [category, categoryItems] of byCategory) {
    const section = document.createElement("section");

    const title = document.createElement("h2");
    title.className = "section-title";
    title.innerHTML = `<span aria-hidden="true">${CATEGORY_ICONS[category] || "•"}</span> ${category}`;
    section.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "tile-grid";
    for (const item of categoryItems) grid.appendChild(renderTile(item));
    section.appendChild(grid);

    sectionsEl.appendChild(section);
  }
}

function renderError(message) {
  sectionsEl.innerHTML = `<div class="error-banner">${message}</div>`;
}

async function loadData() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updatedAtEl.textContent = formatUpdatedAt(data.updated_at);
    renderHero(data.items);
    renderSections(data.items);
  } catch (err) {
    console.error("데이터 로드 실패:", err);
    updatedAtEl.textContent = "갱신 실패";
    renderError("데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
}

/* ---- 테마 토글 ---- */

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
  const isDark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  themeToggleEl.textContent = isDark ? "☀️" : "🌙";
  if (typeof DashboardChart !== "undefined") DashboardChart.applyTheme();
}

function initTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(stored);
  themeToggleEl.addEventListener("click", () => {
    const isDark = document.documentElement.dataset.theme === "dark"
      || (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  });
}

initTheme();
loadData();
setInterval(loadData, CLIENT_REFRESH_MS);

const DATA_URL = "data/latest.json";
const CLIENT_REFRESH_MS = 5 * 60 * 1000;
const THEME_STORAGE_KEY = "dashboard-theme";

function categoryColorVar(category) {
  return `var(--cat-${category})`;
}

const tickerNavEl = document.getElementById("ticker-nav");
const updatedAtEl = document.getElementById("updated-at");
const themeToggleEl = document.getElementById("theme-toggle");
const sidebarTooltipEl = document.getElementById("sidebar-tooltip");
const newsListEl = document.getElementById("news-list");
const newsUpdatedEl = document.getElementById("news-updated");

function showSidebarTooltip(row, text) {
  if (!text) return;
  sidebarTooltipEl.textContent = text;
  sidebarTooltipEl.hidden = false;
  const rowRect = row.getBoundingClientRect();
  const ttRect = sidebarTooltipEl.getBoundingClientRect();
  let left = rowRect.right + 10;
  if (left + ttRect.width > window.innerWidth) left = rowRect.left - ttRect.width - 10;
  let top = rowRect.top + rowRect.height / 2 - ttRect.height / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - ttRect.height - 8));
  sidebarTooltipEl.style.left = `${Math.max(left, 4)}px`;
  sidebarTooltipEl.style.top = `${top}px`;
}

function hideSidebarTooltip() {
  sidebarTooltipEl.hidden = true;
}

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
  // z-score류(0 근처를 오가는 값)는 %변화가 무의미(분모가 0에 가까워 값이 튐)하므로
  // 절대 변화값으로 표시한다. 방향(등락) 판정도 %가 아니라 원값 변화로 해야 부호 오류가 없다.
  const isZscore = item.unit === "zscore";
  const raw = isZscore ? item.change : item.change_pct;
  const direction = deltaDirection(raw);
  const pctText = raw === null || raw === undefined
    ? "N/A"
    : isZscore
      ? `${raw > 0 ? "+" : ""}${raw.toFixed(2)}`
      : `${raw > 0 ? "+" : ""}${raw.toFixed(2)}%`;
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
  row.addEventListener("mouseenter", () => showSidebarTooltip(row, item.description));
  row.addEventListener("mouseleave", hideSidebarTooltip);
  row.addEventListener("focus", () => showSidebarTooltip(row, item.description));
  row.addEventListener("blur", hideSidebarTooltip);
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

/* ---- 뉴스 ---- */

function safeUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
  } catch {
    return "#";
  }
}

function formatNewsTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderNewsCard(item) {
  const card = document.createElement("div");
  card.className = "news-card";

  const titleLink = document.createElement("a");
  titleLink.className = "news-card-title";
  titleLink.href = safeUrl(item.url);
  titleLink.target = "_blank";
  titleLink.rel = "noopener";
  titleLink.textContent = item.title; // textContent만 사용 — RSS/LLM 출력은 신뢰할 수 없는 입력

  const summary = document.createElement("p");
  summary.className = "news-card-summary";
  summary.textContent = item.summary;

  const meta = document.createElement("div");
  meta.className = "news-card-meta";
  const source = document.createElement("span");
  source.className = "news-card-source";
  source.textContent = item.source;
  const time = document.createElement("span");
  time.textContent = formatNewsTime(item.published);
  meta.append(source, time);

  card.append(titleLink, summary, meta);
  return card;
}

function renderNews(data) {
  newsUpdatedEl.textContent = data.generated_at ? formatUpdatedAt(data.generated_at) : "";
  newsListEl.innerHTML = "";
  if (!data.items || !data.items.length) {
    newsListEl.innerHTML = '<div class="error-banner">최근 수집된 뉴스가 없습니다.</div>';
    return;
  }
  for (const item of data.items) newsListEl.appendChild(renderNewsCard(item));
}

async function loadNews() {
  try {
    const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderNews(await res.json());
  } catch (err) {
    console.error("뉴스 로드 실패:", err);
    newsListEl.innerHTML = '<div class="error-banner">뉴스를 불러오지 못했습니다.</div>';
  }
}

async function loadData() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updatedAtEl.textContent = formatUpdatedAt(data.updated_at);

    itemsById = new Map(data.items.map((item) => [item.id, item]));
    renderTickerNav(data.items);

    syncSelection(); // 초기 선택 없음 — 빈 차트 상태로 시작
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

/* ---- 블록(그래프/뉴스) 드래그 재정렬 — 좌우 이동 없이 오른쪽 컬럼 내에서만 상하 이동 ---- */

const BLOCKS_ORDER_KEY = "dashboard-blocks-order";

function initSortableBlocks() {
  const container = document.getElementById("blocks-container");
  if (!container) return;

  function getBlocks() {
    return Array.from(container.querySelectorAll(".dashboard-block"));
  }

  function saveOrder() {
    localStorage.setItem(BLOCKS_ORDER_KEY, JSON.stringify(getBlocks().map((b) => b.dataset.block)));
  }

  function applySavedOrder() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(BLOCKS_ORDER_KEY) || "null");
    } catch {
      saved = null;
    }
    if (!Array.isArray(saved)) return;
    for (const id of saved) {
      const el = container.querySelector(`.dashboard-block[data-block="${id}"]`);
      if (el) container.appendChild(el);
    }
  }

  let dragEl = null;

  function onMouseMove(e) {
    if (!dragEl) return;
    const siblings = getBlocks().filter((b) => b !== dragEl);
    let target = null;
    for (const b of siblings) {
      const rect = b.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        target = b;
        break;
      }
    }
    if (target) container.insertBefore(dragEl, target);
    else container.appendChild(dragEl);
  }

  function onMouseUp() {
    if (!dragEl) return;
    dragEl.classList.remove("dragging");
    dragEl = null;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    saveOrder();
  }

  container.querySelectorAll(".block-handle").forEach((handle) => {
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragEl = handle.closest(".dashboard-block");
      dragEl.classList.add("dragging");
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  });

  applySavedOrder();
}

initTheme();
initSortableBlocks();
loadData();
loadNews();
setInterval(loadData, CLIENT_REFRESH_MS);
setInterval(loadNews, CLIENT_REFRESH_MS);

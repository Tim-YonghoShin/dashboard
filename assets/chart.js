const RANGE_PRESETS = [
  { label: "1개월", days: 30 },
  { label: "6개월", days: 182 },
  { label: "1년", days: 365 },
  { label: "5년", days: 365 * 5 },
  { label: "10년", days: 365 * 10 },
  { label: "30년", days: 365 * 30 },
  { label: "전체", days: null },
];
const DEFAULT_RANGE_LABEL = "1년";

const DashboardChart = (() => {
  let chart = null;
  let series = null;
  let fullData = [];
  let currentItem = null;

  const overlay = document.getElementById("modal-overlay");
  const titleEl = document.getElementById("modal-title");
  const subtitleEl = document.getElementById("modal-subtitle");
  const closeBtn = document.getElementById("modal-close");
  const rangeControlsEl = document.getElementById("range-controls");
  const chartContainer = document.getElementById("modal-chart");
  const loadingEl = document.getElementById("modal-loading");

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function seriesColor() {
    if (!currentItem) return cssVar("--accent");
    return cssVar(`--cat-${currentItem.category}`) || cssVar("--accent");
  }

  function hexToRgba(hex, alpha) {
    const m = hex.replace("#", "");
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function ensureChart() {
    if (chart) return;
    const accent = seriesColor();
    chart = LightweightCharts.createChart(chartContainer, {
      layout: {
        background: { color: "transparent" },
        textColor: cssVar("--text-secondary"),
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      },
      grid: {
        vertLines: { color: cssVar("--gridline") },
        horzLines: { color: cssVar("--gridline") },
      },
      rightPriceScale: { borderColor: cssVar("--gridline") },
      timeScale: { borderColor: cssVar("--gridline") },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });
    series = chart.addAreaSeries({
      lineColor: accent,
      topColor: hexToRgba(accent, 0.28),
      bottomColor: hexToRgba(accent, 0.02),
      lineWidth: 2,
      priceLineVisible: false,
    });

    new ResizeObserver(() => {
      chart.applyOptions({
        width: chartContainer.clientWidth,
        height: chartContainer.clientHeight,
      });
    }).observe(chartContainer);

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) close();
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
  }

  function applyTheme() {
    if (!chart) return;
    const accent = seriesColor();
    chart.applyOptions({
      layout: { textColor: cssVar("--text-secondary") },
      grid: {
        vertLines: { color: cssVar("--gridline") },
        horzLines: { color: cssVar("--gridline") },
      },
      rightPriceScale: { borderColor: cssVar("--gridline") },
      timeScale: { borderColor: cssVar("--gridline") },
    });
    series.applyOptions({
      lineColor: accent,
      topColor: hexToRgba(accent, 0.28),
      bottomColor: hexToRgba(accent, 0.02),
    });
  }

  function renderRangeControls() {
    rangeControlsEl.innerHTML = "";
    for (const preset of RANGE_PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "range-btn" + (preset.label === DEFAULT_RANGE_LABEL ? " active" : "");
      btn.textContent = preset.label;
      btn.addEventListener("click", () => {
        rangeControlsEl.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyRange(preset.days);
      });
      rangeControlsEl.appendChild(btn);
    }
  }

  function applyRange(days) {
    if (!fullData.length || !chart) return;
    if (days === null) {
      chart.timeScale().fitContent();
      return;
    }
    const lastTime = fullData[fullData.length - 1].time;
    const firstTime = fullData[0].time;
    const to = new Date(lastTime);
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);
    chart.timeScale().setVisibleRange({
      from: fromStr < firstTime ? firstTime : fromStr,
      to: lastTime,
    });
  }

  async function open(item) {
    currentItem = item;
    ensureChart();
    overlay.style.setProperty("--cat-color", `var(--cat-${item.category})`);
    applyTheme();
    titleEl.textContent = item.name;
    subtitleEl.textContent = item.symbol;
    overlay.hidden = false;
    loadingEl.hidden = false;
    series.setData([]);
    renderRangeControls();

    try {
      const res = await fetch(`data/history/${item.id}.csv?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parseHistoryCsv(await res.text());
      fullData = rows
        .filter((r) => !Number.isNaN(r.close))
        .map((r) => ({ time: r.date, value: r.close }));
      series.setData(fullData);
      const defaultPreset = RANGE_PRESETS.find((p) => p.label === DEFAULT_RANGE_LABEL);
      applyRange(defaultPreset.days);
    } catch (err) {
      console.error("히스토리 로드 실패:", err);
      subtitleEl.textContent = `${item.symbol} · 히스토리를 불러오지 못했습니다`;
    } finally {
      loadingEl.hidden = true;
    }
  }

  function close() {
    overlay.hidden = true;
  }

  return { open, close, applyTheme };
})();

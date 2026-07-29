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
const MA_WINDOW = 20;

// dataviz 카테고리 팔레트에서 all-pairs 검증된 슬롯 위주로 4개 선택(blue/aqua/violet/red)
const SERIES_COLORS = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#1baf7a", dark: "#199e70" },
  { light: "#4a3aa7", dark: "#9085e9" },
  { light: "#e34948", dark: "#e66767" },
];
const MAX_SELECTED = SERIES_COLORS.length;

const DashboardChart = (() => {
  let chart = null;
  let selection = []; // ordered array of ticker item objects
  const dataCache = new Map(); // id -> Promise<[{date, close}]>
  let activeRangeDays = RANGE_PRESETS.find((p) => p.label === DEFAULT_RANGE_LABEL).days;

  const legendEl = document.getElementById("chart-legend");
  const rangeControlsEl = document.getElementById("range-controls");
  const emptyEl = document.getElementById("chart-empty");
  const canvas = document.getElementById("compare-chart");

  function isLight() {
    return document.documentElement.dataset.theme === "light";
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function seriesColor(index) {
    const pair = SERIES_COLORS[index % SERIES_COLORS.length];
    return isLight() ? pair.light : pair.dark;
  }

  function hexToRgba(hex, alpha) {
    const m = hex.replace("#", "");
    const r = parseInt(m.substring(0, 2), 16);
    const g = parseInt(m.substring(2, 4), 16);
    const b = parseInt(m.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function computeMA(points, window) {
    const out = new Array(points.length).fill(null);
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      sum += points[i].y;
      if (i >= window) sum -= points[i - window].y;
      if (i >= window - 1) out[i] = { x: points[i].x, y: sum / window };
    }
    return out.filter(Boolean);
  }

  async function loadSeries(id) {
    if (!dataCache.has(id)) {
      dataCache.set(
        id,
        fetch(`data/history/${id}.csv?t=${Date.now()}`, { cache: "no-store" })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          })
          .then((text) =>
            parseHistoryCsv(text)
              .filter((r) => !Number.isNaN(r.close))
              .map((r) => ({ x: r.date, y: r.close }))
          )
      );
    }
    return dataCache.get(id);
  }

  function renderLegend() {
    legendEl.innerHTML = "";
    selection.forEach((item, i) => {
      const color = seriesColor(i);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "legend-chip";
      chip.innerHTML = `
        <span class="swatch" style="--chip-color:${color}"></span>
        <span class="name">${item.name}</span>
        <span class="close" aria-hidden="true">✕</span>
      `;
      chip.title = `${item.name} 제거`;
      chip.addEventListener("click", () => window.dashboardToggleSelection(item));
      legendEl.appendChild(chip);
    });
  }

  function renderRangeControls() {
    rangeControlsEl.innerHTML = "";
    for (const preset of RANGE_PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "range-btn" + (preset.days === activeRangeDays ? " active" : "");
      btn.textContent = preset.label;
      btn.addEventListener("click", () => {
        activeRangeDays = preset.days;
        rangeControlsEl.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyRange();
      });
      rangeControlsEl.appendChild(btn);
    }
  }

  function applyRange() {
    if (!chart) return;
    if (activeRangeDays === null) {
      delete chart.options.scales.x.min;
      delete chart.options.scales.x.max;
      chart.update();
      return;
    }
    let maxDate = null;
    for (const ds of chart.data.datasets) {
      const last = ds.data[ds.data.length - 1];
      if (last && (!maxDate || last.x > maxDate)) maxDate = last.x;
    }
    if (!maxDate) return;
    const to = new Date(maxDate);
    const from = new Date(to);
    from.setDate(from.getDate() - activeRangeDays);
    chart.options.scales.x.min = from.toISOString().slice(0, 10);
    chart.options.scales.x.max = maxDate;
    chart.update();
  }

  function ensureChart() {
    if (chart) return;
    chart = new Chart(canvas, {
      type: "line",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: cssVar("--surface-2"),
            borderColor: cssVar("--border"),
            borderWidth: 1,
            padding: 10,
            titleColor: cssVar("--text-secondary"),
            bodyColor: cssVar("--text-primary"),
            bodyFont: { family: cssVar("--font-mono"), size: 12 },
            titleFont: { size: 11 },
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                return `  ${ctx.dataset.label}: ${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "time",
            time: { tooltipFormat: "yyyy-MM-dd" },
            grid: { color: cssVar("--gridline") },
            ticks: { color: cssVar("--text-muted"), maxRotation: 0 },
            border: { color: cssVar("--border") },
          },
        },
      },
    });
  }

  function buildScales() {
    const scales = { x: chart.options.scales.x };
    selection.forEach((item, i) => {
      const color = seriesColor(i);
      scales[`y${i}`] = {
        type: "linear",
        position: i % 2 === 0 ? "left" : "right",
        grid: { drawOnChartArea: i === 0, color: cssVar("--gridline") },
        border: { color: cssVar("--border") },
        ticks: { color, maxTicksLimit: 6 },
        title: { display: true, text: item.name, color, font: { size: 11, weight: 600 } },
      };
    });
    chart.options.scales = scales;
  }

  async function rebuild() {
    ensureChart();

    if (selection.length === 0) {
      chart.data.datasets = [];
      chart.update();
      emptyEl.hidden = false;
      legendEl.innerHTML = "";
      return;
    }
    emptyEl.hidden = true;

    const seriesData = await Promise.all(selection.map((item) => loadSeries(item.id)));

    buildScales();
    const datasets = [];
    selection.forEach((item, i) => {
      const color = seriesColor(i);
      const points = seriesData[i];
      datasets.push({
        label: item.name,
        data: points,
        yAxisID: `y${i}`,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.08),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHoverBackgroundColor: color,
        tension: 0.15,
        fill: selection.length === 1,
      });
      if (points.length > MA_WINDOW) {
        datasets.push({
          label: `${item.name} MA${MA_WINDOW}`,
          data: computeMA(points, MA_WINDOW),
          yAxisID: `y${i}`,
          borderColor: hexToRgba(color, 0.55),
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0.15,
        });
      }
    });
    chart.data.datasets = datasets;
    chart.update();
    applyRange();
    renderLegend();
  }

  function applyTheme() {
    if (!chart) return;
    chart.options.plugins.tooltip.backgroundColor = cssVar("--surface-2");
    chart.options.plugins.tooltip.borderColor = cssVar("--border");
    chart.options.plugins.tooltip.titleColor = cssVar("--text-secondary");
    chart.options.plugins.tooltip.bodyColor = cssVar("--text-primary");
    chart.options.scales.x.grid.color = cssVar("--gridline");
    chart.options.scales.x.ticks.color = cssVar("--text-muted");
    if (selection.length) rebuild();
    else chart.update();
  }

  function setSelection(items) {
    selection = items;
    rebuild();
  }

  renderRangeControls();

  return { setSelection, applyTheme, seriesColor };
})();

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
const MA_PERIODS = [5, 20, 60, 120];
const DEFAULT_MA_PERIODS = [20];
const MAX_PINNED = 8;

// dataviz 카테고리 팔레트에서 all-pairs 검증된 슬롯 위주로 4개 선택(blue/aqua/violet/red)
const SERIES_COLORS = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#1baf7a", dark: "#199e70" },
  { light: "#4a3aa7", dark: "#9085e9" },
  { light: "#e34948", dark: "#e66767" },
];
const MAX_SELECTED = SERIES_COLORS.length;

// 정렬된 points 배열에서 timestamp t와 가장 가까운 항목의 인덱스를 이진 탐색으로 찾는다.
// Chart.js 내장 'index'/'x' interaction 모드는 시리즈마다 거래일수가 달라지면
// 널/중복 매칭이 생기는 문제가 있어(대용량 다축 차트에서 확인됨) 직접 구현한다.
function nearestIndex(points, t) {
  let lo = 0;
  let hi = points.length - 1;
  if (t <= points[0].t) return 0;
  if (t >= points[hi].t) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const before = points[lo - 1];
    const after = points[lo];
    return t - before.t <= after.t - t ? lo - 1 : lo;
  }
  return lo;
}

function formatPeriod(days) {
  if (days < 60) return `${days}일`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months}개월 (${days}일)`;
  return `${(days / 365.25).toFixed(1)}년 (${days}일)`;
}

const DashboardChart = (() => {
  let chart = null;
  let selection = []; // ordered array of ticker item objects
  const dataCache = new Map(); // id -> Promise<[{x,y,t}]>
  const resolvedSeries = new Map(); // id -> [{x,y,t}] (동기 접근용, hover에서 사용)
  let activeRangeDays = RANGE_PRESETS.find((p) => p.label === DEFAULT_RANGE_LABEL).days;
  let activeMAPeriods = [...DEFAULT_MA_PERIODS];
  let hoverMatches = null; // 마지막 hover 시점의 [{id,name,date,price,colorIndex}]
  let hoverPixelX = null;
  let mouseDownPos = null;
  let pinnedPoints = [];

  const legendEl = document.getElementById("chart-legend");
  const rangeControlsEl = document.getElementById("range-controls");
  const maControlsEl = document.getElementById("ma-controls");
  const emptyEl = document.getElementById("chart-empty");
  const canvas = document.getElementById("compare-chart");
  const chartWrapEl = document.getElementById("chart-wrap");
  const tooltipEl = document.getElementById("chart-tooltip");
  const pointsPanelEl = document.getElementById("points-panel");
  const pointsListEl = document.getElementById("points-list");
  const pointsCompareEl = document.getElementById("points-compare");
  const pointsClearBtn = document.getElementById("points-clear");

  const crosshairPlugin = {
    id: "crosshair",
    afterDatasetsDraw(c) {
      if (hoverPixelX === null) return;
      const { top, bottom } = c.chartArea;
      const ctx = c.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(hoverPixelX, top);
      ctx.lineTo(hoverPixelX, bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = cssVar("--text-muted");
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    },
  };

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

  function fmtNum(v) {
    return v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  }

  function computeMA(points, window) {
    const out = [];
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      sum += points[i].y;
      if (i >= window) sum -= points[i - window].y;
      if (i >= window - 1) out.push({ x: points[i].x, y: sum / window });
    }
    return out;
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
          .then((text) => {
            const points = parseHistoryCsv(text)
              .filter((r) => !Number.isNaN(r.close))
              .map((r) => ({ x: r.date, y: r.close, t: new Date(r.date).getTime() }));
            resolvedSeries.set(id, points);
            return points;
          })
      );
    }
    return dataCache.get(id);
  }

  /* ---- 범례 / 컨트롤 ---- */

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
        if (chart) chart.resetZoom();
        applyRange();
        recalcYRanges();
      });
      rangeControlsEl.appendChild(btn);
    }
  }

  function renderMAControls() {
    maControlsEl.innerHTML = "";
    for (const period of MA_PERIODS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "range-btn" + (activeMAPeriods.includes(period) ? " active" : "");
      btn.textContent = `MA${period}`;
      btn.addEventListener("click", () => {
        activeMAPeriods = activeMAPeriods.includes(period)
          ? activeMAPeriods.filter((p) => p !== period)
          : [...activeMAPeriods, period].sort((a, b) => a - b);
        btn.classList.toggle("active");
        rebuild();
      });
      maControlsEl.appendChild(btn);
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

  function recalcYRanges() {
    if (!chart || !chart.scales.x) return;
    const xMin = chart.scales.x.min;
    const xMax = chart.scales.x.max;
    selection.forEach((item, i) => {
      const scaleId = `y${i}`;
      const priceDs = chart.data.datasets.find((d) => d.yAxisID === scaleId && d.isPrice);
      if (!priceDs || !chart.options.scales[scaleId]) return;
      const visible = priceDs.data.filter((p) => p.t >= xMin && p.t <= xMax);
      if (!visible.length) return;
      const values = visible.map((p) => p.y);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const pad = (max - min) * 0.1 || Math.abs(max) * 0.05 || 1;
      chart.options.scales[scaleId].min = min - pad;
      chart.options.scales[scaleId].max = max + pad;
    });
    chart.update("none");
  }

  /* ---- 커스텀 hover / 크로스헤어 / 툴팁 ---- */

  function clearHover() {
    hoverMatches = null;
    hoverPixelX = null;
    tooltipEl.hidden = true;
    if (chart) {
      chart.setActiveElements([]);
      chart.update("none");
    }
  }

  function handlePointerMove(evt) {
    if (!chart || !selection.length) return;
    const rect = canvas.getBoundingClientRect();
    const xPixel = evt.clientX - rect.left;
    const yPixel = evt.clientY - rect.top;
    const area = chart.chartArea;
    if (xPixel < area.left || xPixel > area.right || yPixel < area.top || yPixel > area.bottom) {
      clearHover();
      return;
    }
    const t = chart.scales.x.getValueForPixel(xPixel);
    const matches = [];
    const activeElements = [];
    selection.forEach((item, i) => {
      const points = resolvedSeries.get(item.id);
      if (!points || !points.length) return;
      const idx = nearestIndex(points, t);
      const p = points[idx];
      matches.push({ id: item.id, name: item.name, date: p.x, price: p.y, colorIndex: i });
      const dsIndex = chart.data.datasets.findIndex((d) => d.isPrice && d.yAxisID === `y${i}`);
      if (dsIndex >= 0) activeElements.push({ datasetIndex: dsIndex, index: idx });
    });
    if (!matches.length) {
      clearHover();
      return;
    }
    hoverMatches = matches;
    hoverPixelX = xPixel;
    chart.setActiveElements(activeElements);
    chart.update("none");
    renderTooltip(evt.clientX, evt.clientY, matches);
  }

  function renderTooltip(clientX, clientY, matches) {
    const rows = matches
      .map(
        (m) => `
        <div class="chart-tooltip-row">
          <span class="dot" style="background:${seriesColor(m.colorIndex)}"></span>
          <span class="name">${m.name}</span>
          <span class="value mono">${fmtNum(m.price)}</span>
        </div>`
      )
      .join("");
    tooltipEl.innerHTML = `<div class="chart-tooltip-date mono">${matches[0].date}</div>${rows}`;
    tooltipEl.hidden = false;

    const wrapRect = chartWrapEl.getBoundingClientRect();
    let left = clientX - wrapRect.left + 14;
    let top = clientY - wrapRect.top + 14;
    const ttRect = tooltipEl.getBoundingClientRect();
    if (left + ttRect.width > wrapRect.width) left = clientX - wrapRect.left - ttRect.width - 14;
    if (top + ttRect.height > wrapRect.height) top = clientY - wrapRect.top - ttRect.height - 14;
    tooltipEl.style.left = `${Math.max(left, 4)}px`;
    tooltipEl.style.top = `${Math.max(top, 4)}px`;
  }

  /* ---- 포인트 찍기 / 비교 ---- */

  function addPinnedPoint(matches) {
    const date = matches[0].date;
    if (pinnedPoints.some((p) => p.date === date)) return;
    pinnedPoints.push({
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      values: matches.map((m) => ({ seriesId: m.id, name: m.name, price: m.price, colorIndex: m.colorIndex })),
    });
    if (pinnedPoints.length > MAX_PINNED) pinnedPoints.shift();
    pinnedPoints.sort((a, b) => (a.date < b.date ? -1 : 1));
    renderPoints();
  }

  function removePinnedPoint(id) {
    pinnedPoints = pinnedPoints.filter((p) => p.id !== id);
    renderPoints();
  }

  function renderPoints() {
    pointsPanelEl.hidden = pinnedPoints.length === 0;
    pointsListEl.innerHTML = "";
    pinnedPoints.forEach((p) => {
      const card = document.createElement("div");
      card.className = "point-card";
      const rows = p.values
        .map(
          (v) => `
          <div class="row">
            <span><span class="dot" style="background:${seriesColor(v.colorIndex)}"></span>${v.name}</span>
            <span class="v mono">${fmtNum(v.price)}</span>
          </div>`
        )
        .join("");
      card.innerHTML = `<div class="date">${p.date}<button class="point-remove" type="button" aria-label="포인트 제거">✕</button></div>${rows}`;
      card.querySelector(".point-remove").addEventListener("click", () => removePinnedPoint(p.id));
      pointsListEl.appendChild(card);
    });
    renderCompare();
  }

  function compareRow(a, b, highlight) {
    const days = Math.round((new Date(b.date) - new Date(a.date)) / 86400000);
    let row = `<tr${highlight ? ' class="total-row"' : ""}><td>${a.date} → ${b.date}<br><span class="muted">${formatPeriod(days)}</span></td>`;
    selection.forEach((s) => {
      const va = a.values.find((v) => v.seriesId === s.id);
      const vb = b.values.find((v) => v.seriesId === s.id);
      if (!va || !vb) {
        row += `<td class="muted">–</td>`;
        return;
      }
      const pct = ((vb.price - va.price) / va.price) * 100;
      const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
      row += `<td class="mono ${dir}">${pct > 0 ? "+" : ""}${pct.toFixed(2)}%</td>`;
    });
    return row + "</tr>";
  }

  function renderCompare() {
    if (pinnedPoints.length < 2 || selection.length === 0) {
      pointsCompareEl.innerHTML = "";
      return;
    }
    let html = '<table class="compare-table"><thead><tr><th>구간</th>';
    selection.forEach((s, i) => {
      html += `<th style="color:${seriesColor(i)}">${s.name}</th>`;
    });
    html += "</tr></thead><tbody>";
    for (let i = 1; i < pinnedPoints.length; i++) {
      html += compareRow(pinnedPoints[i - 1], pinnedPoints[i], false);
    }
    if (pinnedPoints.length > 2) {
      html += compareRow(pinnedPoints[0], pinnedPoints[pinnedPoints.length - 1], true);
    }
    html += "</tbody></table>";
    pointsCompareEl.innerHTML = html;
  }

  /* ---- Chart.js 본체 ---- */

  function ensureChart() {
    if (chart) return;
    chart = new Chart(canvas, {
      type: "line",
      data: { datasets: [] },
      plugins: [crosshairPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        normalized: true,
        events: [], // 호버/툴팁은 직접 구현 — Chart.js 내장 인터랙션 완전히 대체
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          zoom: {
            limits: { x: { min: "original", max: "original" } },
            // 팬/줌 중에는 y축을 건드리지 않는다(세로축 고정) — range 프리셋 클릭 시에만 재계산
            pan: {
              enabled: true,
              mode: "x",
              onPanComplete: () => {
                rangeControlsEl.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
              },
            },
            zoom: {
              wheel: { enabled: true, speed: 0.12 },
              pinch: { enabled: true },
              mode: "x",
              onZoomComplete: () => {
                rangeControlsEl.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
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

    canvas.addEventListener("mousemove", handlePointerMove);
    canvas.addEventListener("mouseleave", clearHover);
    canvas.addEventListener("mousedown", (e) => {
      mouseDownPos = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("click", (e) => {
      if (mouseDownPos) {
        const dist = Math.hypot(e.clientX - mouseDownPos.x, e.clientY - mouseDownPos.y);
        if (dist > 5) return; // 드래그(팬) 끝의 클릭은 무시
      }
      if (hoverMatches && hoverMatches.length) addPinnedPoint(hoverMatches);
    });

    pointsClearBtn.addEventListener("click", () => {
      pinnedPoints = [];
      renderPoints();
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
    clearHover();

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
        isPrice: true,
        normalized: true,
        borderColor: color,
        backgroundColor: hexToRgba(color, 0.08),
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: cssVar("--surface-1"),
        pointHoverBorderWidth: 2,
        tension: 0,
        fill: selection.length === 1,
      });
      activeMAPeriods.forEach((period, mi) => {
        if (points.length <= period) return;
        const alpha = Math.max(0.65 - mi * 0.13, 0.22);
        datasets.push({
          label: `${item.name} MA${period}`,
          data: computeMA(points, period),
          yAxisID: `y${i}`,
          normalized: true,
          borderColor: hexToRgba(color, alpha),
          borderWidth: 1.5,
          borderDash: [4, 3],
          pointRadius: 0,
          tension: 0,
        });
      });
    });
    chart.data.datasets = datasets;
    chart.update();
    applyRange();
    recalcYRanges();
    renderLegend();
    renderPoints();
  }

  function applyTheme() {
    if (!chart) return;
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
  renderMAControls();

  return { setSelection, applyTheme, seriesColor };
})();

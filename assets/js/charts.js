/* Aureon charts — tiny dependency-free SVG charts (bars, area, donut, sparkline).
   Marks follow the house spec: ≤24px bars with 4px rounded data-ends, 2px lines,
   hairline recessive grid, legend for ≥2 series, hover tooltips on every mark. */
(function () {
  'use strict';
  var esc = function (s) { return window.A ? A.esc(s) : String(s); };

  // Axis top = 4 × a round step (1, 2, 2.5 or 5 × 10^k), so every tick is a clean number.
  function niceMax(v) {
    if (v <= 0) return 4;
    var raw = v / 4;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / p;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * p * 4;
  }
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v));
  }

  function setup(el) {
    el.classList.add('viz');
    el.innerHTML = '';
    var tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.setAttribute('role', 'tooltip');
    el.appendChild(tip);
    return tip;
  }
  function showTip(el, tip, html, x, y) {
    tip.innerHTML = html;
    tip.classList.add('show');
    var w = tip.offsetWidth, h = tip.offsetHeight, W = el.clientWidth;
    var left = Math.min(Math.max(x - w / 2, 0), W - w);
    tip.style.transform = 'translate(' + left + 'px,' + Math.max(y - h - 12, 0) + 'px)';
  }
  function hideTip(tip) { tip.classList.remove('show'); }
  function legend(series) {
    if (series.length < 2) return '';
    return '<div class="viz-legend">' + series.map(function (s) {
      return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>';
    }).join('') + '</div>';
  }
  function observe(el, draw) {
    draw();
    if (!window.ResizeObserver) return;
    var w = el.clientWidth;
    var ro = new ResizeObserver(function () {
      if (Math.abs(el.clientWidth - w) > 4) { w = el.clientWidth; draw(); }
    });
    ro.observe(el);
    el._ro && el._ro.disconnect();
    el._ro = ro;
  }
  // Rounded-top bar path: 4px radius at the data end, square at the baseline.
  function barPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    if (h <= 0) return '';
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  /** Grouped vertical bars. opts: { labels, series:[{name,color,values}], format, height } */
  function bars(el, opts) {
    observe(el, function () {
      var tip = setup(el);
      var H = opts.height || 240, W = Math.max(el.clientWidth, 280);
      var padL = 44, padR = 8, padT = 12, padB = 28;
      var max = niceMax(Math.max.apply(null, opts.series.reduce(function (a, s) { return a.concat(s.values); }, [0])));
      var n = opts.labels.length, k = opts.series.length;
      var band = (W - padL - padR) / n;
      var bw = Math.min(24, (band * 0.7 - (k - 1) * 2) / k);
      var plotH = H - padT - padB;
      var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Bar chart') + '">';
      for (var g = 0; g <= 4; g++) {
        var gy = padT + plotH - plotH * g / 4;
        svg += '<line class="viz-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '"/>';
        svg += '<text class="viz-axis" x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + compact(max * g / 4) + '</text>';
      }
      opts.labels.forEach(function (lab, i) {
        var cx = padL + band * i + band / 2;
        var groupW = k * bw + (k - 1) * 2;
        opts.series.forEach(function (s, j) {
          var v = s.values[i] || 0;
          var h = plotH * v / max;
          var x = cx - groupW / 2 + j * (bw + 2);
          svg += '<path fill="' + s.color + '" d="' + barPath(x, padT + plotH - h, bw, h) + '"/>';
        });
        svg += '<rect class="viz-hit" data-i="' + i + '" x="' + (padL + band * i) + '" y="' + padT + '" width="' + band + '" height="' + plotH + '"/>';
        svg += '<text class="viz-axis" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab) + '</text>';
      });
      svg += '</svg>';
      el.insertAdjacentHTML('beforeend', svg + legend(opts.series));
      el.querySelectorAll('.viz-hit').forEach(function (r) {
        var i = +r.getAttribute('data-i');
        var enter = function () {
          r.classList.add('on');
          var rows = opts.series.map(function (s) {
            return '<div class="viz-tip-row"><i style="background:' + s.color + '"></i>' + esc(s.name) + '<b>' + esc(opts.format(s.values[i] || 0)) + '</b></div>';
          }).join('');
          showTip(el, tip, '<div class="viz-tip-title">' + esc(opts.labels[i]) + '</div>' + rows, padL + band * i + band / 2, padT + 10);
        };
        r.addEventListener('mouseenter', enter);
        r.addEventListener('touchstart', enter, { passive: true });
        r.addEventListener('mouseleave', function () { r.classList.remove('on'); hideTip(tip); });
      });
    });
  }

  /** Single-series area line with crosshair. opts: { labels, values, color, format, height } */
  function area(el, opts) {
    observe(el, function () {
      var tip = setup(el);
      var H = opts.height || 220, W = Math.max(el.clientWidth, 280);
      var padL = 44, padR = 12, padT = 14, padB = 28;
      var max = niceMax(Math.max.apply(null, opts.values.concat([0])));
      var n = opts.values.length;
      var plotW = W - padL - padR, plotH = H - padT - padB;
      var X = function (i) { return padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1)); };
      var Y = function (v) { return padT + plotH - plotH * v / max; };
      var pts = opts.values.map(function (v, i) { return [X(i), Y(v)]; });
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('');
      var areaD = line + 'L' + X(n - 1) + ',' + (padT + plotH) + 'L' + X(0) + ',' + (padT + plotH) + 'Z';
      var color = opts.color || 'var(--series-1)';
      var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Line chart') + '">';
      for (var g = 0; g <= 4; g++) {
        var gy = padT + plotH - plotH * g / 4;
        svg += '<line class="viz-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '"/>';
        svg += '<text class="viz-axis" x="' + (padL - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + compact(max * g / 4) + '</text>';
      }
      var every = Math.ceil(n / Math.max(2, Math.floor(plotW / 70)));
      opts.labels.forEach(function (lab, i) {
        if (i % every === 0 || i === n - 1) svg += '<text class="viz-axis" x="' + X(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(lab) + '</text>';
      });
      svg += '<path d="' + areaD + '" fill="' + color + '" opacity=".1"/>';
      svg += '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      var last = pts[n - 1];
      svg += '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="4" fill="' + color + '" stroke="var(--surface)" stroke-width="2"/>';
      svg += '<line class="viz-cross" x1="0" x2="0" y1="' + padT + '" y2="' + (padT + plotH) + '"/>';
      svg += '<circle class="viz-dot" r="5" fill="' + color + '" stroke="var(--surface)" stroke-width="2"/>';
      svg += '<rect class="viz-hit-area" x="' + padL + '" y="0" width="' + plotW + '" height="' + H + '" fill="transparent"/>';
      svg += '</svg>';
      el.insertAdjacentHTML('beforeend', svg);
      var s = el.querySelector('svg'), cross = s.querySelector('.viz-cross'), dot = s.querySelector('.viz-dot');
      var move = function (clientX) {
        var r = s.getBoundingClientRect();
        var x = clientX - r.left;
        var i = Math.round((x - padL) / (plotW / Math.max(n - 1, 1)));
        i = Math.max(0, Math.min(n - 1, i));
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
        dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(opts.values[i]));
        s.classList.add('hovering');
        showTip(el, tip, '<div class="viz-tip-title">' + esc(opts.labels[i]) + '</div><div class="viz-tip-row"><i style="background:' + color + '"></i>' + esc(opts.name || 'Value') + '<b>' + esc(opts.format(opts.values[i])) + '</b></div>', X(i), Y(opts.values[i]));
      };
      var hit = s.querySelector('.viz-hit-area');
      hit.addEventListener('mousemove', function (e) { move(e.clientX); });
      hit.addEventListener('touchmove', function (e) { move(e.touches[0].clientX); }, { passive: true });
      hit.addEventListener('mouseleave', function () { s.classList.remove('hovering'); hideTip(tip); });
    });
  }

  /** Donut. opts: { items:[{label,value,color}], format, centerLabel, centerValue, size } */
  function donut(el, opts) {
    var tip = setup(el);
    var size = opts.size || 180, r = size / 2, stroke = opts.thickness || 22;
    var total = opts.items.reduce(function (s, it) { return s + it.value; }, 0);
    var R = r - stroke / 2, C = 2 * Math.PI * R;
    var gap = opts.items.length > 1 ? 2 : 0;   // 2px surface gap between segments
    var off = 0;
    var svg = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="' + esc(opts.label || 'Donut chart') + '">';
    svg += '<circle cx="' + r + '" cy="' + r + '" r="' + R + '" fill="none" stroke="var(--surface-2)" stroke-width="' + stroke + '"/>';
    if (total > 0) {
      opts.items.forEach(function (it, i) {
        var len = C * it.value / total;
        var dash = Math.max(len - gap, 0.001);
        svg += '<circle class="viz-seg" data-i="' + i + '" cx="' + r + '" cy="' + r + '" r="' + R + '" fill="none" stroke="' + it.color + '" stroke-width="' + stroke + '" stroke-dasharray="' + dash + ' ' + (C - dash) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 ' + r + ' ' + r + ')"/>';
        off += len;
      });
    }
    svg += '</svg>';
    el.insertAdjacentHTML('beforeend', '<div class="viz-donut" style="width:' + size + 'px;height:' + size + 'px">' + svg +
      '<div class="viz-donut-center"><span>' + esc(opts.centerLabel || '') + '</span><b>' + esc(opts.centerValue || '') + '</b></div></div>');
    el.querySelectorAll('.viz-seg').forEach(function (c) {
      var it = opts.items[+c.getAttribute('data-i')];
      c.addEventListener('mousemove', function (e) {
        var b = el.getBoundingClientRect();
        showTip(el, tip, '<div class="viz-tip-row"><i style="background:' + it.color + '"></i>' + esc(it.label) + '<b>' + esc(opts.format(it.value)) + '</b></div><div class="viz-tip-sub">' + Math.round(it.value / total * 100) + '% of total</div>', e.clientX - b.left, e.clientY - b.top);
      });
      c.addEventListener('mouseleave', function () { hideTip(tip); });
    });
  }

  /** Returns an inline SVG sparkline string. */
  function sparkline(values, opts) {
    opts = opts || {};
    var W = opts.width || 120, H = opts.height || 36;
    if (!values.length) return '';
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = max - min || 1;
    var pts = values.map(function (v, i) {
      return [(values.length === 1 ? W / 2 : W * i / (values.length - 1)), H - 3 - (H - 6) * (v - min) / span];
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('');
    var color = opts.color || 'currentColor';
    return '<svg class="sparkline" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<path d="' + d + 'L' + W + ',' + H + 'L0,' + H + 'Z" fill="' + color + '" opacity=".12"/>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  window.Charts = { bars: bars, area: area, donut: donut, sparkline: sparkline, compact: compact };
})();

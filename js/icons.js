/* 인라인 SVG 아이콘. 24×24 격자, 선(stroke) 2px, 끝 둥글게.
   같은 경로 데이터를 화면(svg)과 PNG 캔버스(draw)에 함께 쓴다. */
const Icons = (function () {
  'use strict';

  const PATHS = {
    // 탭
    dashboard: ['M12 3a9 9 0 1 0 9 9h-9z', 'M15 3.5a9 9 0 0 1 5.5 5.5H15z'],
    timeline: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'M12 7v5l3.5 2'],
    places: ['M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z', 'M12 7.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z'],
    final: ['M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6', 'M10 17h6'],
    settings: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 5a2 2 0 1 1 0 4a2 2 0 1 1 0-4z', 'M9 15a2 2 0 1 1 0 4a2 2 0 1 1 0-4z'],
    // 동작
    trips: ['M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M4 13h16'],
    plus: ['M12 5v14', 'M5 12h14'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    search: ['M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z', 'M15.5 15.5L20 20'],
    download: ['M12 4v11', 'M7 10.5l5 5l5-5', 'M5 20h14'],
    chevron: ['M9 6l6 6l-6 6'],
    edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    alert: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'M12 8v5', 'M12 16.5h.01'],
    // 카테고리 · 숙소
    landmark: ['M3 10l9-6l9 6', 'M5 10v8', 'M9.5 10v8', 'M14.5 10v8', 'M19 10v8', 'M3 20h18'],
    food: ['M6 3v6a3 3 0 0 0 6 0V3', 'M9 3v18', 'M17 21V3c-2 1.5-3 4-3 7v3h3'],
    bag: ['M5 8h14l-1 12H6z', 'M9 8V6a3 3 0 0 1 6 0v2'],
    tag: ['M3 12V4h8l10 10l-8 8z', 'M7.5 7.5h.01'],
    bed: ['M3 18V7', 'M3 13h18v5', 'M21 13a3 3 0 0 0-3-3h-7v3', 'M7 8.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z']
  };

  function svg(name, className) {
    const paths = PATHS[name] || PATHS.tag;
    return `<svg class="icon${className ? ' ' + className : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
      paths.map(function (d) { return `<path d="${d}"/>`; }).join('') + '</svg>';
  }

  // 캔버스에 그린다. (x, y)는 아이콘 왼쪽 위, size는 한 변 길이
  function draw(ctx, name, x, y, size, color) {
    const paths = PATHS[name] || PATHS.tag;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paths.forEach(function (d) { ctx.stroke(new Path2D(d)); });
    ctx.restore();
  }

  return { svg, draw };
})();

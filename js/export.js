/* 최종 일정표 PNG 저장. 화면을 캡처하지 않고 캔버스에 직접 그린다.
   (기기 화면 폭과 상관없이 같은 모양의 이미지가 나오고, 외부 캡처 라이브러리가 필요 없다)
   지도는 TripMap.snapshot()으로 받아 붙이고, 지도를 못 불러오면 그 자리에 안내 문구를 넣는다. */
const ItineraryImage = (function () {
  'use strict';

  const W = 800;
  const PAD = 32;
  const INNER = W - PAD * 2;
  const MAP_H = 420;
  const MAX_CANVAS = 32000; // 브라우저 캔버스 최대 높이 근처
  const MAX_AREA = 16000000; // 아이폰 사파리 캔버스 최대 면적(약 16.7M 픽셀)보다 조금 작게

  // 이미지는 화면 테마와 상관없이 항상 밝은 배경으로 만든다.
  // 다크 모드여도 밝은 테마의 색 변수를 읽도록 잠깐 data-theme="light"로 바꿔 읽고 되돌린다(그 사이 화면은 다시 그려지지 않는다).
  function palette() {
    const rootEl = document.documentElement;
    const prev = rootEl.getAttribute('data-theme');
    rootEl.setAttribute('data-theme', 'light');
    const style = getComputedStyle(rootEl);
    const cssVar = function (name, fallback) { return style.getPropertyValue(name).trim() || fallback; };
    const colors = {
      bg: '#f2f2f2',
      card: '#ffffff',
      text: '#111111',
      sub: '#6b6b6b',
      line: '#e2e2e2',
      accent: cssVar('--color-accent', '#3e91ff'),
      lodging: cssVar('--color-lodging', '#4b4f63'),
      cat: {
        sightseeing: cssVar('--cat-sightseeing', '#3f87c7'),
        food: cssVar('--cat-food', '#d9824a'),
        shopping: cssVar('--cat-shopping', '#c46a96'),
        etc: cssVar('--cat-etc', '#7d8590')
      }
    };
    if (prev === null) rootEl.removeAttribute('data-theme');
    else rootEl.setAttribute('data-theme', prev);
    return colors;
  }

  // 화면에 아직 안 쓰인 글자는 웹 폰트(Pretendard 부분 파일)가 내려받아지지 않았을 수 있다.
  // 이미지에 들어갈 글자를 미리 불러 둔다. 오프라인이면 기다리지 않고 대체 폰트로 그린다.
  async function loadFonts(trip, fontFamily) {
    if (!document.fonts || !document.fonts.load) return;
    const text = [trip.title, trip.country, '0123456789~·:()원일차박전체일정합계숙박체크아웃지도예상비용예산']
      .concat(trip.cities.map(function (c) { return c.name; }))
      .concat(trip.items.map(function (i) { return i.title; }))
      .concat(trip.lodgings.map(function (l) { return l.name; }))
      .join(' ');
    const timeout = new Promise(function (resolve) { setTimeout(resolve, 3000); });
    try {
      await Promise.race([
        Promise.all([document.fonts.load('400 16px ' + fontFamily, text), document.fonts.load('700 16px ' + fontFamily, text)]),
        timeout
      ]);
    } catch (e) {
      // 대체 폰트로 그린다.
    }
  }

  /* ---------- 그리기 도구 ---------- */

  // 측정(draw=false)과 실제 그리기(draw=true)를 같은 코드로 해서 높이 계산이 어긋나지 않게 한다.
  function painter(ctx, draw, fontFamily) {
    function font(size, weight) {
      ctx.font = (weight || 400) + ' ' + size + 'px ' + fontFamily;
    }
    function ellipsize(str, maxWidth) {
      if (ctx.measureText(str).width <= maxWidth) return str;
      let s = str;
      while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
      return s + '…';
    }
    return {
      draw: draw,
      ctx: ctx,
      // y는 아이콘 세로 가운데
      icon: function (name, x, y, size, color) {
        if (draw) Icons.draw(ctx, name, x, y - size / 2, size, color);
      },
      width: function (str, size, weight) {
        font(size, weight);
        return ctx.measureText(str).width;
      },
      text: function (str, x, y, o) {
        font(o.size, o.weight);
        const out = o.maxWidth ? ellipsize(String(str), o.maxWidth) : String(str);
        if (!draw) return;
        ctx.fillStyle = o.color;
        ctx.textAlign = o.align || 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(out, x, y);
      },
      rect: function (x, y, w, h, r, color) {
        if (!draw) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.fill();
      },
      line: function (x1, y, x2, color) {
        if (!draw) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y + 0.5);
        ctx.lineTo(x2, y + 0.5);
        ctx.stroke();
      }
    };
  }

  /* ---------- 지도 지점 표시 ---------- */

  function drawPins(ctx, points, ox, oy, w, h, colors, fontFamily) {
    points.forEach(function (pt) {
      const x = ox + pt.x;
      const y = oy + pt.y;
      if (pt.x < 0 || pt.y < 0 || pt.x > w || pt.y > h) return;
      const color = pt.place.kind === 'lodging' ? colors.lodging : colors.cat[pt.place.category] || colors.cat.etc;
      const label = pt.place.dayLabel;
      ctx.font = '700 13px ' + fontFamily;
      const pw = ctx.measureText(label).width + 16 + 18;
      const ph = 24;
      // 지도 밖으로 나가지 않게 가로 위치를 조정한다.
      const px = Math.min(Math.max(x - pw / 2, ox + 4), ox + w - pw - 4);
      const py = Math.max(y - ph - 10, oy + 4);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(px, py, pw, ph, ph / 2);
      ctx.fill();
      ctx.stroke();
      Icons.draw(ctx, TripMap.placeIcon(pt.place), px + 8, py + ph / 2 - 7, 14, color);
      ctx.fillStyle = colors.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px + 8 + 18, py + ph / 2 + 1);
    });
  }

  // "12,000원 (≈ JP¥1,304)" — 화면과 같은 환산 표시
  function moneyText(trip, value) {
    const fx = Utils.formatConverted(trip, value);
    return Utils.formatMoney(value, trip.currency) + (fx ? ` (${fx})` : '');
  }

  /* ---------- 배치 ---------- */

  function layout(p, trip, cityBlocks, colors) {
    const days = Utils.totalDays(trip.nights);
    const summary = Stats.tripSummary(trip);
    let y = PAD;

    // 머리말
    p.text(trip.title, PAD, y + 20, { size: 30, weight: 700, color: colors.text, maxWidth: INNER });
    y += 46;
    p.text(`${trip.country} · ${Utils.durationLabel(trip.nights)} · ${Utils.formatDisplayDate(trip.startDate, true)} ~ ${Utils.formatDisplayDate(Utils.addDays(trip.startDate, trip.nights), true)}`,
      PAD, y + 12, { size: 16, color: colors.sub, maxWidth: INNER });
    y += 28;
    let costLine = `일정 ${summary.count}개 · 예상 비용 ${moneyText(trip, summary.cost)}`;
    if (summary.budget != null) costLine += ` · 예산 ${moneyText(trip, summary.budget)}`;
    p.text(costLine, PAD, y + 12, { size: 16, weight: 600, color: colors.text, maxWidth: INNER });
    y += 44;

    // 도시 지도
    cityBlocks.forEach(function (block) {
      p.icon('places', PAD, y + 14, 22, colors.accent);
      p.text(block.city.name, PAD + 30, y + 14, { size: 22, weight: 700, color: colors.text, maxWidth: INNER - 30 });
      y += 40;
      p.rect(PAD, y, INNER, MAP_H, 16, '#e8e6e1');
      if (p.draw) {
        const ctx = p.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(PAD, y, INNER, MAP_H, 16);
        ctx.clip();
        if (block.snap) {
          ctx.drawImage(block.snap.canvas, PAD, y, INNER, MAP_H);
          drawPins(ctx, block.snap.points, PAD, y, INNER, MAP_H, colors, p.fontFamily);
        }
        ctx.restore();
      }
      if (!block.snap) {
        p.text('지도를 불러오지 못했습니다 (인터넷 연결 필요)', W / 2, y + MAP_H / 2, { size: 16, color: colors.sub, align: 'center' });
      } else if (!block.snap.tilesDrawn) {
        p.text('지도 배경을 받지 못해 위치만 표시했습니다', W / 2, y + 20, { size: 14, color: colors.sub, align: 'center' });
      }
      y += MAP_H + 12;

      block.places.forEach(function (place) {
        const dayW = p.width(place.dayLabel, 15, 600);
        const legendColor = place.kind === 'lodging' ? colors.lodging : colors.cat[place.category] || colors.cat.etc;
        p.icon(TripMap.placeIcon(place), PAD + 4, y + 13, 16, legendColor);
        p.text(place.name, PAD + 28, y + 13, { size: 15, color: colors.text, maxWidth: INNER - dayW - 48 });
        p.text(place.dayLabel, W - PAD - 4, y + 13, { size: 15, weight: 600, color: colors.accent, align: 'right' });
        y += 28;
      });
      if (block.unlocated) {
        p.text(`위치를 지정하지 않은 ${block.unlocated}곳은 지도에서 빠졌습니다.`, PAD + 4, y + 11, { size: 13, color: colors.sub });
        y += 24;
      }
      y += 20;
    });

    // 일차별 일정
    p.text('전체 일정', PAD, y + 16, { size: 24, weight: 700, color: colors.text });
    y += 44;
    const byDay = Stats.byDay(trip);
    for (let d = 1; d <= days; d++) {
      const items = Stats.sortItems(trip.items.filter(function (i) { return i.day === d && Stats.isActive(i); }));
      const lodging = Stats.lodgingsOnDay(trip, d);
      const lines = lodging.checkingOut.length + lodging.staying.length;
      const cardH = 20 + 34 + lines * 26 + Math.max(items.length, 1) * 34 + 38 + 12;
      p.rect(PAD, y, INNER, cardH, 16, colors.card);
      let cy = y + 20;
      p.text(`Day ${d}`, PAD + 20, cy + 14, { size: 20, weight: 700, color: colors.accent });
      p.text(Utils.formatDisplayDate(Utils.dateOfDay(trip.startDate, d)), PAD + 20 + p.width(`Day ${d}`, 20, 700) + 10, cy + 14, { size: 16, color: colors.sub });
      cy += 34;
      lodging.checkingOut.forEach(function (l) {
        p.icon(Utils.LODGING_ICON, PAD + 20, cy + 12, 16, colors.sub);
        p.text(`체크아웃 · ${l.name}`, PAD + 42, cy + 12, { size: 14, color: colors.sub, maxWidth: INNER - 62 });
        cy += 26;
      });
      lodging.staying.forEach(function (l) {
        p.icon(Utils.LODGING_ICON, PAD + 20, cy + 12, 16, colors.lodging);
        p.text(`숙박 · ${l.name}`, PAD + 42, cy + 12, { size: 14, weight: 600, color: colors.lodging, maxWidth: INNER - 62 });
        cy += 26;
      });
      if (!items.length) {
        p.text('일정 없음', PAD + 20, cy + 16, { size: 15, color: colors.sub });
        cy += 34;
      }
      items.forEach(function (item) {
        p.line(PAD + 20, cy, W - PAD - 20, colors.line);
        const cost = moneyText(trip, item.estimatedCost);
        const costW = p.width(cost, 15, 400);
        const cat = Utils.category(item.category);
        p.text(Utils.formatHourRange(item.startHour, item.durationHours), PAD + 20, cy + 17, { size: 15, weight: 600, color: colors.text });
        p.icon(cat.icon, PAD + 140, cy + 17, 16, colors.cat[cat.id]);
        const title = `${item.status === 'done' ? '✓ ' : ''}${item.title}`;
        p.text(title, PAD + 162, cy + 17, { size: 15, color: colors.text, maxWidth: INNER - 162 - costW - 44 });
        p.text(cost, W - PAD - 20, cy + 17, { size: 15, color: colors.sub, align: 'right' });
        cy += 34;
      });
      p.line(PAD + 20, cy, W - PAD - 20, colors.line);
      p.text(`합계 ${moneyText(trip, byDay[d - 1].cost)}`, W - PAD - 20, cy + 19, { size: 15, weight: 700, color: colors.text, align: 'right' });
      y += cardH + 16;
    }

    // 꼬리말 (지도 저작권 표시는 필수)
    p.text(`지도 ${TripMap.ATTRIBUTION} · 여행 일정관리에서 만든 일정표`, W / 2, y + 14, { size: 12, color: colors.sub, align: 'center' });
    y += 28 + PAD;
    return y;
  }

  /* ---------- 만들기 · 저장 ---------- */

  // 반환: { canvas, mapFailed }
  async function build(trip) {
    const fontFamily = getComputedStyle(document.body).fontFamily;
    const colors = palette();
    await loadFonts(trip, fontFamily);
    const cityBlocks = [];
    let mapFailed = false;
    for (const city of trip.cities) {
      const places = Stats.mapPlaces(trip, city.id);
      if (!places.length) continue;
      let snap = null;
      try {
        snap = await TripMap.snapshot(places, city.location, INNER, MAP_H);
        // 지도는 만들었지만 배경 타일을 하나도 받지 못한 경우도 "지도 없이 저장"으로 알린다.
        if (!snap.tilesDrawn) mapFailed = true;
      } catch (e) {
        mapFailed = true;
      }
      cityBlocks.push({ city: city, places: places, snap: snap, unlocated: Stats.unlocatedCount(trip, city.id) });
    }

    const measure = painter(document.createElement('canvas').getContext('2d'), false, fontFamily);
    measure.fontFamily = fontFamily;
    const height = layout(measure, trip, cityBlocks, colors);

    // 기본 2배로 선명하게 그리되, 브라우저 캔버스 한도(높이 약 32,000px, 아이폰 사파리는 면적 약 1,670만 픽셀)를 넘지 않게 줄인다.
    const scale = Math.max(0.5, Math.min(2, MAX_CANVAS / height, Math.sqrt(MAX_AREA / (W * height))));
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(W * scale);
    canvas.height = Math.floor(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, W, height);
    const p = painter(ctx, true, fontFamily);
    p.fontFamily = fontFamily;
    layout(p, trip, cityBlocks, colors);
    return { canvas: canvas, mapFailed: mapFailed };
  }

  function fileName(trip) {
    return (trip.title.replace(/[\\/:*?"<>|]/g, '').trim() || '여행') + '-일정표.png';
  }

  // 반환: { mapFailed }. 저장에 실패하면 예외를 던진다.
  async function download(trip) {
    const result = await build(trip);
    const blob = await new Promise(function (resolve, reject) {
      try {
        result.canvas.toBlob(function (b) { return b ? resolve(b) : reject(new Error('이미지를 만들지 못했습니다.')); }, 'image/png');
      } catch (e) {
        reject(e);
      }
    });
    Utils.downloadBlob(blob, fileName(trip));
    return { mapFailed: result.mapFailed };
  }

  return { build, download };
})();

/* 계산 전용: 진행률, 비용 합계, 여행 단계(D-day), 타임라인 배치.
   데이터를 바꾸지 않는 순수 함수만 둔다.
   규칙: 취소(cancelled) 항목은 진행률과 비용 합계에서 모두 제외한다. */
const Stats = (function () {
  'use strict';

  function isActive(item) {
    return item.status !== 'cancelled';
  }

  function isDone(item) {
    return item.status === 'done';
  }

  // 진행률(%)은 내림한다. 반올림하면 199/200이 100%로 보이기 때문이다. 분모 0이면 0.
  function percent(done, total) {
    return total === 0 ? 0 : Math.floor((done / total) * 100);
  }

  function sumCost(items, currency) {
    return Utils.roundMoney(items.reduce(function (sum, i) { return sum + i.estimatedCost; }, 0), currency);
  }

  // items 묶음의 진행률·비용 요약
  function summarize(items, currency) {
    const active = items.filter(isActive);
    const done = active.filter(isDone);
    const totalCost = sumCost(active, currency);
    const doneCost = sumCost(done, currency);
    return {
      count: active.length,
      doneCount: done.length,
      cancelledCount: items.length - active.length,
      percent: percent(done.length, active.length),
      cost: totalCost,
      doneCost: doneCost,
      remainingCost: Utils.roundMoney(totalCost - doneCost, currency)
    };
  }

  function tripSummary(trip) {
    const s = summarize(trip.items, trip.currency);
    s.budget = trip.budget;
    s.overBudget = trip.budget != null && s.cost > trip.budget;
    // 예산 0: 비용이 있으면 100%(초과), 없으면 0%. 예산 미입력(null)이면 표시하지 않는다.
    if (trip.budget == null) s.budgetPercent = null;
    else if (trip.budget === 0) s.budgetPercent = s.cost > 0 ? 100 : 0;
    else s.budgetPercent = Math.min(100, Math.floor((s.cost / trip.budget) * 100));
    return s;
  }

  function byDay(trip) {
    const result = [];
    for (let d = 1; d <= Utils.totalDays(trip.nights); d++) {
      const s = summarize(trip.items.filter(function (i) { return i.day === d; }), trip.currency);
      s.day = d;
      s.date = Utils.dateOfDay(trip.startDate, d);
      result.push(s);
    }
    return result;
  }

  function byCity(trip) {
    return trip.cities.map(function (city) {
      const s = summarize(trip.items.filter(function (i) { return i.cityId === city.id; }), trip.currency);
      s.city = city;
      return s;
    });
  }

  function byCategory(trip) {
    return Utils.CATEGORIES.map(function (cat) {
      const s = summarize(trip.items.filter(function (i) { return i.category === cat.id; }), trip.currency);
      s.category = cat;
      return s;
    });
  }

  /* ---------- 날짜 ---------- */

  // phase: 'before' | 'during' | 'after'
  // before → daysUntil(출발까지 남은 일수), during → currentDay(오늘이 몇 일차)
  function tripPhase(trip, today) {
    const diff = Utils.daysBetween(trip.startDate, today);
    const days = Utils.totalDays(trip.nights);
    if (diff < 0) return { phase: 'before', daysUntil: -diff };
    if (diff >= days) return { phase: 'after' };
    return { phase: 'during', currentDay: diff + 1 };
  }

  function ddayLabel(phase) {
    if (phase.phase === 'before') return 'D-' + phase.daysUntil;
    if (phase.phase === 'during') return '여행 ' + phase.currentDay + '일차';
    return '여행 종료';
  }

  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      return a.day - b.day || a.startHour - b.startHour || a.durationHours - b.durationHours ||
        a.title.localeCompare(b.title, 'ko');
    });
  }

  // 여행 중일 때, 지금 진행 중이거나 다음에 할 일정 (예정 상태만). 없으면 null.
  function nextItem(trip, currentDay, nowHour) {
    const candidates = sortItems(trip.items.filter(function (i) {
      if (i.status !== 'planned') return false;
      if (i.day > currentDay) return true;
      return i.day === currentDay && i.startHour + i.durationHours > nowHour;
    }));
    if (!candidates.length) return null;
    const item = candidates[0];
    return { item: item, ongoing: item.day === currentDay && item.startHour <= nowHour };
  }

  /* ---------- 타임라인 ---------- */

  function overlaps(a, b) {
    return a.day === b.day && a.startHour < b.startHour + b.durationHours && b.startHour < a.startHour + a.durationHours;
  }

  // 같은 날 시간이 겹치는 일정 (취소 항목과 excludeId 제외)
  function findOverlaps(trip, slot, excludeId) {
    return sortItems(trip.items.filter(function (i) {
      return i.id !== excludeId && isActive(i) && overlaps(i, slot);
    }));
  }

  // 겹치는 일정을 나란히 놓기 위한 배치. 반환: { [itemId]: { lane, lanes } }
  // 시간이 이어서 겹치는 일정끼리 묶음(cluster)을 만들고, 묶음 안에서 빈 칸(lane)을 앞에서부터 채운다.
  function layoutDay(items) {
    const sorted = items.slice().sort(function (a, b) {
      return a.startHour - b.startHour || b.durationHours - a.durationHours;
    });
    const layout = {};
    let cluster = [];
    let laneEnds = [];
    let clusterEnd = -1;

    function flush() {
      cluster.forEach(function (id) { layout[id].lanes = laneEnds.length; });
      cluster = [];
      laneEnds = [];
    }

    sorted.forEach(function (item) {
      const end = item.startHour + item.durationHours;
      if (item.startHour >= clusterEnd) flush();
      let lane = laneEnds.findIndex(function (laneEnd) { return laneEnd <= item.startHour; });
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      layout[item.id] = { lane: lane, lanes: 1 };
      cluster.push(item.id);
      clusterEnd = Math.max(clusterEnd, end);
    });
    flush();
    return layout;
  }

  /* ---------- 지도 · 최종 일정표 ---------- */

  function locationKey(loc) {
    return loc.lat.toFixed(5) + ',' + loc.lng.toFixed(5);
  }

  function lodgingDays(lodging) {
    const days = [];
    for (let d = lodging.checkInDay; d <= lodging.checkOutDay; d++) days.push(d);
    return days;
  }

  // 도시 지도에 찍을 지점. 같은 위치의 일정은 하나로 묶고 들르는 일차를 모은다. (취소 제외)
  // 반환: [{ kind: 'lodging'|'place', lat, lng, name, category, days, dayLabel, entries }]
  // entries: 팝업·목록에 보여줄 [{ text }] — 일정은 "Day 1 10:00–12:00 제목", 숙소는 "체크인 Day 1 → 체크아웃 Day 4"
  function mapPlaces(trip, cityId) {
    const places = [];

    trip.lodgings.filter(function (l) { return l.cityId === cityId && l.location; }).forEach(function (l) {
      const nights = l.checkOutDay - l.checkInDay;
      places.push({
        kind: 'lodging',
        lat: l.location.lat,
        lng: l.location.lng,
        name: l.name,
        category: null,
        days: lodgingDays(l),
        dayLabel: Utils.formatDayList(lodgingDays(l)) + ' · ' + nights + '박',
        entries: [{ text: '체크인 Day ' + l.checkInDay + ' → 체크아웃 Day ' + l.checkOutDay }]
      });
    });

    const groups = {};
    const order = [];
    sortItems(trip.items.filter(function (i) {
      return i.cityId === cityId && i.location && isActive(i);
    })).forEach(function (i) {
      const key = locationKey(i.location);
      if (!groups[key]) {
        groups[key] = { kind: 'place', lat: i.location.lat, lng: i.location.lng, names: [], category: i.category, days: [], entries: [] };
        order.push(key);
      }
      const g = groups[key];
      if (g.names.indexOf(i.title) < 0) g.names.push(i.title);
      g.days.push(i.day);
      g.entries.push({ text: 'Day ' + i.day + ' ' + Utils.formatHourRange(i.startHour, i.durationHours) + ' ' + i.title });
    });
    order.forEach(function (key) {
      const g = groups[key];
      places.push({
        kind: 'place',
        lat: g.lat,
        lng: g.lng,
        name: g.names.join(', '),
        category: g.category,
        days: g.days,
        dayLabel: Utils.formatDayList(g.days),
        entries: g.entries
      });
    });
    return places;
  }

  // 위치가 없어 지도에 못 찍는 일정·숙소 수 (취소 제외)
  function unlocatedCount(trip, cityId) {
    return trip.items.filter(function (i) { return i.cityId === cityId && !i.location && isActive(i); }).length +
      trip.lodgings.filter(function (l) { return l.cityId === cityId && !l.location; }).length;
  }

  // day 날 밤에 묵는 숙소(체크인 ≤ day < 체크아웃)와 그날 체크아웃하는 숙소
  function lodgingsOnDay(trip, day) {
    return {
      staying: trip.lodgings.filter(function (l) { return l.checkInDay <= day && day < l.checkOutDay; }),
      checkingOut: trip.lodgings.filter(function (l) { return l.checkOutDay === day; })
    };
  }

  return {
    isActive,
    mapPlaces,
    unlocatedCount,
    lodgingsOnDay,
    tripSummary,
    byDay,
    byCity,
    byCategory,
    tripPhase,
    ddayLabel,
    sortItems,
    nextItem,
    findOverlaps,
    layoutDay
  };
})();

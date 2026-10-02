/* 화면 그리기. 데이터를 읽기만 하고 바꾸지 않는다.
   사용자 입력값(그리고 저장된 id 등 데이터에서 온 모든 값)은 반드시 esc()를 거쳐 HTML에 넣는다.
   버튼에는 data-action을 붙이고, 동작은 app.js의 이벤트 위임에서 처리한다.

   화면 뼈대 (One UI):
   .shell
     .shell__main  ── .appbar(접힌 작은 제목, 스크롤하면 나타남) · .hero(큰 제목 영역) · main.panel(카드들)
     nav.nav       ── 하단 내비게이션 (넓은 화면에서는 왼쪽 레일)
     .bottom-action ── 자주 누르는 버튼 (타임라인: 일정 추가, 일정표: 이미지 저장) */
const Render = (function () {
  'use strict';

  const esc = Utils.escapeHtml;
  const icon = Icons.svg;

  const TABS = [
    { id: 'dashboard', label: '진행 현황', icon: 'dashboard' },
    { id: 'timeline', label: '타임라인', icon: 'timeline' },
    { id: 'places', label: '도시·장소', icon: 'places' },
    { id: 'final', label: '일정표', icon: 'final' },
    { id: 'settings', label: '설정', icon: 'settings' }
  ];
  const TAB_IDS = TABS.map(function (t) { return t.id; });

  // env: { today, nowHour, nowMinute, prefersDark } — app.js에서 한 번 만들어 넘긴다.
  function app(root, trip, ui, env) {
    root.innerHTML = trip ? tripView(trip, ui, env) : createTripPage();
  }

  /* ---------- 공용 조각 ---------- */

  // "12,000원 (≈ JP¥1,304)". 환산 설정이 없으면 원래 금액만.
  function money(trip, value) {
    const fx = Utils.formatConverted(trip, value);
    return esc(Utils.formatMoney(value, trip.currency)) + (fx ? ` <span class="fx">(${esc(fx)})</span>` : '');
  }

  // 금액 입력칸 아래 환산 미리보기 (입력하면 app.js가 updateFxHints로 갱신)
  function fxHint(name, trip, value) {
    const text = trip && value !== '' && value != null ? Utils.formatConverted(trip, value) : '';
    return `<p class="field__hint fx-hint" data-fx-hint="${name}" aria-live="polite">${esc(text)}</p>`;
  }

  // "환율 (100엔 = ?원)"
  function rateLabel(currency, convertCurrency) {
    if (!convertCurrency) return '환율';
    return `환율 (${Utils.rateUnit(convertCurrency)}${Utils.currencyName(convertCurrency)} = ?${Utils.currencyName(currency)})`;
  }

  // 카테고리 아이콘을 색 원 안에 넣은 표시 (목록 왼쪽)
  function avatar(iconName, catClass) {
    return `<span class="avatar ${catClass}">${icon(iconName)}</span>`;
  }

  function progressBar(percent, label, modifier) {
    return `<div class="progress${modifier ? ' progress--' + modifier : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="${esc(label)}">` +
      `<div class="progress__fill" style="width:${percent}%"></div></div>`;
  }

  function donut(percent, label) {
    const r = 52;
    const c = 2 * Math.PI * r;
    return `
      <div class="donut" role="img" aria-label="${esc(label)} ${percent}%">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="donut__track" cx="60" cy="60" r="${r}"/>
          <circle class="donut__fill" cx="60" cy="60" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - percent / 100)).toFixed(2)}" transform="rotate(-90 60 60)"/>
        </svg>
        <span class="donut__value" aria-hidden="true"><span>${percent}<small>%</small></span></span>
      </div>`;
  }

  function field(id, name, label, control, hint) {
    return `
      <div class="field">
        <label class="field__label" for="${id}">${label}</label>
        ${control}
        ${hint ? `<p class="field__hint">${hint}</p>` : ''}
        <p class="field__error" id="${id}-error" data-error-for="${name}"></p>
      </div>`;
  }

  function options(list, selected) {
    return list.map(function (o) {
      return `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? ' selected' : ''}>${esc(o.label)}</option>`;
    }).join('');
  }

  function locationBadge(location) {
    return location
      ? `<span class="badge badge--loc" title="${esc(location.label)}">${icon('places')}위치</span>`
      : '';
  }

  function badges(item) {
    let html = locationBadge(item.location);
    if (item.status === 'cancelled') html += '<span class="badge badge--cancelled">취소</span>';
    if (item.editedAt) html += `<span class="badge badge--edited" title="마지막 수정: ${esc(Utils.formatDateTime(item.editedAt))}">변경됨</span>`;
    return html;
  }

  // 원형 체크박스 (모양은 CSS). 취소된 일정은 비활성화하고 수정 화면에서 상태를 바꾼다.
  function checkbox(item) {
    const done = item.status === 'done';
    const cancelled = item.status === 'cancelled';
    return `<input type="checkbox" class="check" data-action="toggle-done" data-id="${esc(item.id)}"` +
      `${done ? ' checked' : ''}${cancelled ? ' disabled' : ''}` +
      ` aria-label="${esc(item.title)} ${cancelled ? '(취소된 일정)' : '완료'}">`;
  }

  function statusClass(item) {
    return item.status === 'done' ? ' is-done' : item.status === 'cancelled' ? ' is-cancelled' : '';
  }

  function cityName(trip, cityId) {
    const city = Utils.findById(trip.cities, cityId);
    return city ? city.name : '';
  }

  function emptyState(iconName, message, actionHtml) {
    return `
      <div class="empty">
        <span class="empty__icon">${icon(iconName)}</span>
        <p class="empty__message">${message}</p>
        ${actionHtml || ''}
      </div>`;
  }

  // 일차 선택지: "Day 1 · 11월 10일 (화)"
  function dayOptions(trip) {
    return range(1, Utils.totalDays(trip.nights)).map(function (d) {
      return { value: d, label: 'Day ' + d + ' · ' + Utils.formatDisplayDate(Utils.dateOfDay(trip.startDate, d)) };
    });
  }

  function range(from, to) {
    const out = [];
    for (let d = from; d <= to; d++) out.push(d);
    return out;
  }

  /* ---------- 뼈대: 앱바 · 큰 제목 · 하단 내비게이션 ---------- */

  function appBar(title, showTrips) {
    const count = State.getData().trips.length;
    return `
      <header class="appbar">
        <span class="appbar__title" aria-hidden="true">${title}</span>
        ${showTrips
          ? `<button type="button" class="icon-btn" data-action="open-trips" aria-label="여행 목록${count > 1 ? ` (${count}개)` : ''}">${icon('trips')}${count > 1 ? `<span class="icon-btn__count">${count}</span>` : ''}</button>`
          : ''}
      </header>`;
  }

  function hero(eyebrow, title, sub) {
    return `
      <section class="hero">
        <div class="hero__content">
          ${eyebrow ? `<p class="hero__eyebrow">${eyebrow}</p>` : ''}
          <h1 class="hero__title">${title}</h1>
          ${sub ? `<p class="hero__sub">${sub}</p>` : ''}
        </div>
      </section>`;
  }

  function bottomNav(activeTab) {
    const items = TABS.map(function (t) {
      const active = t.id === activeTab;
      return `
        <button type="button" class="nav__item${active ? ' is-active' : ''}" data-action="select-tab" data-tab="${t.id}"${active ? ' aria-current="page"' : ''}>
          <span class="nav__icon">${icon(t.icon)}</span>
          <span class="nav__label">${t.label}</span>
        </button>`;
    }).join('');
    return `<nav class="nav" aria-label="화면 이동">${items}</nav>`;
  }

  function bottomAction(trip, ui) {
    if (ui.tab === 'timeline') {
      const day = clampDay(ui.day, Utils.totalDays(trip.nights));
      return `<div class="bottom-action"><button type="button" class="btn btn--primary btn--fab" data-action="add-item" data-day="${day}">${icon('plus')}<span>일정 추가</span></button></div>`;
    }
    if (ui.tab === 'final') {
      return `<div class="bottom-action"><button type="button" class="btn btn--primary btn--fab" data-action="export-png">${icon('download')}<span data-label>이미지로 저장</span></button></div>`;
    }
    return '';
  }

  /* ---------- 여행 폼 (생성·수정 공용) ---------- */

  // prefix: 같은 화면에 폼이 두 개 있어도 id가 겹치지 않게 한다.
  function tripFields(prefix, trip) {
    const t = trip || { title: '', country: '', startDate: '', nights: '', currency: 'KRW', budget: null, convertCurrency: 'JPY', convertRate: null };
    const id = function (name) { return prefix + '-' + name; };
    const convert = t.convertCurrency || '';
    const currencyOptions = options(Utils.CURRENCIES.map(function (c) { return { value: c.code, label: c.label }; }), t.currency);
    return (
      field(id('title'), 'title', '여행 제목',
        `<input class="input" id="${id('title')}" name="title" type="text" maxlength="${State.MAX_TITLE}" value="${esc(t.title)}" placeholder="예: 도쿄·오사카 여행" autocomplete="off" aria-describedby="${id('title')}-error">`) +
      field(id('country'), 'country', '여행 나라',
        `<input class="input" id="${id('country')}" name="country" type="text" maxlength="${State.MAX_COUNTRY}" value="${esc(t.country)}" placeholder="예: 일본" autocomplete="off" aria-describedby="${id('country')}-error">`) +
      `<div class="field-row">` +
        field(id('startDate'), 'startDate', '출발일',
          `<input class="input" id="${id('startDate')}" name="startDate" type="date" value="${esc(t.startDate)}" aria-describedby="${id('startDate')}-error">`) +
        field(id('nights'), 'nights', '숙박 일수 (박)',
          `<input class="input" id="${id('nights')}" name="nights" type="number" inputmode="numeric" min="0" max="${State.MAX_NIGHTS}" step="1" value="${esc(t.nights)}" placeholder="예: 3" aria-describedby="${id('nights')}-error">`,
          '당일치기는 0') +
      `</div>` +
      `<div class="field-row">` +
        field(id('currency'), 'currency', '통화',
          `<select class="input" id="${id('currency')}" name="currency" aria-describedby="${id('currency')}-error">${currencyOptions}</select>`) +
        field(id('budget'), 'budget', '전체 예산 (선택)',
          `<input class="input" id="${id('budget')}" name="budget" type="text" inputmode="decimal" data-money value="${t.budget == null ? '' : esc(Utils.groupDigits(t.budget))}" placeholder="예: 1,500,000" autocomplete="off" aria-describedby="${id('budget')}-error">` +
          fxHint('budget', trip, t.budget == null ? '' : t.budget)) +
      `</div>` +
      `<div class="field-row">` +
        field(id('convertCurrency'), 'convertCurrency', '환산 통화',
          `<select class="input" id="${id('convertCurrency')}" name="convertCurrency">${options([{ value: '', label: '환산 안 함' }].concat(Utils.CURRENCIES.map(function (c) { return { value: c.code, label: c.label }; })), convert)}</select>`) +
        field(id('convertRate'), 'convertRate', `<span data-rate-label>${rateLabel(t.currency, convert)}</span>`,
          `<input class="input" id="${id('convertRate')}" name="convertRate" type="text" inputmode="decimal" data-money value="${esc(Utils.rateInputValue(t.convertRate, convert))}" placeholder="환전한 환율" autocomplete="off" aria-describedby="${id('convertRate')}-error">`) +
      `</div>` +
      `<p class="field__hint">환율을 넣으면 모든 금액 옆에 환산 금액이 함께 표시됩니다. 실제로 환전한 환율로 적어 두세요.</p>` +
      `<div class="trip-preview" data-trip-preview aria-live="polite">${tripPreview(t.startDate, t.nights)}</div>`
    );
  }

  // 출발일·숙박 일수 입력에 맞춰 "N박 N+1일"과 종료일을 보여준다. (PRD F-1.2)
  function tripPreview(startDate, nightsText) {
    const text = String(nightsText).trim();
    const nights = /^\d+$/.test(text) ? Number(text) : null;
    if (nights === null || nights > State.MAX_NIGHTS) {
      return '<span class="trip-preview__hint">출발일과 숙박 일수를 입력하면 여행 기간이 표시됩니다.</span>';
    }
    let html = `<strong class="trip-preview__duration">${Utils.durationLabel(nights)}</strong>`;
    if (nights === 0) html += '<span class="trip-preview__tag">당일치기</span>';
    if (Utils.isValidDate(startDate)) {
      html += `<span class="trip-preview__dates">${esc(Utils.formatDisplayDate(startDate, true))} ~ ${esc(Utils.formatDisplayDate(Utils.addDays(startDate, nights), true))}</span>`;
    }
    return html;
  }

  // 여행 폼은 아직 저장 전인 통화·환율로, 그 밖의 폼은 저장된 여행으로 환산한다.
  function fxTripOf(form, trip) {
    const el = form.elements;
    if (!el.convertCurrency) return trip;
    const rate = Utils.parseRate(el.convertRate.value, el.convertCurrency.value);
    return { currency: el.currency.value, convertCurrency: el.convertCurrency.value || null, convertRate: typeof rate === 'number' ? rate : null };
  }

  function updateFxHints(form, trip) {
    const fxTrip = fxTripOf(form, trip);
    form.querySelectorAll('[data-fx-hint]').forEach(function (hint) {
      const input = form.elements[hint.getAttribute('data-fx-hint')];
      const parsed = fxTrip ? Utils.parseMoney(input.value, fxTrip.currency, true) : { value: null };
      hint.textContent = parsed.value != null && !parsed.error ? Utils.formatConverted(fxTrip, parsed.value) : '';
    });
    const label = form.querySelector('[data-rate-label]');
    if (label) label.textContent = rateLabel(form.elements.currency.value, form.elements.convertCurrency.value);
  }

  function updateTripPreview(form) {
    form.querySelector('[data-trip-preview]').innerHTML = tripPreview(form.elements.startDate.value, form.elements.nights.value);
  }

  function createTripPage() {
    return `
      <div class="shell shell--solo">
        <div class="shell__main">
          ${appBar('새 여행 만들기', false)}
          ${hero('', '새 여행 만들기', '여행 기본 정보를 입력하세요. 도시와 일정은 만든 뒤에 추가할 수 있습니다.')}
          <main class="panel">
            <form class="card form" data-form="trip-create" novalidate>
              ${tripFields('create', null)}
              <button type="submit" class="btn btn--primary btn--block">여행 만들기</button>
            </form>
          </main>
        </div>
      </div>`;
  }

  /* ---------- 여행 화면 ---------- */

  function tripView(trip, ui, env) {
    const phase = Stats.tripPhase(trip, env.today);
    const tab = Utils.findById(TABS, ui.tab) || TABS[0];
    const isDashboard = tab.id === 'dashboard';
    const title = esc(isDashboard ? trip.title : tab.label);
    const eyebrow = `<span class="dday dday--${phase.phase}">${Stats.ddayLabel(phase)}</span>`;
    const sub = isDashboard
      ? `${esc(trip.country)} · ${Utils.durationLabel(trip.nights)} · ${tripDates(trip)}`
      : `${esc(trip.title)} · ${Utils.durationLabel(trip.nights)}`;
    return `
      <div class="shell">
        <div class="shell__main">
          ${appBar(title, true)}
          ${hero(eyebrow, title, sub)}
          <main class="panel" id="panel">${panel(trip, ui, env, phase)}</main>
        </div>
        ${bottomNav(tab.id)}
        ${bottomAction(trip, ui)}
      </div>`;
  }

  function tripDates(trip) {
    return `${esc(Utils.formatDisplayDate(trip.startDate))} ~ ${esc(Utils.formatDisplayDate(Utils.addDays(trip.startDate, trip.nights)))}`;
  }

  function panel(trip, ui, env, phase) {
    switch (ui.tab) {
      case 'timeline': return timeline(trip, ui, env, phase);
      case 'places': return places(trip, ui);
      case 'final': return finalView(trip);
      case 'settings': return settings(trip, ui, env);
      default: return dashboard(trip, env, phase);
    }
  }

  function filterChips(filter) {
    const all = filter.length === 0;
    const chips = Utils.CATEGORIES.map(function (cat) {
      const on = filter.indexOf(cat.id) >= 0;
      return `<button type="button" class="chip cat--${cat.id}${on ? ' is-active' : ''}" data-action="toggle-filter" data-category="${cat.id}" aria-pressed="${on}">` +
        `${icon(cat.icon)}${cat.label}</button>`;
    }).join('');
    return `
      <div class="chips" role="group" aria-label="카테고리 필터">
        <button type="button" class="chip${all ? ' is-active' : ''}" data-action="clear-filter" aria-pressed="${all}">전체</button>
        ${chips}
      </div>`;
  }

  function passesFilter(item, filter) {
    return filter.length === 0 || filter.indexOf(item.category) >= 0;
  }

  /* ---------- 진행 현황 ---------- */

  function dashboard(trip, env, phase) {
    const s = Stats.tripSummary(trip);
    const hasItems = trip.items.length > 0;
    const progress = s.count === 0
      ? emptyState('timeline', hasItems ? '모든 일정이 취소 상태입니다.' : '아직 일정이 없습니다.',
        '<button type="button" class="btn btn--primary" data-action="select-tab" data-tab="timeline">타임라인에서 일정 추가</button>')
      : `<div class="progress-summary">
           ${donut(s.percent, '전체 진행률')}
           <dl class="progress-summary__stats">
             <div><dt>완료</dt><dd>${s.doneCount}개</dd></div>
             <div><dt>남음</dt><dd>${s.count - s.doneCount}개</dd></div>
             <div><dt>전체</dt><dd>${s.count}개</dd></div>
           </dl>
         </div>
         ${s.cancelledCount ? `<p class="sub">취소한 일정 ${s.cancelledCount}개는 제외했습니다.</p>` : ''}`;
    return (
      phaseCard(trip, env, phase) +
      `<section class="card"><h2 class="card__title">전체 진행률</h2>${progress}</section>` +
      costCard(trip, s) +
      (hasItems ? dayProgressCard(trip) + categoryCard(trip) + cityCard(trip) : '')
    );
  }

  function phaseCard(trip, env, phase) {
    let body = '';
    if (phase.phase === 'before') {
      body = `<p class="sub">출발까지 ${phase.daysUntil}일 남았습니다.</p>`;
    } else if (phase.phase === 'after') {
      body = '<p class="sub">여행이 끝났습니다.</p>';
    } else {
      const day = phase.currentDay;
      const next = Stats.nextItem(trip, day, env.nowHour);
      body = `
        <p class="today">오늘 · Day ${day} <span class="sub">${esc(Utils.formatDisplayDate(env.today))}</span></p>
        ${next
          ? `<button type="button" class="next" data-action="edit-item" data-id="${esc(next.item.id)}">
               ${avatar(Utils.category(next.item.category).icon, 'cat--' + Utils.category(next.item.category).id)}
               <span class="next__body">
                 <span class="next__label">${next.ongoing ? '지금 진행 중' : next.item.day === day ? '다음 일정' : '다음 일정 · Day ' + next.item.day}</span>
                 <span class="next__title">${esc(next.item.title)}</span>
                 <span class="sub">${Utils.formatHourRange(next.item.startHour, next.item.durationHours)} · ${esc(cityName(trip, next.item.cityId))}</span>
               </span>
               ${icon('chevron', 'chev')}
             </button>`
          : '<p class="sub">남은 예정 일정이 없습니다.</p>'}
        <button type="button" class="btn btn--tonal btn--small" data-action="go-day" data-day="${day}">오늘 타임라인 보기</button>`;
    }
    return `
      <section class="card phase phase--${phase.phase}">
        <p class="phase__dday">${Stats.ddayLabel(phase)}</p>
        <p class="sub">${tripDates(trip)} · ${Utils.durationLabel(trip.nights)}</p>
        ${body}
      </section>`;
  }

  function costCard(trip, s) {
    let budget = '';
    if (s.budget != null) {
      budget = `
        <div class="budget">
          <p class="row"><span>예산</span><strong class="num">${money(trip, s.budget)}</strong></p>
          ${progressBar(s.budgetPercent, '예산 사용률', s.overBudget ? 'danger' : '')}
          ${s.overBudget
            ? `<p class="warn" role="alert">예상 비용이 예산을 ${money(trip, Utils.roundMoney(s.cost - s.budget, trip.currency))} 초과했습니다.</p>`
            : `<p class="sub">예산의 ${s.budgetPercent}% · ${money(trip, Utils.roundMoney(s.budget - s.cost, trip.currency))} 남음</p>`}
        </div>`;
    }
    return `
      <section class="card">
        <h2 class="card__title">비용 요약</h2>
        <p class="big-money num">${money(trip, s.cost)}</p>
        <p class="sub">전체 예상 비용</p>
        <dl class="stats">
          <div class="stats__item"><dt>완료한 일정</dt><dd class="num">${money(trip, s.doneCost)}</dd></div>
          <div class="stats__item"><dt>남은 일정</dt><dd class="num">${money(trip, s.remainingCost)}</dd></div>
        </dl>
        ${budget}
      </section>`;
  }

  function dayProgressCard(trip) {
    const rows = Stats.byDay(trip).map(function (d) {
      return `
        <li>
          <button type="button" class="list-row stat-row" data-action="go-day" data-day="${d.day}">
            <span class="stat-row__label">Day ${d.day} <span class="sub">${esc(Utils.formatDisplayDate(d.date))}</span></span>
            <span class="stat-row__value num">${d.count ? `${d.doneCount}/${d.count}` : '일정 없음'} · ${money(trip, d.cost)}</span>
            ${progressBar(d.percent, 'Day ' + d.day + ' 진행률')}
          </button>
        </li>`;
    }).join('');
    return `<section class="card card--list"><h2 class="card__title">일차별 진행률</h2><ul class="list">${rows}</ul></section>`;
  }

  function categoryCard(trip) {
    const rows = Stats.byCategory(trip).map(function (c) {
      return `
        <li class="list-row">
          ${avatar(c.category.icon, 'cat--' + c.category.id)}
          <span class="list-row__text"><span class="list-row__title">${c.category.label}</span><span class="list-row__sub">완료 ${c.doneCount}/${c.count}</span></span>
          <span class="list-row__end num">${money(trip, c.cost)}</span>
        </li>`;
    }).join('');
    return `<section class="card card--list"><h2 class="card__title">카테고리별 현황</h2><ul class="list">${rows}</ul></section>`;
  }

  function cityCard(trip) {
    if (!trip.cities.length) return '';
    const rows = Stats.byCity(trip).map(function (c) {
      return `
        <li class="list-row">
          ${avatar('places', 'avatar--accent')}
          <span class="list-row__text"><span class="list-row__title">${esc(c.city.name)}</span><span class="list-row__sub">완료 ${c.doneCount}/${c.count}</span></span>
          <span class="list-row__end num">${money(trip, c.cost)}</span>
        </li>`;
    }).join('');
    return `<section class="card card--list"><h2 class="card__title">도시별 비용</h2><ul class="list">${rows}</ul></section>`;
  }

  /* ---------- 타임라인 ---------- */

  function clampDay(day, days) {
    return Math.min(Math.max(1, day), days);
  }

  function timeline(trip, ui, env, phase) {
    const days = Utils.totalDays(trip.nights);
    const day = clampDay(ui.day, days);
    const todayDay = phase.phase === 'during' ? phase.currentDay : null;

    let dayTabs = '';
    for (let d = 1; d <= days; d++) {
      const active = d === day;
      dayTabs += `
        <button type="button" class="day-chip${active ? ' is-active' : ''}${d === todayDay ? ' is-today' : ''}" data-action="select-day" data-day="${d}" aria-pressed="${active}">
          <span class="day-chip__label">Day ${d}${d === todayDay ? ' · 오늘' : ''}</span>
          <span class="day-chip__date">${esc(Utils.formatDisplayDate(Utils.dateOfDay(trip.startDate, d)))}</span>
        </button>`;
    }

    const dayItems = trip.items.filter(function (i) { return i.day === day; });
    const visible = dayItems.filter(function (i) { return passesFilter(i, ui.filter); });
    const hiddenCount = dayItems.length - visible.length;
    const daySummary = Stats.byDay(trip)[day - 1];

    // 06시 이전 일정이 있으면 그 시각부터 보여준다.
    const startHour = dayItems.reduce(function (min, i) { return Math.min(min, i.startHour); }, Utils.TIMELINE.startHour);
    const endHour = Utils.TIMELINE.endHour;

    let rows = '';
    for (let h = startHour; h < endHour; h++) {
      rows += `
        <div class="tl-row">
          <span class="tl-row__time">${Utils.formatHour(h)}</span>
          <button type="button" class="tl-row__slot" data-action="add-item" data-day="${day}" data-hour="${h}" aria-label="Day ${day} ${Utils.formatHour(h)}에 일정 추가"></button>
        </div>`;
    }

    // 여행 중인 날에는 지금 시각에 파란 가로선을 긋는다.
    let nowLine = '';
    const nowOffset = env.nowHour + env.nowMinute / 60 - startHour;
    if (day === todayDay && nowOffset >= 0 && nowOffset <= endHour - startHour) {
      nowLine = `<div class="tl-now" style="--now:${nowOffset.toFixed(3)}" aria-hidden="true"></div>`;
    }

    const layout = Stats.layoutDay(visible);
    const cards = Stats.sortItems(visible).map(function (item) {
      return timelineCard(trip, item, layout[item.id], startHour);
    }).join('');

    let info = `일정 ${daySummary.count}개 · 합계 ${money(trip, daySummary.cost)}`;
    if (hiddenCount) info += ` · 필터로 ${hiddenCount}개 숨김`;

    return `
      <div class="day-chips" role="group" aria-label="일차 선택">${dayTabs}</div>
      ${filterChips(ui.filter)}
      <section class="card timeline" aria-label="Day ${day} 타임라인">
        <div class="timeline__head">
          <h2 class="card__title">Day ${day} · ${esc(Utils.formatDisplayDate(Utils.dateOfDay(trip.startDate, day), true))}</h2>
          <p class="sub num">${info}</p>
          ${dayItems.length ? '' : '<p class="sub">빈 시간을 누르면 그 시간에 일정을 추가할 수 있습니다.</p>'}
        </div>
        <div class="tl" style="--rows:${endHour - startHour}">
          ${rows}
          <div class="tl-items">${cards}${nowLine}</div>
        </div>
      </section>`;
  }

  function timelineCard(trip, item, pos, rangeStart) {
    const style = `--start:${item.startHour - rangeStart};--span:${item.durationHours};--lane:${pos.lane};--lanes:${pos.lanes}`;
    const cat = Utils.category(item.category);
    return `
      <article class="item-card cat--${cat.id}${statusClass(item)}${item.durationHours === 1 ? ' is-short' : ''}" style="${style}">
        <button type="button" class="item-card__main" data-action="edit-item" data-id="${esc(item.id)}">
          <span class="item-card__title">${icon(cat.icon)}<span class="item-card__name">${esc(item.title)}</span></span>
          <span class="item-card__meta num">${Utils.formatHourRange(item.startHour, item.durationHours)} · ${money(trip, item.estimatedCost)} · ${esc(cityName(trip, item.cityId))}</span>
          <span class="item-card__badges"><span class="visually-hidden">${cat.label}</span>${badges(item)}</span>
        </button>
        ${checkbox(item)}
      </article>`;
  }

  /* ---------- 도시·장소 ---------- */

  function places(trip, ui) {
    const sections = Stats.byCity(trip).map(function (c) {
      const items = Stats.sortItems(trip.items.filter(function (i) {
        return i.cityId === c.city.id && passesFilter(i, ui.filter);
      }));
      const total = trip.items.filter(function (i) { return i.cityId === c.city.id; }).length;
      const lodgings = trip.lodgings
        .filter(function (l) { return l.cityId === c.city.id; })
        .sort(function (a, b) { return a.checkInDay - b.checkInDay; });
      const rows = lodgings.map(lodgingRow).join('') + items.map(function (i) { return itemRow(trip, i); }).join('');
      return `
        <section class="card card--list city">
          <div class="city__head">
            ${avatar('places', 'avatar--accent')}
            <div class="city__title">
              <h2 class="card__title">${esc(c.city.name)}</h2>
              <p class="sub num">장소 ${c.count}개 · 완료 ${c.doneCount} · ${money(trip, c.cost)}</p>
            </div>
          </div>
          <div class="city__actions">
            <button type="button" class="btn btn--tonal btn--small" data-action="add-item" data-city-id="${esc(c.city.id)}">${icon('plus')}장소</button>
            <button type="button" class="btn btn--tonal btn--small" data-action="add-lodging" data-city-id="${esc(c.city.id)}">${icon('bed')}숙소</button>
            <span class="city__spacer"></span>
            <button type="button" class="btn btn--tonal btn--small btn--icon" data-action="rename-city" data-city-id="${esc(c.city.id)}" aria-label="${esc(c.city.name)} 이름 변경" title="이름 변경">${icon('edit')}</button>
            <button type="button" class="btn btn--tonal btn--small btn--icon btn--danger" data-action="delete-city" data-city-id="${esc(c.city.id)}" aria-label="${esc(c.city.name)} 삭제" title="삭제">${icon('trash')}</button>
          </div>
          ${rows ? `<ul class="list">${rows}</ul>` : ''}
          ${items.length ? '' : `<p class="sub city__empty">${total ? '필터에 맞는 장소가 없습니다.' : '아직 추가한 장소가 없습니다.'}</p>`}
        </section>`;
    }).join('');

    return `
      <section class="card">
        <h2 class="card__title">도시 추가</h2>
        <form class="inline-form" data-form="city-add" novalidate>
          <div class="field inline-form__field">
            <label class="visually-hidden" for="city-add-name">새 도시 이름</label>
            <input class="input" id="city-add-name" name="name" type="text" maxlength="${State.MAX_CITY}" placeholder="도시 이름 (예: 도쿄)" autocomplete="off" aria-describedby="city-add-name-error">
            <p class="field__error" id="city-add-name-error" data-error-for="name"></p>
          </div>
          <button type="submit" class="btn btn--primary">추가</button>
        </form>
        ${trip.cities.length ? '' : '<p class="sub">먼저 여행할 도시를 추가하세요. 일정은 도시에 연결됩니다.</p>'}
      </section>
      ${trip.cities.length ? filterChips(ui.filter) : ''}
      ${sections}`;
  }

  function lodgingRow(l) {
    return `
      <li class="list-row lodging-row">
        <button type="button" class="list-row__btn" data-action="edit-lodging" data-id="${esc(l.id)}">
          ${avatar(Utils.LODGING_ICON, 'avatar--lodging')}
          <span class="list-row__text">
            <span class="list-row__title">${esc(l.name)}</span>
            <span class="list-row__sub num">숙소 · ${Utils.formatDayList(range(l.checkInDay, l.checkOutDay))} · ${l.checkOutDay - l.checkInDay}박</span>
            <span class="list-row__badges">${locationBadge(l.location)}</span>
          </span>
          ${icon('chevron', 'chev')}
        </button>
      </li>`;
  }

  function itemRow(trip, item) {
    const cat = Utils.category(item.category);
    return `
      <li class="list-row item-row cat--${cat.id}${statusClass(item)}">
        <button type="button" class="list-row__btn" data-action="edit-item" data-id="${esc(item.id)}">
          ${avatar(cat.icon, 'cat--' + cat.id)}
          <span class="list-row__text">
            <span class="list-row__title item-row__title">${esc(item.title)}</span>
            <span class="list-row__sub num">${cat.label} · Day ${item.day} · ${Utils.formatHourRange(item.startHour, item.durationHours)} · ${money(trip, item.estimatedCost)}</span>
            <span class="list-row__badges">${badges(item)}</span>
          </span>
        </button>
        ${checkbox(item)}
      </li>`;
  }

  /* ---------- 최종 일정표 ---------- */

  function finalView(trip) {
    const s = Stats.tripSummary(trip);
    const days = Utils.totalDays(trip.nights);
    const byDay = Stats.byDay(trip);

    const cityCards = trip.cities.map(function (city) {
      const places = Stats.mapPlaces(trip, city.id);
      const unlocated = Stats.unlocatedCount(trip, city.id);
      const legend = places.length
        ? `<ul class="list place-legend">${places.map(function (p) {
            const cls = p.kind === 'lodging' ? 'avatar--lodging' : 'cat--' + Utils.category(p.category).id;
            return `
              <li class="list-row">
                ${avatar(TripMap.placeIcon(p), cls)}
                <span class="list-row__text"><span class="list-row__title">${esc(p.name)}</span></span>
                <span class="list-row__end place-legend__days${p.kind === 'lodging' ? ' is-lodging' : ''}">${esc(p.dayLabel)}</span>
              </li>`;
          }).join('')}</ul>`
        : '<p class="sub">위치를 지정한 장소가 없습니다. 도시·장소 탭에서 일정이나 숙소를 열어 위치를 지정하세요.</p>';
      return `
        <section class="card card--list">
          <h2 class="card__title card__title--icon">${icon('places')}${esc(city.name)}</h2>
          <div class="city-map" role="region" data-city-map="${esc(city.id)}" aria-label="${esc(city.name)} 지도"><p class="sub map-msg">지도를 불러오는 중…</p></div>
          ${legend}
          ${unlocated && places.length ? `<p class="sub card__note">위치를 지정하지 않은 ${unlocated}곳은 지도에서 빠졌습니다.</p>` : ''}
        </section>`;
    }).join('');

    let dayCards = '';
    for (let d = 1; d <= days; d++) {
      const items = Stats.sortItems(trip.items.filter(function (i) { return i.day === d && Stats.isActive(i); }));
      const lodging = Stats.lodgingsOnDay(trip, d);
      const lodgingLines =
        lodging.checkingOut.map(function (l) { return `<p class="final-day__lodging is-out">${icon(Utils.LODGING_ICON)}체크아웃 · ${esc(l.name)}</p>`; }).join('') +
        lodging.staying.map(function (l) { return `<p class="final-day__lodging">${icon(Utils.LODGING_ICON)}숙박 · ${esc(l.name)}</p>`; }).join('');
      const rows = items.length
        ? `<ul class="final-day__list">${items.map(function (item) {
            const cat = Utils.category(item.category);
            return `
              <li class="final-row cat--${cat.id}${statusClass(item)}">
                <span class="final-row__time num">${Utils.formatHourRange(item.startHour, item.durationHours)}</span>
                <span class="final-row__title">${icon(cat.icon)}<span>${item.status === 'done' ? '<span class="visually-hidden">완료</span>✓ ' : ''}${esc(item.title)}</span></span>
                <span class="final-row__cost num">${money(trip, item.estimatedCost)}</span>
              </li>`;
          }).join('')}</ul>`
        : '<p class="sub">일정 없음</p>';
      dayCards += `
        <section class="card final-day">
          <h3 class="final-day__title">Day ${d} <span class="sub">${esc(Utils.formatDisplayDate(Utils.dateOfDay(trip.startDate, d)))}</span></h3>
          ${lodgingLines}
          ${rows}
          <p class="final-day__total num">합계 ${money(trip, byDay[d - 1].cost)}</p>
        </section>`;
    }

    return `
      <section class="card final-head">
        <p class="sub">${esc(trip.country)} · ${Utils.durationLabel(trip.nights)} · ${tripDates(trip)}</p>
        <p class="big-money num">${money(trip, s.cost)}</p>
        <p class="sub">일정 ${s.count}개의 예상 비용${s.budget != null ? ` · 예산 ${money(trip, s.budget)}` : ''}</p>
        <p class="sub card__note">아래 "이미지로 저장"을 누르면 지도가 들어간 일정표 이미지를 저장합니다. 지도는 인터넷 연결이 있어야 표시되고, 취소한 일정은 빠집니다.</p>
      </section>
      ${trip.cities.length ? cityCards : '<section class="card"><p class="sub">도시·장소 탭에서 도시를 추가하면 도시 지도가 표시됩니다.</p></section>'}
      <h2 class="section-heading">전체 일정</h2>
      ${dayCards}`;
  }

  /* ---------- 설정 ---------- */

  function listButton(action, iconName, title, sub, danger) {
    return `
      <li class="list-row">
        <button type="button" class="list-row__btn${danger ? ' is-danger' : ''}" data-action="${action}">
          ${avatar(iconName, danger ? 'avatar--danger' : 'avatar--accent')}
          <span class="list-row__text"><span class="list-row__title">${title}</span>${sub ? `<span class="list-row__sub">${sub}</span>` : ''}</span>
          ${icon('chevron', 'chev')}
        </button>
      </li>`;
  }

  function switchRow(id, action, title, sub, checked, disabled) {
    return `
      <li class="list-row list-row--switch${disabled ? ' is-disabled' : ''}">
        <label class="list-row__text" for="${id}"><span class="list-row__title">${title}</span>${sub ? `<span class="list-row__sub">${sub}</span>` : ''}</label>
        <input type="checkbox" role="switch" class="switch" id="${id}" data-action="${action}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
      </li>`;
  }

  function settings(trip, ui, env) {
    const followSystem = ui.theme === 'system';
    const dark = followSystem ? env.prefersDark : ui.theme === 'dark';
    return `
      <section class="card">
        <h2 class="card__title">여행 정보</h2>
        <form class="form" data-form="trip-edit" novalidate>
          ${tripFields('edit', trip)}
          <p class="sub">출발일을 바꾸면 일정은 같은 일차(Day)에 그대로 남고 날짜만 바뀝니다.</p>
          <button type="submit" class="btn btn--primary btn--block">변경 내용 저장</button>
        </form>
      </section>
      <section class="card card--list">
        <h2 class="card__title">화면</h2>
        <ul class="list">
          ${switchRow('theme-system', 'theme-system', '시스템 설정 따르기', '기기의 다크 모드 설정에 맞춥니다.', followSystem, false)}
          ${switchRow('theme-dark', 'theme-dark', '다크 모드', followSystem ? '시스템 설정 따르기를 끄면 직접 고를 수 있습니다.' : '', dark, followSystem)}
        </ul>
      </section>
      <section class="card card--list">
        <h2 class="card__title">여행</h2>
        <ul class="list">
          ${listButton('open-trips', 'trips', '여행 목록', '저장한 여행을 바꿔 가며 봅니다.')}
          ${listButton('new-trip', 'plus', '새 여행 만들기', '')}
        </ul>
      </section>
      <section class="card card--list">
        <h2 class="card__title">백업</h2>
        <p class="sub card__note">데이터는 이 브라우저에만 저장됩니다. 브라우저 데이터를 지우기 전이나 다른 기기로 옮길 때 백업 파일을 내보내세요.</p>
        <ul class="list">
          ${listButton('export', 'download', 'JSON 내보내기', '모든 여행을 파일로 저장합니다.')}
          ${listButton('import', 'final', 'JSON 가져오기', '백업 파일로 현재 데이터를 바꿉니다.')}
        </ul>
      </section>
      <section class="card card--list">
        <ul class="list">
          ${listButton('delete-trip', 'trash', '이 여행 삭제', '이 여행과 모든 도시·일정·숙소를 삭제합니다. 되돌릴 수 없습니다.', true)}
        </ul>
      </section>`;
  }

  /* ---------- 바텀 시트 내용 ---------- */

  function modalShell(tag, attrs, title, body, footer) {
    return `
      <${tag} class="modal" ${attrs}>
        <div class="sheet__handle" aria-hidden="true"></div>
        <header class="modal__header">
          <h2 class="modal__title" id="modal-title">${title}</h2>
          <button type="button" class="icon-btn" data-action="close-modal" aria-label="닫기">${icon('close')}</button>
        </header>
        <div class="modal__body">${body}</div>
        ${footer ? `<footer class="modal__footer">${footer}</footer>` : ''}
      </${tag}>`;
  }

  function locationText(location) {
    return location
      ? `${icon('places')}<span>${esc(location.label || '지도에서 지정한 위치')}</span>`
      : '<span>위치 미지정 · 지정하면 일정표 지도에 표시됩니다.</span>';
  }

  function locationField(location) {
    const loc = location || null;
    return `
      <fieldset class="field fieldset loc" data-loc>
        <legend class="field__label">위치 (선택)</legend>
        <input type="hidden" name="lat" value="${loc ? loc.lat : ''}">
        <input type="hidden" name="lng" value="${loc ? loc.lng : ''}">
        <input type="hidden" name="locLabel" value="${loc ? esc(loc.label) : ''}">
        <p class="loc__current" data-loc-current>${locationText(loc)}</p>
        <div class="loc__search">
          <label class="visually-hidden" for="loc-query">위치 검색어</label>
          <input class="input" id="loc-query" type="text" enterkeyhint="search" data-loc-query placeholder="장소 이름으로 검색 (비우면 제목으로)" autocomplete="off">
          <button type="button" class="btn btn--tonal" data-action="loc-search" aria-label="위치 검색">${icon('search')}<span>검색</span></button>
        </div>
        <div class="loc__results" data-loc-results aria-live="polite"></div>
        <div class="loc__map" data-loc-map><p class="sub map-msg">지도를 불러오는 중…</p></div>
        <div class="loc__foot">
          <p class="field__hint">지도를 누르면 그 위치로 지정됩니다. 검색어는 OpenStreetMap 검색 서버로 전송됩니다.</p>
          <button type="button" class="btn btn--text btn--small" data-action="loc-clear">위치 지우기</button>
        </div>
        <p class="field__error" data-error-for="location"></p>
      </fieldset>`;
  }

  // 검색 결과 · 지도 클릭으로 위치가 정해졌을 때 (폼을 다시 그리지 않고 바꾼다)
  function setLocation(form, loc) {
    form.elements.lat.value = loc ? loc.lat : '';
    form.elements.lng.value = loc ? loc.lng : '';
    form.elements.locLabel.value = loc ? loc.label : '';
    form.querySelector('[data-loc-current]').innerHTML = locationText(loc);
    clearFieldError(form, 'location');
  }

  // state: { loading } | { error } | { results: [{ label }] }
  function locationResults(form, state) {
    const box = form.querySelector('[data-loc-results]');
    if (state.loading) box.innerHTML = '<p class="sub">검색 중…</p>';
    else if (state.error) box.innerHTML = `<p class="warn">${esc(state.error)}</p>`;
    else if (!state.results.length) box.innerHTML = '<p class="sub">검색 결과가 없습니다. 다른 이름(현지어·영어)으로 찾거나 지도를 눌러 지정하세요.</p>';
    else {
      box.innerHTML = '<ul class="loc__list">' + state.results.map(function (r, i) {
        return `<li><button type="button" class="loc__result" data-action="loc-pick" data-index="${i}">${icon('places')}<span>${esc(r.label)}</span></button></li>`;
      }).join('') + '</ul>';
    }
  }

  function mapMessage(el, message) {
    el.innerHTML = `<p class="sub map-msg">${esc(message)}</p>`;
  }

  function sheetFooter(deleteAction, submitLabel) {
    return (deleteAction ? `<button type="button" class="btn btn--text btn--danger" data-action="${deleteAction}">${icon('trash')}삭제</button>` : '') +
      '<span class="modal__spacer"></span>' +
      '<button type="button" class="btn btn--tonal" data-action="close-modal">취소</button>' +
      `<button type="submit" class="btn btn--primary">${submitLabel}</button>`;
  }

  // item: 수정할 항목(없으면 추가), defaults: { day, startHour, cityId }
  function itemModal(trip, item, defaults) {
    const v = item || {
      title: '', category: Utils.DEFAULT_CATEGORY, day: defaults.day, startHour: defaults.startHour,
      durationHours: 1, cityId: defaults.cityId, estimatedCost: '', memo: '', status: 'planned', location: null
    };
    const id = function (name) { return 'item-' + name; };

    const hourOptions = [];
    for (let h = 0; h < 24; h++) hourOptions.push({ value: h, label: Utils.formatHour(h) });
    const durationOptions = [];
    for (let n = 1; n <= 24; n++) durationOptions.push({ value: n, label: n + '시간' });
    const cityOptions = trip.cities.map(function (c) { return { value: c.id, label: c.name }; });

    const categoryRadios = Utils.CATEGORIES.map(function (cat) {
      return `<label class="choice cat--${cat.id}"><input type="radio" name="category" value="${cat.id}"${v.category === cat.id ? ' checked' : ''}>` +
        `<span class="choice__label">${icon(cat.icon)}${cat.label}</span></label>`;
    }).join('');
    const statusRadios = Utils.STATUSES.map(function (s) {
      return `<label class="choice"><input type="radio" name="status" value="${s.id}"${v.status === s.id ? ' checked' : ''}><span class="choice__label">${s.label}</span></label>`;
    }).join('');

    const body =
      field(id('title'), 'title', '장소 / 할 일',
        `<input class="input" id="${id('title')}" name="title" type="text" maxlength="${State.MAX_ITEM_TITLE}" value="${esc(v.title)}" placeholder="예: 센소지 방문" autocomplete="off" aria-describedby="${id('title')}-error">`) +
      `<fieldset class="field fieldset">
        <legend class="field__label">카테고리</legend>
        <div class="choices">${categoryRadios}</div>
        <p class="field__error" data-error-for="category"></p>
      </fieldset>` +
      `<div class="field-row">` +
        field(id('day'), 'day', '일차', `<select class="input" id="${id('day')}" name="day">${options(dayOptions(trip), v.day)}</select>`) +
        field(id('cityId'), 'cityId', '도시', `<select class="input" id="${id('cityId')}" name="cityId">${options(cityOptions, v.cityId)}</select>`) +
      `</div>` +
      `<div class="field-row">` +
        field(id('startHour'), 'startHour', '시작 시간', `<select class="input" id="${id('startHour')}" name="startHour">${options(hourOptions, v.startHour)}</select>`) +
        field(id('durationHours'), 'durationHours', '소요 시간', `<select class="input" id="${id('durationHours')}" name="durationHours" aria-describedby="${id('durationHours')}-error">${options(durationOptions, v.durationHours)}</select>`) +
      `</div>` +
      `<div class="item-hints" data-item-hints aria-live="polite"></div>` +
      field(id('estimatedCost'), 'estimatedCost', `예상 비용 (${esc(trip.currency)})`,
        `<input class="input" id="${id('estimatedCost')}" name="estimatedCost" type="text" inputmode="decimal" data-money value="${esc(Utils.groupDigits(v.estimatedCost))}" placeholder="0" autocomplete="off" aria-describedby="${id('estimatedCost')}-error">` +
          fxHint('estimatedCost', trip, v.estimatedCost),
        '비워 두면 0으로 저장됩니다.') +
      locationField(v.location) +
      field(id('memo'), 'memo', '메모 (선택)',
        `<textarea class="input textarea" id="${id('memo')}" name="memo" rows="3" maxlength="${State.MAX_MEMO}">${esc(v.memo || '')}</textarea>`) +
      (item
        ? `<fieldset class="field fieldset">
             <legend class="field__label">상태</legend>
             <div class="choices">${statusRadios}</div>
             <p class="field__hint">취소한 일정은 진행률과 비용 합계에서 제외됩니다.</p>
           </fieldset>
           ${item.editedAt ? `<p class="sub">변경됨 · 마지막 수정 ${esc(Utils.formatDateTime(item.editedAt))}</p>` : ''}`
        : '');

    const attrs = `data-form="item"${item ? ` data-item-id="${esc(item.id)}"` : ''} novalidate aria-labelledby="modal-title"`;
    return modalShell('form', attrs, item ? '일정 수정' : '일정 추가', body, sheetFooter(item ? 'delete-item' : null, item ? '저장' : '추가'));
  }

  // 시간 범위 안내와 겹치는 일정 경고 (저장은 막지 않는다)
  function updateItemHints(form, trip) {
    const box = form.querySelector('[data-item-hints]');
    const startHour = Number(form.elements.startHour.value);
    const durationHours = Number(form.elements.durationHours.value);
    const day = Number(form.elements.day.value);
    if (startHour + durationHours > 24) {
      box.innerHTML = `<p class="warn">자정(24:00)을 넘길 수 없습니다. 최대 ${24 - startHour}시간까지 가능합니다.</p>`;
      return;
    }
    const overlaps = Stats.findOverlaps(trip, { day: day, startHour: startHour, durationHours: durationHours }, form.getAttribute('data-item-id'));
    let html = `<p class="sub num">${Utils.formatHourRange(startHour, durationHours)} (${durationHours}시간)</p>`;
    if (overlaps.length) {
      const names = overlaps.map(function (i) { return `'${esc(i.title)}'(${Utils.formatHourRange(i.startHour, i.durationHours)})`; }).join(', ');
      html += `<p class="warn">같은 시간에 ${names} 일정이 있습니다. 그래도 저장할 수 있습니다.</p>`;
    }
    box.innerHTML = html;
  }

  // lodging: 수정할 숙소(없으면 추가), defaults: { cityId }
  function lodgingModal(trip, lodging, defaults) {
    const days = Utils.totalDays(trip.nights);
    const v = lodging || { name: '', cityId: defaults.cityId, checkInDay: 1, checkOutDay: days, location: null };
    const dayList = dayOptions(trip);
    const cityOptions = trip.cities.map(function (c) { return { value: c.id, label: c.name }; });
    const body =
      (trip.nights === 0 ? '<p class="warn">당일치기(0박) 여행에는 숙소를 등록할 수 없습니다. 설정에서 숙박 일수를 바꾸세요.</p>' : '') +
      field('lodging-name', 'name', '숙소 이름',
        `<input class="input" id="lodging-name" name="name" type="text" maxlength="${State.MAX_LODGING}" value="${esc(v.name)}" placeholder="예: 난바 오리엔탈 호텔" autocomplete="off" aria-describedby="lodging-name-error">`) +
      field('lodging-cityId', 'cityId', '도시', `<select class="input" id="lodging-cityId" name="cityId">${options(cityOptions, v.cityId)}</select>`) +
      `<div class="field-row">` +
        field('lodging-checkInDay', 'checkInDay', '체크인', `<select class="input" id="lodging-checkInDay" name="checkInDay" aria-describedby="lodging-checkInDay-error">${options(dayList, v.checkInDay)}</select>`) +
        field('lodging-checkOutDay', 'checkOutDay', '체크아웃', `<select class="input" id="lodging-checkOutDay" name="checkOutDay" aria-describedby="lodging-checkOutDay-error">${options(dayList, v.checkOutDay)}</select>`) +
      `</div>` +
      locationField(v.location);
    const attrs = `data-form="lodging"${lodging ? ` data-lodging-id="${esc(lodging.id)}"` : ''} novalidate aria-labelledby="modal-title"`;
    return modalShell('form', attrs, lodging ? '숙소 수정' : '숙소 추가', body, sheetFooter(lodging ? 'delete-lodging' : null, lodging ? '저장' : '추가'));
  }

  // mode: 'add' | 'rename'. then: 도시를 추가한 뒤 이어서 일정 추가를 열 때의 { day, startHour }
  function cityModal(mode, city, then) {
    const isRename = mode === 'rename';
    let attrs = `data-form="${isRename ? 'city-rename' : 'city-add'}" novalidate aria-labelledby="modal-title"`;
    if (isRename) attrs += ` data-city-id="${esc(city.id)}"`;
    if (then) attrs += ` data-then-day="${then.day}"${then.startHour != null ? ` data-then-hour="${then.startHour}"` : ''}`;
    const body =
      (then ? '<p class="sub">일정을 추가하려면 먼저 도시가 필요합니다. 여행할 도시를 추가하세요.</p>' : '') +
      field('city-modal-name', 'name', '도시 이름',
        `<input class="input" id="city-modal-name" name="name" type="text" maxlength="${State.MAX_CITY}" value="${isRename ? esc(city.name) : ''}" placeholder="예: 도쿄" autocomplete="off" aria-describedby="city-modal-name-error">`);
    return modalShell('form', attrs, isRename ? '도시 이름 변경' : '도시 추가', body, sheetFooter(null, isRename ? '저장' : '추가'));
  }

  function tripsModal(data, today) {
    const list = data.trips.map(function (trip) {
      const current = trip.id === data.activeTripId;
      const s = Stats.tripSummary(trip);
      return `
        <li class="list-row">
          <button type="button" class="list-row__btn trip-item${current ? ' is-current' : ''}" data-action="switch-trip" data-id="${esc(trip.id)}"${current ? ' aria-current="true"' : ''}>
            ${avatar('trips', current ? 'avatar--accent-solid' : 'avatar--accent')}
            <span class="list-row__text">
              <span class="list-row__title">${esc(trip.title)}${current ? ' <span class="badge badge--current">현재</span>' : ''}</span>
              <span class="list-row__sub">${esc(trip.country)} · ${Utils.durationLabel(trip.nights)} · ${tripDates(trip)}</span>
              <span class="list-row__sub">${Stats.ddayLabel(Stats.tripPhase(trip, today))} · 진행률 ${s.percent}%</span>
            </span>
          </button>
        </li>`;
    }).join('');
    const footer =
      '<span class="modal__spacer"></span>' +
      `<button type="button" class="btn btn--primary" data-action="new-trip">${icon('plus')}새 여행 만들기</button>`;
    return modalShell('div', '', '여행 목록', `<ul class="list trip-list">${list}</ul>`, footer);
  }

  function tripCreateModal() {
    return modalShell('form', 'data-form="trip-create" novalidate aria-labelledby="modal-title"', '새 여행 만들기',
      `<div class="form">${tripFields('new', null)}</div>`, sheetFooter(null, '여행 만들기'));
  }

  // One UI 대화상자: 제목·내용, 하단에 "취소 | 확인" 텍스트 버튼 (위험한 동작은 빨간색)
  function confirmBox(opts) {
    return `
      <form method="dialog" class="confirm">
        <h2 class="confirm__title" id="confirm-title">${esc(opts.title)}</h2>
        <p class="confirm__message" id="confirm-message">${esc(opts.message)}</p>
        <div class="confirm__actions">
          <button type="submit" class="confirm__btn" value="cancel">취소</button>
          <span class="confirm__divider" aria-hidden="true"></span>
          <button type="submit" class="confirm__btn${opts.danger ? ' is-danger' : ''}" value="ok">${esc(opts.confirmLabel || '확인')}</button>
        </div>
      </form>`;
  }

  /* ---------- 폼 오류 ---------- */

  function showFieldErrors(form, errors) {
    form.querySelectorAll('[data-error-for]').forEach(function (el) {
      const name = el.getAttribute('data-error-for');
      const message = errors[name] || '';
      el.textContent = message;
      const input = form.elements[name];
      // 라디오 그룹(RadioNodeList)은 setAttribute가 없다.
      if (input && typeof input.setAttribute === 'function') input.setAttribute('aria-invalid', message ? 'true' : 'false');
    });
  }

  function clearFieldError(form, name) {
    const el = form.querySelector(`[data-error-for="${name}"]`);
    if (el) el.textContent = '';
    const input = form.elements[name];
    if (input && typeof input.removeAttribute === 'function') input.removeAttribute('aria-invalid');
  }

  /* ---------- 안내 메시지 ---------- */

  function notices(container, list) {
    container.innerHTML = list.map(function (n, i) {
      return `
        <div class="notice notice--${n.type}">
          ${icon('alert', 'notice__icon')}
          <p class="notice__message">${esc(n.message)}</p>
          <button type="button" class="icon-btn notice__close" data-action="dismiss-notice" data-index="${i}" aria-label="안내 닫기">${icon('close')}</button>
        </div>`;
    }).join('');
  }

  return {
    TAB_IDS,
    app,
    updateTripPreview,
    updateFxHints,
    itemModal,
    lodgingModal,
    setLocation,
    locationResults,
    mapMessage,
    updateItemHints,
    cityModal,
    tripsModal,
    tripCreateModal,
    confirmBox,
    showFieldErrors,
    clearFieldError,
    notices
  };
})();

/* 초기화, 이벤트 연결, 모달·확인 창·토스트.
   이벤트는 document에 한 번만 등록하고(이벤트 위임) data-action / data-form으로 구분한다.
   화면을 다시 그려도 리스너가 중복 등록되지 않는다. 모달(<dialog>)은 #app 밖에 있어 다시 그려도 유지된다. */
(function () {
  'use strict';

  const root = document.getElementById('app');
  const noticeRoot = document.getElementById('notices');
  const modal = document.getElementById('modal');
  const confirmEl = document.getElementById('confirm');
  const toastEl = document.getElementById('toast');
  const importInput = document.getElementById('import-file');

  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const CATEGORY_IDS = Utils.CATEGORIES.map(function (c) { return c.id; });
  const THEMES = ['system', 'light', 'dark'];
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  let ui = { tab: 'dashboard', day: 1, filter: [], theme: 'system' };
  let notices = [];
  let lastFocus = null;
  let lastFocusKey = null; // 모달을 연 요소가 다시 그려져 사라졌을 때 같은 요소를 찾는 선택자
  let toastTimer = null;
  let pendingConfirm = null; // 열려 있는 확인 창의 resolve
  let locationSearchResults = []; // 입력 창의 위치 검색 결과 (loc-pick이 번호로 고른다)
  let blockClicksUntil = 0; // 창을 닫은 직후 아래 화면이 눌리지 않게 막는 시각
  let exporting = false;
  // 도시 위치 검색 상태: { pending } 진행 중 / { notFound } 결과 없음(다시 찾지 않음) / { retryAt } 연결 실패(잠시 뒤 다시)
  const cityGeocode = {};
  const CITY_RETRY_MS = 30000;
  const CLICK_BLOCK_MS = 350;

  function normalizeUi(saved) {
    return {
      tab: Render.TAB_IDS.indexOf(saved.tab) >= 0 ? saved.tab : 'dashboard',
      day: Number.isInteger(saved.day) && saved.day >= 1 ? saved.day : 1,
      filter: Array.isArray(saved.filter) ? saved.filter.filter(function (c) { return CATEGORY_IDS.indexOf(c) >= 0; }) : [],
      theme: THEMES.indexOf(saved.theme) >= 0 ? saved.theme : 'system'
    };
  }

  function prefersDark() {
    return !!(darkQuery && darkQuery.matches);
  }

  function env() {
    const now = new Date();
    return { today: Utils.formatDate(now), nowHour: now.getHours(), nowMinute: now.getMinutes(), prefersDark: prefersDark() };
  }

  // 실제로 쓸 테마(light/dark)를 data-theme에 넣는다. 'system'이면 기기 설정을 따른다.
  // (CSS는 :root[data-theme="dark"] 하나만 두면 된다)
  function applyTheme() {
    const theme = ui.theme === 'system' ? (prefersDark() ? 'dark' : 'light') : ui.theme;
    document.documentElement.setAttribute('data-theme', theme);
  }

  /* ---------- 큰 제목 접기 (One UI 앱바) ---------- */

  // 스크롤한 만큼 0~1 값을 --collapse로 넘겨, CSS가 큰 제목을 흐리게 하고 작은 앱바 제목을 보이게 한다.
  let collapseFrame = 0;

  function updateCollapse() {
    collapseFrame = 0;
    const heroEl = root.querySelector('.hero');
    const appbarEl = root.querySelector('.appbar');
    if (!heroEl || !appbarEl) return;
    const distance = Math.max(1, heroEl.offsetHeight - appbarEl.offsetHeight);
    const value = Math.min(1, Math.max(0, window.scrollY / distance));
    document.documentElement.style.setProperty('--collapse', value.toFixed(3));
  }

  function onScroll() {
    if (!collapseFrame) collapseFrame = requestAnimationFrame(updateCollapse);
  }

  function activeTrip() {
    return State.getActiveTrip();
  }

  // 다시 그려도 같은 요소에 포커스를 되돌리기 위한 선택자. (#app은 통째로 다시 그려진다)
  const FOCUS_ATTRS = ['data-action', 'data-id', 'data-tab', 'data-day', 'data-hour', 'data-category', 'data-city-id'];

  function focusSelector(el) {
    if (!el || !el.getAttribute || el === document.body) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = FOCUS_ATTRS.filter(function (a) { return el.hasAttribute(a); })
      .map(function (a) { return '[' + a + '="' + CSS.escape(el.getAttribute(a)) + '"]'; });
    return parts.length ? parts.join('') : null;
  }

  function restoreFocus(selector) {
    const el = selector && root.querySelector(selector);
    if (el) el.focus({ preventScroll: true });
  }

  // 입력하다 만 폼(data-dirty)의 값을 기억했다가 다시 그린 뒤 되돌린다. (테마 변경·자동 갱신 등)
  function saveDrafts() {
    return Array.prototype.map.call(root.querySelectorAll('form[data-dirty]'), function (form) {
      const values = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name || el.type === 'hidden') return;
        if (el.type === 'radio') { if (el.checked) values[el.name] = el.value; } else values[el.name] = el.value;
      });
      return { kind: form.getAttribute('data-form'), values: values };
    });
  }

  function restoreDrafts(drafts) {
    drafts.forEach(function (d) {
      const form = root.querySelector('form[data-form="' + d.kind + '"]');
      if (!form) return;
      Object.keys(d.values).forEach(function (name) {
        const field = form.elements[name];
        if (!field) return;
        if (field instanceof RadioNodeList) Array.prototype.forEach.call(field, function (r) { r.checked = r.value === d.values[name]; });
        else field.value = d.values[name];
      });
      form.dataset.dirty = '1';
      if (form.querySelector('[data-trip-preview]')) Render.updateTripPreview(form);
    });
  }

  function render() {
    const active = document.activeElement;
    const focusKey = root.contains(active) ? focusSelector(active) : null;
    const drafts = saveDrafts();
    TripMap.destroyCityMaps();
    const trip = activeTrip();
    Render.app(root, trip, ui, env());
    restoreDrafts(drafts);
    if (focusKey) restoreFocus(focusKey);
    if (trip && ui.tab === 'final') mountFinalMaps(trip);
    updateCollapse();
  }

  function setUi(patch) {
    const tabChanged = patch.tab !== undefined && patch.tab !== ui.tab;
    ui = Object.assign({}, ui, patch);
    TripStorage.saveUi(ui);
    applyTheme();
    render();
    // 다른 탭으로 가면 그 탭의 큰 제목부터 보이게 한다.
    if (tabChanged) window.scrollTo(0, 0);
  }

  function currentDay(trip) {
    return Math.min(ui.day, Utils.totalDays(trip.nights));
  }

  /* ---------- 안내 · 토스트 ---------- */

  // 안내는 페이지 맨 위에 남기고, 스크롤 위치와 상관없이 보이도록 토스트로도 띄운다.
  // 같은 안내가 다시 오면 맨 뒤로 옮긴다(토스트로 다시 알림).
  function addNotice(notice) {
    notices = notices.filter(function (n) { return n.message !== notice.message; });
    notices.push(notice);
    Render.notices(noticeRoot, notices);
    toast(notice.message, 5000);
  }

  // 보이게 한 뒤에 글자를 넣어야 화면 낭독기가 놓치지 않는다.
  function toast(message, duration) {
    toastEl.hidden = false;
    toastEl.textContent = '';
    requestAnimationFrame(function () { toastEl.textContent = message; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, duration || 2500);
  }

  /* ---------- 모달 · 확인 창 ---------- */

  function openModal(html) {
    if (!modal.open) {
      lastFocus = document.activeElement;
      lastFocusKey = focusSelector(lastFocus);
    }
    TripMap.destroyPicker();
    locationSearchResults = [];
    modal.innerHTML = html;
    if (!modal.open) modal.showModal();
    const first = modal.querySelector('.modal__body input:not([type="radio"]):not([type="checkbox"]), .modal__body select, .modal__body textarea, .modal__body button');
    if (first) first.focus();
  }

  function closeModal() {
    if (!modal.open) return;
    modal.close();
    // 저장 버튼을 두 번 누르면 두 번째 클릭이 시트 아래 화면(하단 탭 등)에 눌리는 것을 막는다.
    blockClicksUntil = Date.now() + CLICK_BLOCK_MS;
  }

  function settleConfirm() {
    const resolve = pendingConfirm;
    pendingConfirm = null;
    if (resolve) resolve(confirmEl.returnValue === 'ok');
  }

  // 반환: Promise<boolean>. ESC·바깥 클릭·취소는 false.
  // close 이벤트는 늦게 도착하므로, 이전 확인 창의 이벤트가 오기 전에 새 창이 열리면
  // 이전 결과(returnValue는 닫힐 때 바로 정해진다)로 먼저 끝내 둔다.
  function confirmDialog(opts) {
    settleConfirm();
    return new Promise(function (resolve) {
      pendingConfirm = resolve;
      confirmEl.innerHTML = Render.confirmBox(opts);
      confirmEl.returnValue = '';
      confirmEl.showModal();
      // 실수로 Enter를 눌러도 삭제되지 않도록 취소 버튼에 먼저 포커스한다.
      confirmEl.querySelector('button[value="cancel"]').focus();
    });
  }

  /* ---------- 일정 ---------- */

  // 그날 마지막 일정이 끝나는 시각, 없으면 09시
  function suggestHour(trip, day) {
    const end = trip.items
      .filter(function (i) { return i.day === day && Stats.isActive(i); })
      .reduce(function (max, i) { return Math.max(max, i.startHour + i.durationHours); }, -1);
    return end >= 0 && end < 24 ? end : 9;
  }

  // 그날 마지막 일정의 도시, 없으면 첫 번째 도시
  function suggestCity(trip, day) {
    const items = Stats.sortItems(trip.items.filter(function (i) { return i.day === day; }));
    return items.length ? items[items.length - 1].cityId : trip.cities[0].id;
  }

  function openItemAdd(opts) {
    const trip = activeTrip();
    const day = opts.day || currentDay(trip);
    if (!trip.cities.length) {
      openModal(Render.cityModal('add', null, { day: day, startHour: opts.hour }));
      return;
    }
    openModal(Render.itemModal(trip, null, {
      day: day,
      startHour: opts.hour != null ? opts.hour : suggestHour(trip, day),
      cityId: opts.cityId || suggestCity(trip, day)
    }));
    Render.updateItemHints(modal.querySelector('form'), trip);
    setupLocationPicker(modal.querySelector('form'), trip, null);
  }

  function openItemEdit(itemId) {
    const trip = activeTrip();
    const item = Utils.findById(trip.items, itemId);
    if (!item) return;
    openModal(Render.itemModal(trip, item));
    Render.updateItemHints(modal.querySelector('form'), trip);
    setupLocationPicker(modal.querySelector('form'), trip, item.location);
  }

  /* ---------- 숙소 ---------- */

  function openLodgingAdd(cityId) {
    const trip = activeTrip();
    openModal(Render.lodgingModal(trip, null, { cityId: cityId || trip.cities[0].id }));
    setupLocationPicker(modal.querySelector('form'), trip, null);
  }

  function openLodgingEdit(lodgingId) {
    const trip = activeTrip();
    const lodging = Utils.findById(trip.lodgings, lodgingId);
    if (!lodging) return;
    openModal(Render.lodgingModal(trip, lodging));
    setupLocationPicker(modal.querySelector('form'), trip, lodging.location);
  }

  async function deleteLodgingFromModal() {
    const trip = activeTrip();
    const lodgingId = modal.querySelector('form').getAttribute('data-lodging-id');
    const lodging = Utils.findById(trip.lodgings, lodgingId);
    if (!lodging) return;
    const ok = await confirmDialog({ title: '숙소 삭제', message: `'${lodging.name}' 숙소를 삭제할까요?`, confirmLabel: '삭제', danger: true });
    if (!ok) return;
    State.deleteLodging(trip.id, lodgingId);
    closeModal();
    toast('숙소를 삭제했습니다.');
  }

  /* ---------- 지도 · 위치 ---------- */

  // 도시 위치(지도 중심)가 없으면 "도시, 나라"로 검색해 저장한다.
  // 반환: { loc } 또는 { reason: 'notFound' | 'offline' }. 같은 도시를 동시에 두 번 찾지 않는다.
  function ensureCityLocation(trip, city) {
    if (city.location) return Promise.resolve({ loc: city.location });
    const memo = cityGeocode[city.id];
    if (memo && memo.pending) return memo.pending;
    if (memo && memo.notFound) return Promise.resolve({ reason: 'notFound' });
    if (memo && memo.retryAt > Date.now()) return Promise.resolve({ reason: 'offline' });
    const pending = TripMap.geocode(city.name + ', ' + trip.country, 1).then(function (results) {
      if (!results.length) {
        cityGeocode[city.id] = { notFound: true };
        return { reason: 'notFound' };
      }
      delete cityGeocode[city.id];
      const loc = { lat: results[0].lat, lng: results[0].lng, label: results[0].label };
      State.setCityLocation(trip.id, city.id, loc);
      return { loc: loc };
    }, function () {
      cityGeocode[city.id] = { retryAt: Date.now() + CITY_RETRY_MS };
      return { reason: 'offline' };
    });
    cityGeocode[city.id] = { pending: pending };
    return pending;
  }

  function mountFinalMaps(trip) {
    root.querySelectorAll('[data-city-map]').forEach(async function (el) {
      const city = Utils.findById(trip.cities, el.getAttribute('data-city-map'));
      if (!city) return;
      const places = Stats.mapPlaces(trip, city.id);
      try {
        // 지점이 없으면 도시 위치로 보여준다. (위치를 저장하면 화면이 다시 그려지며 이 함수가 다시 불린다)
        const found = places.length ? { loc: city.location } : await ensureCityLocation(trip, city);
        const center = found.loc;
        if (!places.length && !center) {
          if (el.isConnected) {
            Render.mapMessage(el, found.reason === 'offline'
              ? '지도를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'
              : '도시 위치를 찾지 못했습니다. 장소에 위치를 지정하면 지도가 표시됩니다.');
          }
          return;
        }
        if (!el.isConnected) return;
        await TripMap.mountCityMap(el, places, center);
      } catch (e) {
        if (el.isConnected) Render.mapMessage(el, '지도를 불러오지 못했습니다. 인터넷 연결을 확인하세요. 장소 목록은 아래에 있습니다.');
      }
    });
  }

  function formCity(form, trip) {
    return Utils.findById(trip.cities, form.elements.cityId.value);
  }

  async function setupLocationPicker(form, trip, location) {
    const el = form.querySelector('[data-loc-map]');
    if (!el) return;
    const city = formCity(form, trip);
    try {
      const picker = await TripMap.mountPicker(el, location, city && city.location, function (loc) {
        Render.setLocation(form, { lat: loc.lat, lng: loc.lng, label: '지도에서 지정한 위치' });
      });
      // 도시 위치를 아직 모르면 찾아서 지도를 그 도시로 옮긴다.
      if (picker && !location && city && !city.location) {
        const found = await ensureCityLocation(trip, city);
        if (found.loc && TripMap.getPicker() === picker) picker.setCenter(found.loc);
      }
    } catch (e) {
      if (el.isConnected) Render.mapMessage(el, '지도를 불러오지 못했습니다(인터넷 연결 필요). 검색으로는 위치를 지정할 수 있습니다.');
    }
  }

  async function searchLocation(form) {
    const trip = activeTrip();
    const queryInput = form.querySelector('[data-loc-query]');
    const titleInput = form.elements.title || form.elements.name;
    const query = (queryInput.value || (titleInput ? titleInput.value : '')).trim();
    if (!query) {
      Render.locationResults(form, { error: '검색할 장소 이름을 입력하세요.' });
      queryInput.focus();
      return;
    }
    // 같은 검색어가 진행 중이면 다시 보내지 않는다. (한글 입력 Enter가 두 번 오는 경우 등)
    if (form.dataset.searching === query) return;
    form.dataset.searching = query;
    const city = formCity(form, trip);
    Render.locationResults(form, { loading: true });
    try {
      // 도시·나라를 붙여 먼저 찾고, 없으면 검색어만으로 다시 찾는다.
      let results = await TripMap.geocode([query, city && city.name, trip.country].filter(Boolean).join(', '));
      if (!results.length) results = await TripMap.geocode(query);
      if (!form.isConnected) return;
      locationSearchResults = results;
      Render.locationResults(form, { results: results });
    } catch (e) {
      if (form.isConnected) Render.locationResults(form, { error: '검색하지 못했습니다. 인터넷 연결을 확인하세요.' });
    } finally {
      delete form.dataset.searching;
    }
  }

  function pickLocation(form, index) {
    const loc = locationSearchResults[index];
    if (!loc) return;
    Render.setLocation(form, loc);
    const picker = TripMap.getPicker();
    if (picker) picker.setMarker(loc, true);
    form.querySelector('[data-loc-results]').innerHTML = '';
  }

  function clearLocation(form) {
    Render.setLocation(form, null);
    const picker = TripMap.getPicker();
    if (picker) picker.setMarker(null);
  }

  async function exportPng(button) {
    const trip = activeTrip();
    // 저장 중에 화면이 다시 그려지면 새 버튼은 활성 상태라 버튼만으로는 막을 수 없다.
    if (exporting || button.disabled) return;
    exporting = true;
    button.disabled = true;
    // 아이콘은 두고 글자만 바꾼다.
    const labelEl = button.querySelector('[data-label]') || button;
    const label = labelEl.textContent;
    labelEl.textContent = '이미지를 만드는 중…';
    try {
      const result = await ItineraryImage.download(trip);
      toast(result.mapFailed ? '지도 없이 일정표 이미지를 저장했습니다. (인터넷 연결 필요)' : '일정표 이미지를 저장했습니다.');
    } catch (e) {
      addNotice({ type: 'error', message: '이미지를 저장하지 못했습니다: ' + e.message });
    } finally {
      exporting = false;
      if (button.isConnected) {
        button.disabled = false;
        labelEl.textContent = label;
      }
    }
  }

  async function deleteItemFromModal() {
    const trip = activeTrip();
    const itemId = modal.querySelector('form').getAttribute('data-item-id');
    const item = Utils.findById(trip.items, itemId);
    if (!item) return;
    const ok = await confirmDialog({
      title: '일정 삭제',
      message: `'${item.title}' 일정을 삭제할까요?`,
      confirmLabel: '삭제',
      danger: true
    });
    if (!ok) return;
    State.deleteItem(trip.id, itemId);
    closeModal();
    toast('일정을 삭제했습니다.');
  }

  /* ---------- 도시 · 여행 ---------- */

  async function deleteCity(cityId) {
    const trip = activeTrip();
    const city = Utils.findById(trip.cities, cityId);
    if (!city) return;
    const count = State.countInCity(trip.id, cityId);
    const parts = [];
    if (count.items) parts.push(`일정 ${count.items}개`);
    if (count.lodgings) parts.push(`숙소 ${count.lodgings}개`);
    const linked = parts.join('와 ');
    const ok = await confirmDialog({
      title: '도시 삭제',
      message: linked
        ? `'${city.name}'을(를) 삭제하면 연결된 ${linked}도 함께 삭제됩니다. 삭제할까요?`
        : `'${city.name}'을(를) 삭제할까요?`,
      confirmLabel: '삭제',
      danger: true
    });
    if (!ok) return;
    State.deleteCity(trip.id, cityId);
    toast(linked ? `도시와 ${linked}를 삭제했습니다.` : '도시를 삭제했습니다.');
  }

  async function deleteTrip() {
    const trip = activeTrip();
    const ok = await confirmDialog({
      title: '여행 삭제',
      message: `'${trip.title}' 여행과 도시 ${trip.cities.length}개, 일정 ${trip.items.length}개, 숙소 ${trip.lodgings.length}개를 모두 삭제합니다. 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      danger: true
    });
    if (!ok) return;
    State.deleteTrip(trip.id);
    setUi({ tab: 'dashboard', day: 1 });
    toast('여행을 삭제했습니다.');
  }

  /* ---------- 백업 ---------- */

  function exportData() {
    const blob = new Blob([JSON.stringify(State.getData(), null, 2)], { type: 'application/json' });
    Utils.downloadBlob(blob, 'travel-planner-backup-' + Utils.today() + '.json');
    toast('백업 파일을 내보냈습니다.');
  }

  function onImportFile() {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      addNotice({ type: 'error', message: '가져오기 실패: 파일이 너무 큽니다. (최대 5MB)' });
      return;
    }
    const reader = new FileReader();
    reader.onerror = function () {
      addNotice({ type: 'error', message: '가져오기 실패: 파일을 읽지 못했습니다.' });
    };
    reader.onload = async function () {
      const result = TripStorage.parseImport(reader.result);
      if (!result.ok) {
        addNotice({ type: 'error', message: '가져오기 실패: ' + result.message });
        return;
      }
      const ok = await confirmDialog({
        title: '백업 가져오기',
        message: `현재 데이터(여행 ${State.getData().trips.length}개)를 백업 파일의 데이터(여행 ${result.data.trips.length}개)로 바꿉니다. 현재 데이터는 사라집니다.`,
        confirmLabel: '가져오기',
        danger: true
      });
      if (!ok) return;
      State.replaceData(result.data);
      setUi({ tab: 'dashboard', day: 1 });
      toast('백업을 가져왔습니다.');
    };
    reader.readAsText(file);
  }

  /* ---------- 클릭 ---------- */

  function onClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');
    const trip = activeTrip();

    switch (action) {
      case 'select-tab':
        setUi({ tab: target.getAttribute('data-tab') });
        break;
      case 'select-day':
      case 'go-day':
        setUi({ tab: 'timeline', day: Number(target.getAttribute('data-day')) });
        break;
      case 'toggle-filter': {
        const cat = target.getAttribute('data-category');
        const filter = ui.filter.indexOf(cat) >= 0
          ? ui.filter.filter(function (c) { return c !== cat; })
          : ui.filter.concat(cat);
        // 4개를 모두 고르면 "전체"와 같으므로 비운다.
        setUi({ filter: filter.length === CATEGORY_IDS.length ? [] : filter });
        break;
      }
      case 'clear-filter':
        setUi({ filter: [] });
        break;
      case 'add-item':
        openItemAdd({
          day: target.hasAttribute('data-day') ? Number(target.getAttribute('data-day')) : null,
          hour: target.hasAttribute('data-hour') ? Number(target.getAttribute('data-hour')) : null,
          cityId: target.getAttribute('data-city-id')
        });
        break;
      case 'edit-item':
        openItemEdit(id);
        break;
      case 'toggle-done':
        State.toggleItemDone(trip.id, id);
        break;
      case 'delete-item':
        deleteItemFromModal();
        break;
      case 'add-lodging':
        openLodgingAdd(target.getAttribute('data-city-id'));
        break;
      case 'edit-lodging':
        openLodgingEdit(id);
        break;
      case 'delete-lodging':
        deleteLodgingFromModal();
        break;
      case 'loc-search':
        searchLocation(target.form);
        break;
      case 'loc-pick':
        pickLocation(target.closest('form'), Number(target.getAttribute('data-index')));
        break;
      case 'loc-clear':
        clearLocation(target.form);
        break;
      case 'export-png':
        exportPng(target);
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'rename-city': {
        const city = Utils.findById(trip.cities, target.getAttribute('data-city-id'));
        if (city) openModal(Render.cityModal('rename', city));
        break;
      }
      case 'delete-city':
        deleteCity(target.getAttribute('data-city-id'));
        break;
      case 'open-trips':
        openModal(Render.tripsModal(State.getData(), env().today));
        break;
      case 'switch-trip':
        if (id !== State.getData().activeTripId) {
          State.setActiveTrip(id);
          setUi({ day: 1 });
          toast('여행을 바꿨습니다.');
        }
        closeModal();
        break;
      case 'new-trip':
        openModal(Render.tripCreateModal());
        break;
      case 'export':
        exportData();
        break;
      case 'import':
        importInput.click();
        break;
      case 'delete-trip':
        deleteTrip();
        break;
      case 'theme-system':
        // 끌 때는 지금 보이는 모드를 그대로 직접 설정으로 남긴다.
        setUi({ theme: target.checked ? 'system' : (prefersDark() ? 'dark' : 'light') });
        break;
      case 'theme-dark':
        setUi({ theme: target.checked ? 'dark' : 'light' });
        break;
      case 'dismiss-notice':
        notices.splice(Number(target.getAttribute('data-index')), 1);
        Render.notices(noticeRoot, notices);
        break;
    }
  }

  /* ---------- 폼 제출 ---------- */

  function formValues(form) {
    const values = {};
    new FormData(form).forEach(function (value, key) { values[key] = value; });
    return values;
  }

  function showErrors(form, errors) {
    Render.showFieldErrors(form, errors);
    const first = form.querySelector('[aria-invalid="true"]');
    if (first) first.focus();
  }

  async function onSubmit(e) {
    const form = e.target;
    const kind = form.getAttribute('data-form');
    if (!kind) return; // 확인 창(method="dialog")은 브라우저 기본 동작에 맡긴다.
    e.preventDefault();
    if (form.dataset.busy) return; // 확인 창을 기다리는 동안 중복 제출 방지
    form.dataset.busy = '1';
    // 저장에 성공해 다시 그릴 때는 입력값을 되돌리지 않도록 표시를 지운다. 실패해서 폼이 남아 있으면 다시 붙인다.
    const wasDirty = form.dataset.dirty;
    delete form.dataset.dirty;
    try {
      await handleSubmit(kind, form);
    } finally {
      delete form.dataset.busy;
      if (wasDirty && form.isConnected && root.contains(form)) form.dataset.dirty = '1';
    }
  }

  async function handleSubmit(kind, form) {
    const trip = activeTrip();
    const values = formValues(form);

    switch (kind) {
      case 'trip-create': {
        const result = State.createTrip(values);
        if (!result.ok) return showErrors(form, result.errors);
        closeModal();
        // PRD 5.1 흐름: 여행 생성 → 도시 추가 → 타임라인
        setUi({ tab: 'places', day: 1 });
        const cityInput = document.getElementById('city-add-name');
        if (cityInput) cityInput.focus();
        toast('여행을 만들었습니다. 이제 도시를 추가하세요.');
        return;
      }
      case 'trip-edit': {
        const v = State.validateTripInput(values, trip);
        if (Object.keys(v.errors).length) return showErrors(form, v.errors);
        const outside = State.countOutsideRange(trip.id, v.value.nights);
        if (outside.items || outside.lodgingsRemoved || outside.lodgingsShortened) {
          const effects = [];
          if (outside.items) effects.push(`일정 ${outside.items}개 삭제`);
          if (outside.lodgingsRemoved) effects.push(`숙소 ${outside.lodgingsRemoved}개 삭제`);
          if (outside.lodgingsShortened) effects.push(`숙소 ${outside.lodgingsShortened}개의 체크아웃을 마지막 날로 변경`);
          const ok = await confirmDialog({
            title: '여행 기간 줄이기',
            message: `${Utils.durationLabel(v.value.nights)}로 바꾸면 기간을 벗어나는 항목이 바뀝니다: ${effects.join(', ')}. 계속할까요?`,
            confirmLabel: '삭제하고 저장',
            danger: true
          });
          if (!ok) return;
        }
        // 통화를 바꾸면 새 통화의 소수 자릿수에 맞지 않는 금액을 반올림한다.
        const toRound = State.countCostsToRound(trip.id, v.value.currency);
        if (toRound) {
          const ok = await confirmDialog({
            title: '통화 바꾸기',
            message: `${v.value.currency}는 소수점 ${Utils.currencyDecimals(v.value.currency)}자리까지 쓰므로, 금액 ${toRound}개를 반올림합니다. 계속할까요?`,
            confirmLabel: '반올림하고 저장'
          });
          if (!ok) return;
        }
        const result = State.updateTrip(trip.id, values);
        if (!result.ok) return showErrors(form, result.errors);
        const done = [];
        if (result.removedCount) done.push(`일정 ${result.removedCount}개 삭제`);
        if (result.lodgingsRemoved) done.push(`숙소 ${result.lodgingsRemoved}개 삭제`);
        if (result.lodgingsShortened) done.push(`숙소 ${result.lodgingsShortened}개 체크아웃 변경`);
        if (result.rounded) done.push(`금액 ${result.rounded}개 반올림`);
        toast(done.length ? `저장했습니다. (${done.join(', ')})` : '여행 정보를 저장했습니다.');
        return;
      }
      case 'city-add': {
        const result = State.addCity(trip.id, values.name);
        if (!result.ok) return showErrors(form, result.errors);
        if (form.hasAttribute('data-then-day')) {
          // 일정 추가 중 도시가 없어서 열린 경우: 바로 일정 추가로 이어간다.
          openItemAdd({
            day: Number(form.getAttribute('data-then-day')),
            hour: form.hasAttribute('data-then-hour') ? Number(form.getAttribute('data-then-hour')) : null,
            cityId: result.city.id
          });
        } else {
          const input = document.getElementById('city-add-name');
          if (input) input.focus();
        }
        toast(`'${result.city.name}'을(를) 추가했습니다.`);
        return;
      }
      case 'city-rename': {
        const result = State.renameCity(trip.id, form.getAttribute('data-city-id'), values.name);
        if (!result.ok) return showErrors(form, result.errors);
        closeModal();
        toast('도시 이름을 바꿨습니다.');
        return;
      }
      case 'lodging': {
        const lodgingId = form.getAttribute('data-lodging-id');
        const result = lodgingId ? State.updateLodging(trip.id, lodgingId, values) : State.addLodging(trip.id, values);
        if (!result.ok) return showErrors(form, result.errors);
        closeModal();
        toast(lodgingId ? '숙소를 저장했습니다.' : '숙소를 추가했습니다.');
        return;
      }
      case 'item': {
        const itemId = form.getAttribute('data-item-id');
        const result = itemId ? State.updateItem(trip.id, itemId, values) : State.addItem(trip.id, values);
        if (!result.ok) return showErrors(form, result.errors);
        closeModal();
        const savedDay = Number(values.day);
        if (ui.tab === 'timeline' && savedDay !== ui.day) setUi({ day: savedDay });
        toast(Stats.tripSummary(activeTrip()).overBudget
          ? '저장했습니다. 예상 비용이 예산을 초과했습니다.'
          : itemId ? '일정을 저장했습니다.' : '일정을 추가했습니다.');
        return;
      }
    }
  }

  /* ---------- 입력 중 ---------- */

  // 금액 입력칸(data-money)에 치는 대로 천 단위 쉼표를 넣는다. 커서는 같은 숫자 뒤에 둔다.
  function formatMoneyInput(input) {
    const before = input.value;
    const digitsBefore = before.slice(0, input.selectionStart).replace(/[^\d.]/g, '').length;
    const after = Utils.groupDigits(before);
    if (after === before) return;
    input.value = after;
    let pos = 0;
    for (let seen = 0; pos < after.length && seen < digitsBefore; pos++) {
      if (/[\d.]/.test(after[pos])) seen++;
    }
    input.setSelectionRange(pos, pos);
  }

  function onInput(e) {
    const form = e.target.form;
    if (!form || !form.hasAttribute('data-form')) return;
    form.dataset.dirty = '1';
    const name = e.target.name;
    if (e.target.hasAttribute('data-money')) formatMoneyInput(e.target);
    // 통화가 바뀌면 기존 환율은 다른 통화 쌍의 값이므로 비운다. ("100엔 = 920" 그대로 "1달러 = 920"이 되지 않게)
    if ((name === 'currency' || name === 'convertCurrency') && form.elements.convertRate) form.elements.convertRate.value = '';
    if (form.querySelector('[data-fx-hint]')) Render.updateFxHints(form, activeTrip());
    Render.clearFieldError(form, name);
    if ((name === 'startDate' || name === 'nights') && form.querySelector('[data-trip-preview]')) {
      Render.updateTripPreview(form);
    }
    if (form.getAttribute('data-form') === 'item' && (name === 'day' || name === 'startHour' || name === 'durationHours')) {
      Render.clearFieldError(form, 'durationHours');
      Render.updateItemHints(form, activeTrip());
    }
  }

  /* ---------- 시작 ---------- */

  function init() {
    // 안드로이드에서는 시스템 글꼴(갤럭시는 One UI 글꼴)을 먼저 쓰도록 CSS에 알린다. (style.css의 --font-sans 참고)
    if (/Android/i.test(navigator.userAgent)) document.documentElement.setAttribute('data-platform', 'android');

    const loaded = TripStorage.load();
    State.init(loaded.data);
    ui = normalizeUi(TripStorage.loadUi());
    applyTheme();

    // 데이터가 바뀌면: (저장 실패 시 안내) → 다시 그리기
    State.subscribe(function (saveResult) {
      if (saveResult && !saveResult.ok) addNotice({ type: 'error', message: saveResult.message });
      render();
    });

    // 창을 닫은 직후의 클릭은 아래 화면에 전달하지 않는다. (캡처 단계에서 기본 동작까지 막음)
    document.addEventListener('click', function (e) {
      if (Date.now() < blockClicksUntil && !modal.contains(e.target) && !confirmEl.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !e.target.matches('[data-loc-query]')) return;
      e.preventDefault();
      // 한글 입력 중(조합 중) Enter는 마지막 글자가 아직 확정되지 않았을 수 있다.
      const form = e.target.form;
      if (e.isComposing) setTimeout(function () { searchLocation(form); }, 0);
      else searchLocation(form);
    });
    importInput.addEventListener('change', onImportFile);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // 시스템 설정 따르기일 때, 기기의 다크 모드가 바뀌면 설정 화면의 스위치 상태를 맞춘다.
    if (darkQuery && darkQuery.addEventListener) {
      darkQuery.addEventListener('change', function () {
        if (ui.theme !== 'system') return;
        applyTheme();
        render();
      });
    }

    // 바깥(배경) 클릭으로 닫기: 누르기 시작한 곳과 뗀 곳이 모두 배경일 때만.
    // (안에서 드래그하다 바깥에서 놓으면 click이 대화상자에서 일어나므로 시작 위치를 따로 본다)
    onBackdropClick(modal, closeModal);
    onBackdropClick(confirmEl, function () { confirmEl.close('cancel'); });
    confirmEl.addEventListener('close', function () {
      if (confirmEl.open) return; // 늦게 도착한 이전 창의 이벤트
      blockClicksUntil = Date.now() + CLICK_BLOCK_MS;
      settleConfirm();
      confirmEl.innerHTML = '';
    });
    // close 이벤트는 비동기로 늦게 도착한다. 그 사이에 새 모달이 열렸다면 지우지 않는다.
    modal.addEventListener('close', function () {
      if (modal.open) return;
      TripMap.destroyPicker();
      modal.innerHTML = '';
      // 연 요소가 다시 그려져 사라졌으면 같은 항목의 새 요소로 포커스를 돌려준다.
      if (lastFocus && lastFocus.isConnected) lastFocus.focus();
      else restoreFocus(lastFocusKey);
      lastFocus = null;
      lastFocusKey = null;
    });

    // 현재 시각선·다음 일정·D-day를 1분마다 갱신한다. 창이 열려 있거나 입력 중이면 건너뛰고,
    // 지도가 다시 만들어지는 일정표 탭과 입력 폼이 있는 설정 탭은 갱신하지 않는다.
    setInterval(function () {
      if (document.hidden || modal.open || confirmEl.open || !activeTrip()) return;
      if (ui.tab === 'final' || ui.tab === 'settings') return;
      const a = document.activeElement;
      if (a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox') return;
      render();
    }, 60000);

    if (loaded.notice) addNotice(loaded.notice);
    render();
  }

  function onBackdropClick(dialog, close) {
    let downOnBackdrop = false;
    dialog.addEventListener('pointerdown', function (e) { downOnBackdrop = e.target === dialog; });
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog && downOnBackdrop) close();
      downOnBackdrop = false;
    });
  }

  init();
})();

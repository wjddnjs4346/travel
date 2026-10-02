/* 앱 데이터와 데이터 변경 함수. 데이터는 반드시 이 파일의 함수로만 바꾼다.
   모든 변경은 commit()을 거쳐 저장 → 구독자(화면 다시 그리기) 순서로 처리된다.
   검증 함수는 { 필드이름: 오류 메시지 }를 반환하고, 변경 함수는 { ok, errors? ... }를 반환한다. */
const State = (function () {
  'use strict';

  const MAX_NIGHTS = 90;
  const MAX_TITLE = 50;
  const MAX_COUNTRY = 30;
  const MAX_CITY = 30;
  const MAX_ITEM_TITLE = 60;
  const MAX_MEMO = 500;
  const MAX_LODGING = 60;
  const MAX_LOC_LABEL = 300;

  let data = null;
  const listeners = [];

  function init(initialData) {
    data = initialData;
    ensureActiveTrip();
  }

  // activeTripId가 없는 여행을 가리키면 첫 번째 여행으로 맞춘다.
  function ensureActiveTrip() {
    if (!findTrip(data.activeTripId)) data.activeTripId = data.trips.length ? data.trips[0].id : null;
  }

  function getData() {
    return data;
  }

  function findTrip(id) {
    return Utils.findById(data.trips, id);
  }

  function getActiveTrip() {
    return findTrip(data.activeTripId);
  }

  // fn(saveResult): saveResult는 TripStorage.save()의 반환값
  function subscribe(fn) {
    listeners.push(fn);
  }

  function commit(mutate) {
    mutate(data);
    ensureActiveTrip();
    const result = TripStorage.save(data);
    listeners.forEach(function (fn) { fn(result); });
    return result;
  }

  // 여행 안의 무엇이든 바뀌면 여행의 updatedAt을 갱신한다.
  function touch(trip) {
    trip.updatedAt = Utils.nowIso();
  }

  function hasErrors(errors) {
    return Object.keys(errors).length > 0;
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function parseIntStrict(value) {
    const t = text(value);
    return /^\d+$/.test(t) ? Number(t) : null;
  }

  // 폼의 lat / lng / locLabel → { value: 위치 또는 null } 또는 { error }
  function parseLocationInput(input) {
    const lat = text(input.lat);
    const lng = text(input.lng);
    if (!lat && !lng) return { value: null };
    const loc = { lat: Number(lat), lng: Number(lng), label: text(input.locLabel).slice(0, MAX_LOC_LABEL) };
    return Utils.isValidLocation(loc) ? { value: loc } : { error: '위치 값이 올바르지 않습니다. 다시 지정하세요.' };
  }

  /* ---------- 여행 ---------- */

  // 반환: { errors, value } — value는 저장할 형태로 정리된 값
  function validateTripInput(input, current) {
    const errors = {};
    const title = text(input.title);
    const country = text(input.country);
    const nights = parseIntStrict(input.nights);
    const currency = input.currency;

    if (!title) errors.title = '여행 제목을 입력하세요.';
    else if (title.length > MAX_TITLE) errors.title = '여행 제목은 ' + MAX_TITLE + '자 이내로 입력하세요.';

    if (!country) errors.country = '여행 나라를 입력하세요.';
    else if (country.length > MAX_COUNTRY) errors.country = '나라 이름은 ' + MAX_COUNTRY + '자 이내로 입력하세요.';

    if (!Utils.isValidDate(input.startDate)) errors.startDate = '출발일을 선택하세요.';

    if (nights === null) errors.nights = '숙박 일수를 0 이상의 정수로 입력하세요. (당일치기는 0)';
    else if (nights > MAX_NIGHTS) errors.nights = '숙박 일수는 최대 ' + MAX_NIGHTS + '박까지 입력할 수 있습니다.';

    const validCurrency = Utils.CURRENCIES.some(function (c) { return c.code === currency; });
    if (!validCurrency) errors.currency = '통화를 선택하세요.';

    let budget = null;
    if (validCurrency) {
      const parsed = Utils.parseMoney(input.budget, currency, true);
      if (parsed.error) errors.budget = parsed.error;
      else budget = parsed.value;
    }

    // 환산 통화·환율 (F-4.7). 폼에 없으면(코드에서 부를 때) 기존 값을 유지하고, 새 여행은 엔화로 시작한다.
    let convertCurrency = input.convertCurrency;
    let convertRate = null;
    if (convertCurrency === undefined) {
      convertCurrency = current ? current.convertCurrency : (currency === 'JPY' ? null : 'JPY');
      convertRate = current ? current.convertRate : null;
    } else {
      if (!convertCurrency || convertCurrency === currency) convertCurrency = null;
      else if (!Utils.CURRENCIES.some(function (c) { return c.code === convertCurrency; })) errors.convertCurrency = '환산 통화를 선택하세요.';
      const rate = convertCurrency ? Utils.parseRate(input.convertRate, convertCurrency) : null;
      if (rate && rate.error) errors.convertRate = rate.error;
      else convertRate = rate;
    }

    return {
      errors: errors,
      value: {
        title: title, country: country, startDate: input.startDate, nights: nights, currency: currency, budget: budget,
        convertCurrency: convertCurrency, convertRate: convertRate
      }
    };
  }

  function createTrip(input) {
    const v = validateTripInput(input);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };

    const now = Utils.nowIso();
    const trip = Object.assign({ id: Utils.uid('trip') }, v.value, {
      cities: [],
      items: [],
      lodgings: [],
      createdAt: now,
      updatedAt: now
    });
    commit(function (d) {
      d.trips.push(trip);
      d.activeTripId = trip.id;
    });
    return { ok: true, trip: trip };
  }

  // 숙박 일수를 nights로 바꿨을 때 영향받는 일정·숙소 수 (PRD F-1.4)
  // items: 삭제될 일정, lodgingsRemoved: 삭제될 숙소(체크인이 마지막 날 이후), lodgingsShortened: 체크아웃이 당겨질 숙소
  function countOutsideRange(tripId, nights) {
    const trip = findTrip(tripId);
    const days = Utils.totalDays(nights);
    if (!trip) return { items: 0, lodgingsRemoved: 0, lodgingsShortened: 0 };
    return {
      items: trip.items.filter(function (i) { return i.day > days; }).length,
      lodgingsRemoved: trip.lodgings.filter(function (l) { return l.checkInDay >= days; }).length,
      lodgingsShortened: trip.lodgings.filter(function (l) { return l.checkInDay < days && l.checkOutDay > days; }).length
    };
  }

  // 통화를 currency로 바꿀 때 소수 자릿수가 맞지 않아 반올림해야 하는 일정 금액 수
  function countCostsToRound(tripId, currency) {
    const trip = findTrip(tripId);
    if (!trip || trip.currency === currency) return 0;
    return trip.items.filter(function (i) { return Utils.roundMoney(i.estimatedCost, currency) !== i.estimatedCost; }).length;
  }

  // 기간을 벗어나는 일정·숙소는 삭제되고, 걸치는 숙소는 체크아웃을 마지막 날로 당긴다.
  // 통화가 바뀌면 일정 금액을 새 통화 자릿수로 반올림한다(그래야 합계가 맞고 수정도 막히지 않는다).
  // 호출 전에 countOutsideRange·countCostsToRound로 사용자 확인을 받는다.
  function updateTrip(tripId, input) {
    const trip = findTrip(tripId);
    if (!trip) return { ok: false, errors: {} };
    const v = validateTripInput(input, trip);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };

    const days = Utils.totalDays(v.value.nights);
    const outside = countOutsideRange(tripId, v.value.nights);
    const rounded = countCostsToRound(tripId, v.value.currency);
    commit(function () {
      Object.assign(trip, v.value);
      trip.items = trip.items.filter(function (i) { return i.day <= days; });
      trip.items.forEach(function (i) { i.estimatedCost = Utils.roundMoney(i.estimatedCost, trip.currency); });
      trip.lodgings = trip.lodgings.filter(function (l) { return l.checkInDay < days; });
      trip.lodgings.forEach(function (l) { l.checkOutDay = Math.min(l.checkOutDay, days); });
      touch(trip);
    });
    return {
      ok: true,
      removedCount: outside.items,
      lodgingsRemoved: outside.lodgingsRemoved,
      lodgingsShortened: outside.lodgingsShortened,
      rounded: rounded
    };
  }

  function deleteTrip(tripId) {
    commit(function (d) {
      d.trips = d.trips.filter(function (t) { return t.id !== tripId; });
    });
  }

  function setActiveTrip(tripId) {
    if (!findTrip(tripId) || data.activeTripId === tripId) return;
    commit(function (d) { d.activeTripId = tripId; });
  }

  // JSON 가져오기: 전체 데이터를 바꾼다. 검증은 TripStorage.parseImport에서 끝난 상태로 받는다.
  function replaceData(newData) {
    commit(function (d) {
      d.version = newData.version;
      d.trips = newData.trips;
      d.activeTripId = newData.activeTripId;
    });
  }

  /* ---------- 도시 ---------- */

  function validateCityName(trip, name, excludeId) {
    const errors = {};
    const value = text(name);
    if (!value) errors.name = '도시 이름을 입력하세요.';
    else if (value.length > MAX_CITY) errors.name = '도시 이름은 ' + MAX_CITY + '자 이내로 입력하세요.';
    else if (trip.cities.some(function (c) { return c.id !== excludeId && c.name.toLowerCase() === value.toLowerCase(); })) {
      errors.name = '이미 추가한 도시입니다.';
    }
    return { errors: errors, value: value };
  }

  function addCity(tripId, name) {
    const trip = findTrip(tripId);
    if (!trip) return { ok: false, errors: {} };
    const v = validateCityName(trip, name);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };
    const city = { id: Utils.uid('city'), name: v.value, location: null };
    commit(function () {
      trip.cities.push(city);
      touch(trip);
    });
    return { ok: true, city: city };
  }

  function renameCity(tripId, cityId, name) {
    const trip = findTrip(tripId);
    const city = trip && Utils.findById(trip.cities, cityId);
    if (!city) return { ok: false, errors: {} };
    const v = validateCityName(trip, name, cityId);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };
    commit(function () {
      city.name = v.value;
      touch(trip);
    });
    return { ok: true };
  }

  // 반환: { items, lodgings } — 도시를 지우면 함께 지워지는 수
  function countInCity(tripId, cityId) {
    const trip = findTrip(tripId);
    if (!trip) return { items: 0, lodgings: 0 };
    return {
      items: trip.items.filter(function (i) { return i.cityId === cityId; }).length,
      lodgings: trip.lodgings.filter(function (l) { return l.cityId === cityId; }).length
    };
  }

  // 도시에 연결된 일정·숙소도 함께 삭제된다. 호출 전에 countInCity로 사용자 확인을 받는다.
  function deleteCity(tripId, cityId) {
    const trip = findTrip(tripId);
    if (!trip) return;
    commit(function () {
      trip.cities = trip.cities.filter(function (c) { return c.id !== cityId; });
      trip.items = trip.items.filter(function (i) { return i.cityId !== cityId; });
      trip.lodgings = trip.lodgings.filter(function (l) { return l.cityId !== cityId; });
      touch(trip);
    });
  }

  // 지도 중심으로 쓰는 도시 위치. 사용자가 입력하지 않고 도시 이름 검색 결과로 자동 저장된다.
  function setCityLocation(tripId, cityId, location) {
    const trip = findTrip(tripId);
    const city = trip && Utils.findById(trip.cities, cityId);
    if (!city || !Utils.isValidLocation(location)) return;
    commit(function () {
      city.location = location;
    });
  }

  /* ---------- 일정 항목 ---------- */

  const EDIT_FIELDS = ['day', 'startHour', 'durationHours', 'cityId', 'title', 'category', 'estimatedCost', 'memo', 'location'];

  // 빈 값(undefined·null·'')은 같은 것으로 보고 비교한다. 위치처럼 객체인 값도 비교한다.
  function sameValue(a, b) {
    const norm = function (v) { return v === undefined || v === null || v === '' ? null : v; };
    return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  }

  function validateItemInput(trip, input) {
    const errors = {};
    const days = Utils.totalDays(trip.nights);
    const day = parseIntStrict(input.day);
    const startHour = parseIntStrict(input.startHour);
    const durationHours = parseIntStrict(input.durationHours);
    const title = text(input.title);
    const memo = text(input.memo);
    const category = input.category || Utils.DEFAULT_CATEGORY;
    const status = input.status || 'planned';

    if (day === null || day < 1 || day > days) errors.day = '일차를 선택하세요.';
    if (startHour === null || startHour > 23) errors.startHour = '시작 시간을 선택하세요.';
    if (durationHours === null || durationHours < 1) errors.durationHours = '소요 시간을 선택하세요.';
    else if (startHour !== null && startHour + durationHours > 24) {
      errors.durationHours = '자정(24:00)을 넘길 수 없습니다. 최대 ' + (24 - startHour) + '시간까지 가능합니다.';
    }
    if (!Utils.findById(trip.cities, input.cityId)) errors.cityId = '도시를 선택하세요.';

    if (!title) errors.title = '장소 또는 할 일을 입력하세요.';
    else if (title.length > MAX_ITEM_TITLE) errors.title = MAX_ITEM_TITLE + '자 이내로 입력하세요.';

    if (!Utils.CATEGORIES.some(function (c) { return c.id === category; })) errors.category = '카테고리를 선택하세요.';
    if (!Utils.STATUSES.some(function (s) { return s.id === status; })) errors.status = '상태를 선택하세요.';

    const cost = Utils.parseMoney(input.estimatedCost, trip.currency, false);
    if (cost.error) errors.estimatedCost = cost.error;

    if (memo.length > MAX_MEMO) errors.memo = '메모는 ' + MAX_MEMO + '자 이내로 입력하세요.';

    const location = parseLocationInput(input);
    if (location.error) errors.location = location.error;

    return {
      errors: errors,
      value: {
        day: day, startHour: startHour, durationHours: durationHours, cityId: input.cityId,
        title: title, category: category, estimatedCost: cost.value, memo: memo, status: status,
        location: location.value || null
      }
    };
  }

  function addItem(tripId, input) {
    const trip = findTrip(tripId);
    if (!trip) return { ok: false, errors: {} };
    const v = validateItemInput(trip, input);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };
    const now = Utils.nowIso();
    const item = Object.assign({ id: Utils.uid('item') }, v.value, { editedAt: null, createdAt: now, updatedAt: now });
    commit(function () {
      trip.items.push(item);
      touch(trip);
    });
    return { ok: true, item: item };
  }

  // 상태 외의 내용(시간·장소·비용 등)이 바뀌면 editedAt을 남겨 "변경됨"으로 표시한다. (PRD F-5.5)
  function updateItem(tripId, itemId, input) {
    const trip = findTrip(tripId);
    const item = trip && Utils.findById(trip.items, itemId);
    if (!item) return { ok: false, errors: {} };
    const v = validateItemInput(trip, input);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };
    const edited = EDIT_FIELDS.some(function (f) { return !sameValue(item[f], v.value[f]); });
    commit(function () {
      const now = Utils.nowIso();
      Object.assign(item, v.value);
      if (edited) item.editedAt = now;
      item.updatedAt = now;
      touch(trip);
    });
    return { ok: true, edited: edited };
  }

  function deleteItem(tripId, itemId) {
    const trip = findTrip(tripId);
    if (!trip) return;
    commit(function () {
      trip.items = trip.items.filter(function (i) { return i.id !== itemId; });
      touch(trip);
    });
  }

  // 예정 ↔ 완료 전환. 취소 항목은 수정 화면에서 상태를 바꾼다.
  function toggleItemDone(tripId, itemId) {
    const trip = findTrip(tripId);
    const item = trip && Utils.findById(trip.items, itemId);
    if (!item || item.status === 'cancelled') return;
    commit(function () {
      item.status = item.status === 'done' ? 'planned' : 'done';
      item.updatedAt = Utils.nowIso();
      touch(trip);
    });
  }

  /* ---------- 숙소 ---------- */

  function validateLodgingInput(trip, input) {
    const errors = {};
    const days = Utils.totalDays(trip.nights);
    const name = text(input.name);
    const checkInDay = parseIntStrict(input.checkInDay);
    const checkOutDay = parseIntStrict(input.checkOutDay);

    if (!name) errors.name = '숙소 이름을 입력하세요.';
    else if (name.length > MAX_LODGING) errors.name = MAX_LODGING + '자 이내로 입력하세요.';
    if (!Utils.findById(trip.cities, input.cityId)) errors.cityId = '도시를 선택하세요.';

    if (trip.nights === 0) errors.checkInDay = '당일치기 여행에는 숙소를 등록할 수 없습니다.';
    else if (checkInDay === null || checkInDay < 1 || checkInDay >= days) errors.checkInDay = '체크인 일차를 선택하세요.';
    else if (checkOutDay === null || checkOutDay <= checkInDay || checkOutDay > days) errors.checkOutDay = '체크아웃은 체크인 다음 날 이후여야 합니다.';

    const location = parseLocationInput(input);
    if (location.error) errors.location = location.error;

    return {
      errors: errors,
      value: { name: name, cityId: input.cityId, checkInDay: checkInDay, checkOutDay: checkOutDay, location: location.value || null }
    };
  }

  function addLodging(tripId, input) {
    const trip = findTrip(tripId);
    if (!trip) return { ok: false, errors: {} };
    const v = validateLodgingInput(trip, input);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };
    const lodging = Object.assign({ id: Utils.uid('lodging') }, v.value);
    commit(function () {
      trip.lodgings.push(lodging);
      touch(trip);
    });
    return { ok: true, lodging: lodging };
  }

  function updateLodging(tripId, lodgingId, input) {
    const trip = findTrip(tripId);
    const lodging = trip && Utils.findById(trip.lodgings, lodgingId);
    if (!lodging) return { ok: false, errors: {} };
    const v = validateLodgingInput(trip, input);
    if (hasErrors(v.errors)) return { ok: false, errors: v.errors };
    commit(function () {
      Object.assign(lodging, v.value);
      touch(trip);
    });
    return { ok: true };
  }

  function deleteLodging(tripId, lodgingId) {
    const trip = findTrip(tripId);
    if (!trip) return;
    commit(function () {
      trip.lodgings = trip.lodgings.filter(function (l) { return l.id !== lodgingId; });
      touch(trip);
    });
  }

  return {
    MAX_NIGHTS,
    MAX_TITLE,
    MAX_COUNTRY,
    MAX_CITY,
    MAX_ITEM_TITLE,
    MAX_MEMO,
    MAX_LODGING,
    init,
    getData,
    findTrip,
    getActiveTrip,
    subscribe,
    validateTripInput,
    createTrip,
    countOutsideRange,
    countCostsToRound,
    updateTrip,
    deleteTrip,
    setActiveTrip,
    replaceData,
    addCity,
    renameCity,
    countInCity,
    deleteCity,
    setCityLocation,
    validateItemInput,
    addItem,
    updateItem,
    deleteItem,
    toggleItemDone,
    validateLodgingInput,
    addLodging,
    updateLodging,
    deleteLodging
  };
})();

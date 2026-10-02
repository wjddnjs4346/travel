/* localStorage 읽기/쓰기 전담. 다른 파일은 localStorage에 직접 접근하지 않는다.
   (전역 Storage 인터페이스와 이름이 겹치지 않도록 TripStorage로 짓는다) */
const TripStorage = (function () {
  'use strict';

  const DATA_KEY = 'travel-planner:v1';
  const CORRUPTED_KEY = 'travel-planner:corrupted';
  const UI_KEY = 'travel-planner:ui';
  const CURRENT_VERSION = 3;

  const MSG_UNAVAILABLE = '이 브라우저에서는 데이터를 저장할 수 없어 새로고침하면 입력한 내용이 사라집니다. 시크릿 모드이거나 사이트 데이터 저장이 차단되어 있는지 확인하세요.';

  // 손상된 원본을 백업하지 못했을 때, 원본을 덮어쓰지 않도록 저장을 막는다.
  let saveBlocked = false;

  function getLocalStorage() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function createEmptyData() {
    return { version: CURRENT_VERSION, activeTripId: null, trips: [] };
  }

  const isPlainObject = Utils.isPlainObject;

  function isMoney(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0;
  }

  function isValidCity(city) {
    return isPlainObject(city) && typeof city.id === 'string' && typeof city.name === 'string' &&
      Utils.isValidLocation(city.location);
  }

  function hasCity(trip, cityId) {
    return trip.cities.some(function (c) { return c.id === cityId; });
  }

  // 숙소: checkInDay에 들어가서 checkOutDay에 나온다. (1박 이상)
  function isValidLodging(lodging, trip) {
    const days = Utils.totalDays(trip.nights);
    return isPlainObject(lodging) &&
      typeof lodging.id === 'string' &&
      typeof lodging.name === 'string' &&
      hasCity(trip, lodging.cityId) &&
      Number.isInteger(lodging.checkInDay) && lodging.checkInDay >= 1 &&
      Number.isInteger(lodging.checkOutDay) && lodging.checkOutDay > lodging.checkInDay && lodging.checkOutDay <= days &&
      Utils.isValidLocation(lodging.location);
  }

  function isValidItem(item, trip) {
    const days = Utils.totalDays(trip.nights);
    return isPlainObject(item) &&
      typeof item.id === 'string' &&
      hasCity(trip, item.cityId) &&
      Number.isInteger(item.day) && item.day >= 1 && item.day <= days &&
      Number.isInteger(item.startHour) && item.startHour >= 0 && item.startHour <= 23 &&
      Number.isInteger(item.durationHours) && item.durationHours >= 1 && item.startHour + item.durationHours <= 24 &&
      typeof item.title === 'string' &&
      Utils.CATEGORIES.some(function (c) { return c.id === item.category; }) &&
      isMoney(item.estimatedCost) &&
      (item.memo === undefined || typeof item.memo === 'string') &&
      Utils.STATUSES.some(function (s) { return s.id === item.status; }) &&
      (item.editedAt == null || typeof item.editedAt === 'string') &&
      Utils.isValidLocation(item.location);
  }

  // 화면이 깨지지 않을 구조인지 확인한다. 하나라도 어긋나면 전체를 손상으로 본다.
  function isValidTrip(trip) {
    return isPlainObject(trip) &&
      typeof trip.id === 'string' &&
      typeof trip.title === 'string' &&
      typeof trip.country === 'string' &&
      Utils.isValidDate(trip.startDate) &&
      Number.isInteger(trip.nights) && trip.nights >= 0 &&
      Utils.CURRENCIES.some(function (c) { return c.code === trip.currency; }) &&
      (trip.budget == null || isMoney(trip.budget)) &&
      (trip.convertCurrency === null || Utils.CURRENCIES.some(function (c) { return c.code === trip.convertCurrency; })) &&
      (trip.convertRate === null || (typeof trip.convertRate === 'number' && isFinite(trip.convertRate) && trip.convertRate > 0)) &&
      Array.isArray(trip.cities) && trip.cities.every(isValidCity) &&
      Array.isArray(trip.items) && trip.items.every(function (item) { return isValidItem(item, trip); }) &&
      Array.isArray(trip.lodgings) && trip.lodgings.every(function (l) { return isValidLodging(l, trip); });
  }

  // id가 겹치면 삭제·수정이 엉뚱한 항목까지 건드리므로 받지 않는다. (여행 id는 전체에서, 나머지는 여행 안에서)
  function hasUniqueIds(list) {
    const seen = {};
    return list.every(function (x) {
      if (seen[x.id]) return false;
      seen[x.id] = true;
      return true;
    });
  }

  function isValidData(data) {
    return isPlainObject(data) &&
      data.version === CURRENT_VERSION &&
      Array.isArray(data.trips) &&
      data.trips.every(isValidTrip) &&
      hasUniqueIds(data.trips) &&
      data.trips.every(function (t) { return hasUniqueIds(t.cities) && hasUniqueIds(t.items) && hasUniqueIds(t.lodgings); });
  }

  // 금액을 그 여행 통화의 소수 자릿수로 맞춘다. (직접 편집한 백업 등. 맞지 않으면 합계가 어긋나고 수정이 막힌다)
  function normalizeMoney(data) {
    data.trips.forEach(function (t) {
      t.items.forEach(function (i) { i.estimatedCost = Utils.roundMoney(i.estimatedCost, t.currency); });
      if (t.budget != null) t.budget = Utils.roundMoney(t.budget, t.currency);
    });
    return data;
  }

  // 데이터 구조가 바뀌면 여기서 이전 버전을 현재 버전으로 변환한다. (PRD F-8.5)
  function migrate(data) {
    // v1 → v2: 숙소(lodgings)와 지도용 위치(location) 추가
    if (data.version === 1 && Array.isArray(data.trips)) {
      data.trips.forEach(function (trip) {
        if (!isPlainObject(trip)) return;
        if (!Array.isArray(trip.lodgings)) trip.lodgings = [];
        (Array.isArray(trip.cities) ? trip.cities : []).forEach(function (c) {
          if (isPlainObject(c) && c.location === undefined) c.location = null;
        });
        (Array.isArray(trip.items) ? trip.items : []).forEach(function (i) {
          if (isPlainObject(i) && i.location === undefined) i.location = null;
        });
      });
      data.version = 2;
    }
    // v2 → v3: 환산 통화·환율 추가 (처음에는 엔화, 환율은 직접 입력할 때까지 비움)
    if (data.version === 2 && Array.isArray(data.trips)) {
      data.trips.forEach(function (trip) {
        if (!isPlainObject(trip)) return;
        if (trip.convertCurrency === undefined) trip.convertCurrency = trip.currency === 'JPY' ? null : 'JPY';
        if (trip.convertRate === undefined) trip.convertRate = null;
      });
      data.version = 3;
    }
    return data;
  }

  // 버전이 1 이상 현재 이하이면 변환을 시도하고, 변환 결과가 현재 버전·구조에 맞을 때만 반환한다. 아니면 null.
  function migrateAndValidate(parsed) {
    if (!isPlainObject(parsed) || !Number.isInteger(parsed.version) || parsed.version < 1 || parsed.version > CURRENT_VERSION) return null;
    try {
      const migrated = migrate(parsed);
      return isValidData(migrated) ? normalizeMoney(migrated) : null;
    } catch (e) {
      return null;
    }
  }

  function backupCorrupted(ls, raw) {
    try {
      ls.setItem(CORRUPTED_KEY, raw);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isQuotaError(e) {
    return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
  }

  // 반환: { data, notice } — notice는 사용자에게 보여줄 안내 ({ type, message } 또는 null)
  function load() {
    const ls = getLocalStorage();
    let raw;
    try {
      raw = ls ? ls.getItem(DATA_KEY) : undefined;
    } catch (e) {
      raw = undefined;
      // 읽지 못한 원본이 있을 수 있으므로, 쓰기만 되는 환경이어도 덮어쓰지 않는다.
      saveBlocked = true;
    }
    if (raw === undefined) {
      return { data: createEmptyData(), notice: { type: 'error', message: MSG_UNAVAILABLE } };
    }
    if (raw === null) {
      return { data: createEmptyData(), notice: null };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }

    const valid = migrateAndValidate(parsed);
    if (valid) {
      return { data: valid, notice: null };
    }

    if (backupCorrupted(ls, raw)) {
      return {
        data: createEmptyData(),
        notice: {
          type: 'warning',
          message: '저장된 데이터를 읽을 수 없어 빈 상태로 시작합니다. 원본은 브라우저 저장소의 "' + CORRUPTED_KEY + '" 항목에 보관했습니다.'
        }
      };
    }
    saveBlocked = true;
    return {
      data: createEmptyData(),
      notice: {
        type: 'error',
        message: '저장된 데이터를 읽을 수 없고 백업도 하지 못했습니다. 원본을 지키기 위해 이번 실행에서는 저장하지 않습니다.'
      }
    };
  }

  // 반환: { ok: true } 또는 { ok: false, message }
  function save(data) {
    if (saveBlocked) {
      return { ok: false, message: '원본 데이터를 보호하기 위해 저장이 중지된 상태입니다. 변경 내용은 새로고침하면 사라집니다.' };
    }
    const ls = getLocalStorage();
    if (!ls) return { ok: false, message: MSG_UNAVAILABLE };
    try {
      ls.setItem(DATA_KEY, JSON.stringify(data));
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        message: isQuotaError(e)
          ? '브라우저 저장 공간이 부족해 저장하지 못했습니다.'
          : '데이터를 저장하지 못했습니다. 새로고침하면 마지막 변경 내용이 사라질 수 있습니다.'
      };
    }
  }

  // JSON 가져오기 (PRD F-8.4): 파일 내용 → { ok: true, data } 또는 { ok: false, message }
  function parseImport(text) {
    if (!String(text).trim()) return { ok: false, message: '빈 파일입니다.' };
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, message: 'JSON 형식이 아닌 파일입니다.' };
    }
    if (isPlainObject(parsed) && Number.isInteger(parsed.version) && parsed.version > CURRENT_VERSION) {
      return { ok: false, message: '더 최신 버전의 앱에서 만든 백업이라 가져올 수 없습니다.' };
    }
    const valid = migrateAndValidate(parsed);
    if (!valid) {
      return { ok: false, message: '이 앱의 백업 파일이 아니거나 내용이 손상되었습니다.' };
    }
    return { ok: true, data: valid };
  }

  // 마지막으로 보던 탭·일차 같은 화면 상태. 실패해도 앱 동작에는 영향이 없으므로 조용히 넘어간다.
  function loadUi() {
    try {
      const parsed = JSON.parse(getLocalStorage().getItem(UI_KEY));
      return isPlainObject(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveUi(ui) {
    try {
      getLocalStorage().setItem(UI_KEY, JSON.stringify(ui));
    } catch (e) {
      // 무시
    }
  }

  return { CURRENT_VERSION, load, save, parseImport, loadUi, saveUi, createEmptyData };
})();

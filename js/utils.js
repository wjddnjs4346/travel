/* 공용 함수: 날짜 계산, 금액 포맷, id 생성, HTML 이스케이프 */
const Utils = (function () {
  'use strict';

  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  const CURRENCIES = [
    { code: 'KRW', label: '원 (KRW)' },
    { code: 'JPY', label: '엔 (JPY)' },
    { code: 'USD', label: '달러 (USD)' },
    { code: 'EUR', label: '유로 (EUR)' },
    { code: 'CNY', label: '위안 (CNY)' },
    { code: 'TWD', label: '대만 달러 (TWD)' },
    { code: 'THB', label: '바트 (THB)' },
    { code: 'VND', label: '동 (VND)' },
    { code: 'GBP', label: '파운드 (GBP)' }
  ];

  // 타임라인 기본 표시 범위: 06:00 ~ 23:00 슬롯 (endHour는 포함하지 않음).
  // 06시 이전 일정이 있으면 그 날은 그 시각부터 표시한다.
  const TIMELINE = { startHour: 6, endHour: 24 };

  const CATEGORIES = [
    { id: 'sightseeing', label: '관광지', icon: 'landmark' },
    { id: 'food', label: '음식점', icon: 'food' },
    { id: 'shopping', label: '쇼핑', icon: 'bag' },
    { id: 'etc', label: '기타', icon: 'tag' }
  ];
  const DEFAULT_CATEGORY = 'etc';

  const STATUSES = [
    { id: 'planned', label: '예정' },
    { id: 'done', label: '완료' },
    { id: 'cancelled', label: '취소' }
  ];

  const MAX_MONEY = 1e12;

  const LODGING_ICON = 'bed'; // Icons 이름

  function isValidLocation(loc) {
    return loc === null || (
      isPlainObject(loc) &&
      typeof loc.lat === 'number' && isFinite(loc.lat) && loc.lat >= -90 && loc.lat <= 90 &&
      typeof loc.lng === 'number' && isFinite(loc.lng) && loc.lng >= -180 && loc.lng <= 180 &&
      typeof loc.label === 'string'
    );
  }

  function findById(list, id) {
    return list.find(function (x) { return x.id === id; }) || null;
  }

  function category(id) {
    return findById(CATEGORIES, id) || findById(CATEGORIES, DEFAULT_CATEGORY);
  }

  // 파일 저장(JSON 백업·PNG 공용)
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // "YYYY-MM-DD" → 로컬 자정 기준 Date. 존재하지 않는 날짜(2월 30일 등)는 null.
  // new Date("YYYY-MM-DD")는 UTC로 해석되어 날짜가 하루 밀릴 수 있으므로 쓰지 않는다.
  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date;
  }

  function formatDate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function isValidDate(str) {
    return parseDate(str) !== null;
  }

  function addDays(str, days) {
    const date = parseDate(str);
    if (!date) return null;
    date.setDate(date.getDate() + days);
    return formatDate(date);
  }

  function today() {
    return formatDate(new Date());
  }

  function totalDays(nights) {
    return nights + 1;
  }

  function durationLabel(nights) {
    return nights + '박 ' + totalDays(nights) + '일';
  }

  // 출발일 기준 day(1부터)번째 날짜
  function dateOfDay(startDate, day) {
    return addDays(startDate, day - 1);
  }

  function formatDisplayDate(str, withYear) {
    const date = parseDate(str);
    if (!date) return '';
    const text = (date.getMonth() + 1) + '월 ' + date.getDate() + '일 (' + WEEKDAYS[date.getDay()] + ')';
    return withYear ? date.getFullYear() + '년 ' + text : text;
  }

  // a → b 까지의 일수 차이 (둘 다 "YYYY-MM-DD"). 서머타임으로 23·25시간인 날이 있어 반올림한다.
  function daysBetween(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db) return null;
    return Math.round((db - da) / 86400000);
  }

  // [1,2,3,4] → "1~4일차", [1,3] → "1·3일차", [1,2,4] → "1~2·4일차"
  function formatDayList(days) {
    const sorted = days.slice().sort(function (a, b) { return a - b; })
      .filter(function (d, i, arr) { return i === 0 || d !== arr[i - 1]; });
    const parts = [];
    let start = null;
    let prev = null;
    sorted.concat(null).forEach(function (d) {
      if (start !== null && d === prev + 1) {
        prev = d;
        return;
      }
      if (start !== null) parts.push(start === prev ? String(start) : start + '~' + prev);
      start = d;
      prev = d;
    });
    return parts.length ? parts.join('·') + '일차' : '';
  }

  function formatHour(hour) {
    return pad2(hour) + ':00';
  }

  function formatHourRange(startHour, durationHours) {
    return formatHour(startHour) + '–' + formatHour(startHour + durationHours);
  }

  // ISO 시각 → "10월 1일 14:30" (로컬 시간)
  function formatDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ---------- 금액 ---------- */

  const decimalsCache = {};

  // 통화별 소수 자릿수 (KRW·JPY·VND 0, USD·EUR 2 ...)
  function currencyDecimals(code) {
    if (!(code in decimalsCache)) {
      try {
        decimalsCache[code] = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
      } catch (e) {
        decimalsCache[code] = 2;
      }
    }
    return decimalsCache[code];
  }

  // 부동소수 오차(0.1 + 0.2 등)를 통화 자릿수에 맞춰 정리한다.
  function roundMoney(value, code) {
    const f = Math.pow(10, currencyDecimals(code));
    return Math.round(value * f) / f;
  }

  // 사용자가 입력한 금액 문자열 → { value } 또는 { error }. 빈 값은 allowEmpty에 따라 0 또는 null.
  function parseMoney(text, code, allowEmpty) {
    const raw = String(text == null ? '' : text).replace(/[,\s]/g, '');
    if (raw === '') return { value: allowEmpty ? null : 0 };
    if (!/^\d+(\.\d+)?$/.test(raw)) return { error: '0 이상의 숫자로 입력하세요.' };
    const decimals = currencyDecimals(code);
    const fraction = raw.split('.')[1] || '';
    if (fraction.length > decimals) {
      return { error: decimals === 0 ? '이 통화는 소수점 없이 입력하세요.' : '소수점 ' + decimals + '자리까지 입력할 수 있습니다.' };
    }
    const value = Number(raw);
    if (value > MAX_MONEY) return { error: '금액이 너무 큽니다.' };
    return { value: value };
  }

  /* ---------- 환산 (PRD F-4.7) ----------
     trip.convertRate = 환산 통화 1단위가 여행 통화로 얼마인지. (KRW 여행·JPY 환산이면 1엔 = 9.2원 → 9.2) */

  // 환율 입력 단위: 엔·동은 보통 100단위로 말하므로 "100엔 = 920원"처럼 받는다.
  function rateUnit(code) {
    return code === 'JPY' || code === 'VND' ? 100 : 1;
  }

  // "엔 (JPY)" → "엔"
  function currencyName(code) {
    const c = CURRENCIES.find(function (x) { return x.code === code; });
    return c ? c.label.split(' (')[0] : code;
  }

  // 환율 입력 문자열 → 1단위당 값(숫자) 또는 { error }. 빈 값은 null.
  function parseRate(text, convertCurrency) {
    const raw = String(text == null ? '' : text).replace(/[,\s]/g, '');
    if (raw === '') return null;
    if (!/^\d+(\.\d{1,6})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > 1e9) {
      return { error: '0보다 큰 숫자로 입력하세요. (소수점 6자리까지)' };
    }
    return Number((Number(raw) / rateUnit(convertCurrency)).toPrecision(12));
  }

  // 저장된 1단위당 값 → 입력칸에 보여줄 값 ("100엔 = 920원"이면 920)
  function rateInputValue(rate, convertCurrency) {
    return rate ? groupDigits(String(Number((rate * rateUnit(convertCurrency)).toPrecision(12)))) : '';
  }

  // 여행 통화 금액 → 환산 통화 금액. 환산 설정이 없으면 null
  function convert(trip, amount) {
    if (!trip.convertCurrency || !trip.convertRate || trip.convertCurrency === trip.currency) return null;
    return amount / trip.convertRate;
  }

  // "≈ JP¥1,304" 또는 '' (환산하지 않을 때, 0원일 때)
  function formatConverted(trip, amount) {
    const v = convert(trip, Number(amount) || 0);
    return v === null || v === 0 ? '' : '≈ ' + formatMoney(v, trip.convertCurrency);
  }

  // 입력칸용 천 단위 쉼표: "12000.5" → "12,000.5" (숫자와 소수점 외 글자는 지운다)
  function groupDigits(text) {
    const clean = String(text == null ? '' : text).replace(/[^\d.]/g, '');
    const dot = clean.indexOf('.');
    const int = (dot < 0 ? clean : clean.slice(0, dot)).replace(/^0+(?=\d)/, '');
    const frac = dot < 0 ? '' : '.' + clean.slice(dot + 1).replace(/\./g, '');
    return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac;
  }

  const moneyFormatters = {};

  function formatMoney(amount, currency) {
    const code = currency || 'KRW';
    const value = Number(amount) || 0;
    if (code === 'KRW') {
      return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value) + '원';
    }
    if (!moneyFormatters[code]) {
      try {
        moneyFormatters[code] = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: code });
      } catch (e) {
        moneyFormatters[code] = new Intl.NumberFormat('ko-KR');
      }
    }
    return moneyFormatters[code].format(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  return {
    CURRENCIES,
    TIMELINE,
    CATEGORIES,
    DEFAULT_CATEGORY,
    STATUSES,
    LODGING_ICON,
    isValidLocation,
    findById,
    category,
    downloadBlob,
    uid,
    escapeHtml,
    parseDate,
    formatDate,
    isValidDate,
    addDays,
    today,
    totalDays,
    durationLabel,
    dateOfDay,
    daysBetween,
    formatDayList,
    formatDisplayDate,
    formatHour,
    formatHourRange,
    formatDateTime,
    currencyDecimals,
    roundMoney,
    parseMoney,
    formatMoney,
    rateUnit,
    currencyName,
    parseRate,
    rateInputValue,
    convert,
    formatConverted,
    groupDigits,
    nowIso,
    isPlainObject
  };
})();

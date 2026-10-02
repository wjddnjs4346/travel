/* 지도 전담: Leaflet 불러오기, 도시 지도, 위치 지정 지도, 장소 검색, PNG용 지도 그림.
   지도는 인터넷이 필요한 유일한 기능이다. 불러오지 못하면 Promise가 실패하고,
   화면은 지도 없이 장소 목록만 보여준다(나머지 기능은 오프라인으로 동작).

   타일 서버: OSM 공식 서버(tile.openstreetmap.org)는 Referer가 없는 요청을 "Access blocked"
   그림으로 막는데, index.html을 파일로 직접 열면 Referer가 전송되지 않는다.
   그래서 같은 OpenStreetMap 데이터를 쓰는 OSM 독일 서버를 쓴다(일본어 등 현지 글자도 표시됨,
   CORS 허용 → PNG로 그릴 수 있음). */
const TripMap = (function () {
  'use strict';

  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const TILE_URL = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
  const ATTRIBUTION = '© OpenStreetMap contributors';
  const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
  const GEOCODE_INTERVAL = 1100; // Nominatim 이용 정책: 초당 1회 이하, 자동완성 금지(버튼으로만 검색)
  const SNAPSHOT_TIMEOUT = 8000;
  const GEOCODE_TIMEOUT = 10000;

  const esc = Utils.escapeHtml;

  /* ---------- Leaflet 불러오기 ---------- */

  let leafletPromise = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise(function (resolve, reject) {
      if (!document.getElementById('leaflet-css')) {
        const css = document.createElement('link');
        css.id = 'leaflet-css';
        css.rel = 'stylesheet';
        css.href = LEAFLET_CSS;
        document.head.appendChild(css);
      }
      const script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.onload = function () {
        if (window.L) resolve(window.L);
        else reject(new Error('Leaflet을 불러오지 못했습니다.'));
      };
      script.onerror = function () {
        // 나중에 인터넷이 연결되면 다시 시도할 수 있게 한다.
        leafletPromise = null;
        script.remove();
        reject(new Error('Leaflet을 불러오지 못했습니다.'));
      };
      document.head.appendChild(script);
    });
    return leafletPromise;
  }

  function tileLayer(L) {
    // crossOrigin: 타일을 PNG 캔버스에 그릴 수 있게 한다.
    return L.tileLayer(TILE_URL, { maxZoom: 18, attribution: ATTRIBUTION, crossOrigin: 'anonymous' });
  }

  /* ---------- 장소 검색 (Nominatim) ---------- */

  const geocodeCache = {};
  let geocodeQueue = Promise.resolve();
  let lastGeocodeAt = 0;

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // 반환: Promise<[{ lat, lng, label }]>. 여러 번 불러도 요청 사이 간격을 지키도록 줄을 세운다.
  function geocode(query, limit) {
    const max = limit || 5;
    const key = max + '|' + query;
    if (geocodeCache[key]) return Promise.resolve(geocodeCache[key]);
    const run = async function () {
      const wait = lastGeocodeAt + GEOCODE_INTERVAL - Date.now();
      if (wait > 0) await sleep(wait);
      lastGeocodeAt = Date.now();
      const params = new URLSearchParams({ format: 'jsonv2', limit: String(max), 'accept-language': 'ko', q: query });
      // 응답이 없으면 대기열 전체가 멈추므로 시간 제한을 둔다.
      const abort = new AbortController();
      const timer = setTimeout(function () { abort.abort(); }, GEOCODE_TIMEOUT);
      let res;
      try {
        res = await fetch(GEOCODE_URL + '?' + params.toString(), { signal: abort.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error('검색 실패 (' + res.status + ')');
      const list = await res.json();
      const results = list.map(function (r) {
        return { lat: roundCoord(Number(r.lat)), lng: roundCoord(Number(r.lon)), label: String(r.display_name || r.name || query) };
      }).filter(function (r) { return Utils.isValidLocation(r); });
      geocodeCache[key] = results;
      return results;
    };
    const result = geocodeQueue.then(run);
    geocodeQueue = result.catch(function () {});
    return result;
  }

  function roundCoord(value) {
    return Math.round(value * 1e6) / 1e6;
  }

  /* ---------- 지도에 찍는 표시 ---------- */

  // Icons 이름
  function placeIcon(place) {
    return place.kind === 'lodging' ? Utils.LODGING_ICON : Utils.category(place.category).icon;
  }

  function pinClass(place) {
    return place.kind === 'lodging' ? 'map-pin--lodging' : 'cat--' + Utils.category(place.category).id;
  }

  function pinIcon(L, place) {
    return L.divIcon({
      className: 'map-pin-anchor',
      iconSize: null,
      html: `<div class="map-pin ${pinClass(place)}">${Icons.svg(placeIcon(place))}<span class="map-pin__days">${esc(place.dayLabel)}</span></div>`
    });
  }

  function popupHtml(place) {
    return `<div class="map-popup"><strong class="map-popup__title">${Icons.svg(placeIcon(place))} ${esc(place.name)}</strong>` +
      `<span class="map-popup__days">${esc(place.dayLabel)}</span>` +
      place.entries.map(function (e) { return `<span>${esc(e.text)}</span>`; }).join('') + '</div>';
  }

  // 지점이 여러 개면 모두 보이게, 하나면 가까이, 없으면 도시 중심
  function fitView(map, places, center) {
    const latlngs = places.map(function (p) { return [p.lat, p.lng]; });
    if (latlngs.length > 1) map.fitBounds(latlngs, { padding: [48, 48], maxZoom: 16 });
    else if (latlngs.length === 1) map.setView(latlngs[0], 15);
    else if (center) map.setView([center.lat, center.lng], 12);
    else map.setView([20, 0], 2);
  }

  // 확대·축소 애니메이션 중에 지우면 Leaflet 내부 타이머가 지워진 지도를 건드려 오류가 난다.
  // 애니메이션이 끝난 뒤(zoomend) 지운다.
  function safeRemove(map) {
    if (map._animatingZoom) map.once('zoomend', function () { map.remove(); });
    else map.remove();
  }

  /* ---------- 도시 지도 (최종 일정표 탭) ---------- */

  // 화면을 다시 그릴 때마다 모두 지우고 새로 만든다(이전 DOM과 함께 사라진 지도의 리스너 정리).
  const cityMaps = [];

  function destroyCityMaps() {
    cityMaps.splice(0).forEach(safeRemove);
  }

  async function mountCityMap(el, places, center) {
    const L = await loadLeaflet();
    if (!el.isConnected) return null; // 기다리는 사이 화면이 다시 그려졌다.
    el.innerHTML = ''; // "불러오는 중" 문구가 지도 뒤에 남지 않게
    const map = L.map(el, { scrollWheelZoom: false });
    tileLayer(L).addTo(map);
    places.forEach(function (p) {
      L.marker([p.lat, p.lng], { icon: pinIcon(L, p), title: p.name, keyboard: true })
        .bindPopup(popupHtml(p))
        .addTo(map);
    });
    fitView(map, places, center);
    cityMaps.push(map);
    return map;
  }

  /* ---------- 위치 지정 지도 (일정·숙소 입력 창) ---------- */

  let picker = null;

  function destroyPicker() {
    if (picker) safeRemove(picker.map);
    picker = null;
  }

  // onPick({ lat, lng }): 지도를 눌렀을 때. 반환: { setMarker(loc, pan), setCenter(center) }
  async function mountPicker(el, location, center, onPick) {
    const L = await loadLeaflet();
    if (!el.isConnected) return null;
    destroyPicker();
    el.innerHTML = '';
    const map = L.map(el);
    tileLayer(L).addTo(map);
    let marker = null;

    function setMarker(loc, pan) {
      if (!loc) {
        if (marker) marker.remove();
        marker = null;
        return;
      }
      if (marker) marker.setLatLng([loc.lat, loc.lng]);
      else {
        marker = L.marker([loc.lat, loc.lng], {
          icon: L.divIcon({ className: 'map-pin-anchor', iconSize: null, html: '<div class="map-pin map-pin--picker">' + Icons.svg('places') + '</div>' }),
          keyboard: false
        }).addTo(map);
      }
      if (pan) map.setView([loc.lat, loc.lng], Math.max(map.getZoom() || 0, 15), { animate: false });
    }

    function setCenter(c) {
      if (!marker && c) map.setView([c.lat, c.lng], 12, { animate: false });
    }

    map.on('click', function (e) {
      const loc = { lat: roundCoord(e.latlng.lat), lng: roundCoord(e.latlng.lng) };
      setMarker(loc, false);
      onPick(loc);
    });

    if (location) map.setView([location.lat, location.lng], 15);
    else if (center) map.setView([center.lat, center.lng], 12);
    else map.setView([20, 0], 2);
    setMarker(location, false);
    // 대화상자가 막 열린 직후에는 크기 계산이 어긋날 수 있다.
    setTimeout(function () { if (picker && picker.map === map) map.invalidateSize(); }, 50);

    picker = { map: map, setMarker: setMarker, setCenter: setCenter };
    return picker;
  }

  function getPicker() {
    return picker;
  }

  /* ---------- PNG용 지도 그림 ---------- */

  // 화면 밖에 지정 크기의 지도를 만들고, 타일을 다 받으면 캔버스에 옮겨 그린다.
  // 반환: { canvas, points: [{ place, x, y }], tilesDrawn } — 지점 표시는 호출한 쪽에서 그린다.
  async function snapshot(places, center, width, height) {
    const L = await loadLeaflet();
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + width + 'px;height:' + height + 'px;';
    document.body.appendChild(el);
    let map = null;
    try {
      map = L.map(el, { zoomControl: false, attributionControl: false, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false });
      const layer = tileLayer(L);
      const loaded = new Promise(function (resolve) {
        layer.on('load', resolve);
        setTimeout(resolve, SNAPSHOT_TIMEOUT);
      });
      layer.addTo(map);
      fitView(map, places, center);
      await loaded;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e8e6e1';
      ctx.fillRect(0, 0, width, height);
      const base = el.getBoundingClientRect();
      let tilesDrawn = 0;
      el.querySelectorAll('img.leaflet-tile-loaded').forEach(function (img) {
        const r = img.getBoundingClientRect();
        try {
          ctx.drawImage(img, r.left - base.left, r.top - base.top, r.width, r.height);
          tilesDrawn++;
        } catch (e) {
          // 그릴 수 없는 타일은 건너뛴다.
        }
      });
      const points = places.map(function (p) {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        return { place: p, x: pt.x, y: pt.y };
      });
      return { canvas: canvas, points: points, tilesDrawn: tilesDrawn };
    } finally {
      if (map) map.remove();
      el.remove();
    }
  }

  return {
    ATTRIBUTION,
    loadLeaflet,
    geocode,
    placeIcon,
    destroyCityMaps,
    mountCityMap,
    mountPicker,
    destroyPicker,
    getPicker,
    snapshot
  };
})();

// NAVER Maps Web Dynamic Map (신규 NCP Maps: 스크립트 파라미터 ncpKeyId)
// - Client ID 는 서버 /api/config 에서 받아오며, NCP 콘솔의 Web 서비스 URL(예: http://localhost, 포트 없이)로 보호됩니다.
// - 인증 실패·로딩 실패 시 null 을 돌려주고, app.js 는 간이(SVG) 지도로 대체합니다.

const SDK_URL = 'https://oapi.map.naver.com/openapi/v3/maps.js';
let sdkPromise = null;
let authFailed = false;

function loadSdk(clientId) {
  if (window.naver?.maps) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    // NAVER Maps v3 가 인증 실패 시 호출하는 전역 콜백
    window.navermap_authFailure = () => {
      authFailed = true;
      reject(new Error('NAVER 지도 인증 실패: NCP 콘솔의 Web 서비스 URL(http://localhost)과 Dynamic Map 사용 설정을 확인해 주세요.'));
    };
    const s = document.createElement('script');
    s.src = `${SDK_URL}?ncpKeyId=${encodeURIComponent(clientId)}`;
    s.async = true;
    s.onload = () => (window.naver?.maps ? resolve() : reject(new Error('NAVER 지도 SDK를 불러오지 못했습니다.')));
    s.onerror = () => reject(new Error('NAVER 지도 SDK를 불러오지 못했습니다(네트워크·CSP 확인).'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('NAVER 지도 로딩 시간이 초과되었습니다.')), 10_000);
  });
  return sdkPromise;
}

/**
 * NAVER 지도 뷰 생성. 실패하면 { error } 반환.
 * @param {HTMLElement} el
 * @param {string} clientId
 */
export async function createNaverMap(el, clientId) {
  if (!clientId) return { error: '지도 Client ID가 설정되지 않았습니다.' };
  try {
    await loadSdk(clientId);
  } catch (err) {
    return { error: err.message };
  }
  const { maps } = window.naver;
  const map = new maps.Map(el, {
    center: new maps.LatLng(36.4, 127.9),
    zoom: 7,
    scaleControl: true,
    mapDataControl: false,
    zoomControl: true,
    zoomControlOptions: { position: maps.Position.TOP_RIGHT, style: maps.ZoomControlStyle.SMALL },
  });
  // 인증 실패는 로딩 후 비동기로 올 수 있어 상태를 노출합니다.
  const view = createView(map);
  view.isAuthFailed = () => authFailed;
  return { view };
}

function createView(map) {
  const { maps } = window.naver;
  let overlays = [];
  let markers = [];
  const info = new maps.InfoWindow({ borderWidth: 0, backgroundColor: 'transparent', disableAnchor: true, pixelOffset: new maps.Point(0, -8) });

  const clear = () => {
    overlays.forEach((o) => o.setMap(null));
    overlays = [];
    markers = [];
    info.close();
  };

  const pinHtml = (no, color, active = false) =>
    `<div class="nm-pin${active ? ' is-active' : ''}" style="--pin:${color}"><span>${no}</span></div>`;

  return {
    /**
     * @param {Array<{i:number,name:string,lat:number,lng:number,color:string,address?:string,move?:{path:number[][]}}>} points
     * @param {{ onHover?:(i:number,on:boolean)=>void, onClick?:(i:number)=>void, esc:(s:string)=>string }} opts
     * @returns {{ routeDrawn: number }}
     */
    render(points, { onHover, onClick, esc }) {
      clear();
      const bounds = new maps.LatLngBounds();
      let routeDrawn = 0;

      // 1) 실제 자동차 경로 (NAVER Directions 5 path)
      for (const p of points) {
        const path = p.move?.path;
        if (!path?.length) continue;
        const coords = path.map(([lng, lat]) => new maps.LatLng(lat, lng));
        coords.forEach((c) => bounds.extend(c));
        overlays.push(new maps.Polyline({ map, path: coords, strokeColor: '#ffffff', strokeWeight: 8, strokeOpacity: 0.9, strokeLineCap: 'round', strokeLineJoin: 'round' }));
        overlays.push(new maps.Polyline({ map, path: coords, strokeColor: '#ff6b4a', strokeWeight: 5, strokeOpacity: 0.95, strokeLineCap: 'round', strokeLineJoin: 'round' }));
        routeDrawn++;
      }

      // 2) 장소 마커 (번호 = 일정 순서)
      for (const p of points) {
        const pos = new maps.LatLng(p.lat, p.lng);
        bounds.extend(pos);
        const marker = new maps.Marker({
          map, position: pos, title: p.name, zIndex: 100 + p.i,
          icon: { content: pinHtml(p.i + 1, p.color), anchor: new maps.Point(15, 38) },
        });
        marker.__i = p.i;
        marker.__p = p;
        maps.Event.addListener(marker, 'mouseover', () => onHover?.(p.i, true));
        maps.Event.addListener(marker, 'mouseout', () => onHover?.(p.i, false));
        maps.Event.addListener(marker, 'click', () => {
          info.setContent(`<div class="nm-info"><b>${p.i + 1}. ${esc(p.name)}</b>${p.address ? `<span>${esc(p.address)}</span>` : ''}</div>`);
          info.open(map, marker);
          onClick?.(p.i);
        });
        overlays.push(marker);
        markers.push(marker);
      }

      if (points.length === 1) {
        map.setCenter(new maps.LatLng(points[0].lat, points[0].lng));
        map.setZoom(14);
      } else if (points.length > 1) {
        map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
      }
      return { routeDrawn };
    },

    highlight(i, on) {
      const m = markers.find((x) => x.__i === Number(i));
      if (!m) return;
      m.setIcon({ content: pinHtml(m.__i + 1, m.__p.color, on), anchor: new maps.Point(15, 38) });
      m.setZIndex(on ? 1000 : 100 + m.__i);
    },

    relayout() {
      maps.Event.trigger(map, 'resize');
    },
  };
}

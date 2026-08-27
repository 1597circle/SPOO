let voucherData = {};
let spooConfig = null; // config.json 캐시 — 캘린더 등록(.ics) 기능에서 재사용
let allSportTypesGlobal = new Set(); // 전국 종목 목록 (추천 기능의 종목 선택용)
let neighborMap = {};    // 인접시군구_매핑.json — 옆동네 시설 표시 기능에 사용
const LOW_FACILITY_THRESHOLD = 13;  // 이 개수 이하면 "옆동네도 함께 보기"를 자동으로 제안
let facilitiesByRegion = {}; // 지역별 시설 캐시 — getRegionFacilities()로 그때그때 채워짐 (더 이상 초기에 전부 로드하지 않음)
let facilityCounts = {}; // code -> 시설 개수만 (작은 파일, 초기 로드) — 개수만 필요한 화면에서 사용
let facilityNameIndex = []; // 전국 시설 이름 검색용 경량 인덱스 (name/sido/sgg/addr만, 초기 로드)
let regionPopulation = {}; // 5-2 「지역 현황 보기」② 비슷한 규모 지역 비교 — 시군구별 전체 인구(KOSIS)
let facilitiesFetchCache = {}; // code -> Promise, 같은 지역 중복 fetch 방지
let coursesByFacility = {};   // 강좌 데이터 (없으면 빈 상태로 시작, 나중에 courses.csv 추가하면 자동 반영)
let currentGroup = null;  // 처음엔 그룹 미선택 상태 — 버튼을 눌러야 지도에 색이 칠해집니다
let polygons = [];
let map;
let sLowThreshold, nLowThreshold;
let sRankByCode = {}, nRankByCode = {};
let sidoStats = {}, sidoTotalCount = 0, medianSPct = 0, medianNPct = 0;
let regionSearchList = [];
let facilityMarker = null;
let geocodeCache = {};
let currentPanelCode = null;
let currentPanelFacilities = [];
let currentPanelOwnOnly = [];
let currentPanelIncludingNeighbors = null;
let currentPanelNeighborCodes = []; // toggleNeighborFacilities에서 지연 fetch할 이웃 지역 코드 목록
let currentRvCode = null; // 「지역 현황 보기」에서 지금 보고 있는 지역 코드 (PDF·엑셀 다운로드용)

// 분석에서 확인된 "양쪽 그룹 모두 저조" 최우선 지역 10곳 (정식 시도명 일부로 매칭 — 동명 지역 오매칭 방지)
const TOP10_PRIORITY = [
  {region:'보령', sidoHint:'충청남'}, {region:'음성', sidoHint:'충청북'}, {region:'진천', sidoHint:'충청북'},
  {region:'영광', sidoHint:'전라남'}, {region:'장흥', sidoHint:'전라남'}, {region:'순창', sidoHint:'전북'},
  {region:'곡성', sidoHint:'전라남'}, {region:'봉화', sidoHint:'경상북'}, {region:'양구', sidoHint:'강원'},
  {region:'울릉', sidoHint:'경상북'}
];

// 재방문자 인사말 — 페이지 로드 시점과 언어 파일 로딩 완료 시점이 어긋날 수 있어
// (언어 파일은 비동기로 불러오는데 화면은 그보다 먼저 그려질 수 있음) 함수로 분리해서
// initOnboarding()과 setLanguage() 양쪽에서 다시 호출합니다. 어느 쪽이 나중에 끝나든
// 최종적으로 항상 올바른 언어로 표시됩니다.
function applyReturnGreeting(){
  const el = document.getElementById('wpReturnGreeting');
  if(!el) return;
  const name = localStorage.getItem('fairplay_display_name') || localStorage.getItem('fairplay_name');
  if(name) el.textContent = t('wp_return_greeting', `안녕하세요, ${name}님!`).replace('{name}', name);
}

function escapeAttr(str){
  return String(str||'').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// 사용자가 입력한 텍스트(이름 등)를 innerHTML에 넣기 전에 반드시 이 함수를 거칩니다.
// 이름에 <script> 같은 태그를 넣어도 코드로 실행되지 않고 글자 그대로 보이게 합니다.
function escapeHtml(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ==================== 다국어 지원 (i18n) ====================
   서버·회원가입 없이, 언어별 사전 파일(i18n/en.json 등)을 그때그때 불러와 텍스트를 바꿔치기합니다.
   선택한 언어만 localStorage에 저장하고, 사전에 없는 키는 항상 원래 한국어로 자연스럽게 대체됩니다.
   (기획서 "③ 다국어 지원" 참고 — 1단계로 자가진단·서류 안내 화면부터 적용) */
let currentLang = localStorage.getItem('spoo_lang') || 'ko';
let i18nDict = {};

const LANG_NAMES = { ko:'한국어', en:'English', vi:'Tiếng Việt', zh:'中文' };

// key로 사전에서 찾고, 없으면 한국어 원문(fallback)을 그대로 반환 — 항상 안전하게 뭔가는 보여줌
function t(key, fallback){
  return i18nDict[key] || fallback;
}

async function setLanguage(lang){
  currentLang = lang;
  localStorage.setItem('spoo_lang', lang);
  closeLangMenu();

  if(lang === 'ko'){
    i18nDict = {};
  } else {
    try{
      // 현재 주소가 /SPOO 든 /SPOO/ 든 /SPOO/index.html 이든 항상 올바른 위치를 가리키도록 경로를 직접 계산
      const dir = location.pathname.endsWith('/') ? location.pathname : location.pathname.replace(/[^/]*$/, '');
      const res = await fetch(`${dir}i18n/${lang}.json`, { cache: 'no-cache' });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      i18nDict = await res.json();
    }catch(e){
      console.log(`i18n/${lang}.json 로드 실패 — 한국어로 유지합니다.`, e);
      i18nDict = {};
      showToast('⚠️ 번역 파일을 불러오지 못해 한국어로 표시돼요. 잠시 후 다시 시도해주세요.');
      currentLang = 'ko';
      localStorage.setItem('spoo_lang', 'ko');
    }
  }
  applyTranslations();
  applyReturnGreeting();      // 위와 같은 이유로 언어 로딩 완료 후 다시 한번 확실히 적용
  renderConfigNotices();       // 신청기간·결제마감 문구 (날짜 형식이 언어별로 다름)
  document.documentElement.lang = lang;
}

// 페이지의 data-i18n 요소를 전부 치환. <br> 등 태그가 섞여 있을 수 있어 textContent가 아닌
// innerHTML을 사용하고, 최초 1회 원본 한국어를 data-i18n-ko에 저장해둬서 언어를 왔다갔다 해도
// 원본이 안전하게 보존되도록 합니다.
function applyTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if(!el.hasAttribute('data-i18n-ko')) el.setAttribute('data-i18n-ko', el.innerHTML);
    el.innerHTML = i18nDict[key] || el.getAttribute('data-i18n-ko');
  });
  // input의 placeholder는 innerHTML이 없으므로 별도 속성(data-i18n-ph)으로 처리
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    if(!el.hasAttribute('data-i18n-ph-ko')) el.setAttribute('data-i18n-ph-ko', el.getAttribute('placeholder') || '');
    el.setAttribute('placeholder', i18nDict[key] || el.getAttribute('data-i18n-ph-ko'));
  });
  const label = document.getElementById('langBtnLabel');
  if(label) label.textContent = LANG_NAMES[currentLang] || '한국어';
}

function toggleLangMenu(){
  const menu = document.getElementById('langMenu');
  if(!menu) return;
  closeHeaderMoreMenu();
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}
function closeLangMenu(){
  const menu = document.getElementById('langMenu');
  if(menu) menu.style.display = 'none';
}

// 저장된 언어가 있으면(재방문자) 페이지 로드 시 바로 적용
if(currentLang !== 'ko'){
  document.addEventListener('DOMContentLoaded', () => setLanguage(currentLang));
}

// 전화번호를 보기 좋게 하이픈 형식으로 변환 (02는 2자리 지역번호, 그 외는 3자리 지역번호)
function formatPhone(tel){
  if(!tel) return null;
  const d = String(tel).replace(/[^0-9]/g,'');
  if(d.length < 9) return d || null;
  if(d.startsWith('02')){
    if(d.length===9) return d.slice(0,2)+'-'+d.slice(2,5)+'-'+d.slice(5);
    if(d.length===10) return d.slice(0,2)+'-'+d.slice(2,6)+'-'+d.slice(6);
  } else {
    if(d.length===10) return d.slice(0,3)+'-'+d.slice(3,6)+'-'+d.slice(6);
    if(d.length===11) return d.slice(0,3)+'-'+d.slice(3,7)+'-'+d.slice(7);
  }
  return d;
}

// 시설 항목 클릭 → 앱 안 지도에 바로 마커 찍기 (빠른 위치 확인용)
function showFacilityOnMap(name, addr, sgg, naverLat, naverLng){
  const fkey = sgg ? `${name}|${sgg}` : name;
  // 좌표 매칭 배치에서 이미 검증된 좌표가 있으면, 실시간 지오코딩 없이 바로 그 좌표를 씀
  // (더 정확하고 더 빠름 — 이 시설은 이름으로 검색해서 주소까지 대조 확인된 것이므로 신뢰 가능)
  if(naverLat && naverLng){
    placeFacilityMarker({ lat: parseFloat(naverLat), lng: parseFloat(naverLng) }, name, fkey);
    return;
  }
  if(typeof naver === 'undefined' || !naver.maps.Service){
    highlightFacilityInList(fkey); // 지도 API가 안 떠도 리스트 하이라이트는 가능
    return; // 실패해도 조용히 넘어감 — "네이버 지도에서 길찾기" 링크로 대체 가능
  }
  if(geocodeCache[addr]){
    placeFacilityMarker(geocodeCache[addr], name, fkey);
    return;
  }
  naver.maps.Service.geocode({ query: addr }, function(status, response){
    if(status !== naver.maps.Service.Status.OK || !response.v2.addresses.length){
      highlightFacilityInList(fkey);
      return; // 이 경우도 조용히 넘어감
    }
    const item = response.v2.addresses[0];
    const coord = { lat: parseFloat(item.y), lng: parseFloat(item.x) };
    geocodeCache[addr] = coord;
    placeFacilityMarker(coord, name, fkey);
  });
}

function placeFacilityMarker(coord, name, fkey){
  facilityPinsRequestId++; // 진행 중이던 "근처 시설 전체" 핀 배치를 무효화 — 뒤늦게 도착해도 이제 무시됨
  if(facilityMarker) facilityMarker.setMap(null);
  clearFacilityPins(); // 핀 하나만 정확히 보이게 — "근처 시설 전체" 핀들과 겹쳐 보이던 문제 해결
  dimPolygonColors(); // 정확한 시설 위치가 잘 보이도록 지역 색칠을 옅게 지웁니다
  const pos = new naver.maps.LatLng(coord.lat, coord.lng);
  facilityMarker = new naver.maps.Marker({
    position: pos, map: map,
    icon: {
      content: `<div style="background:var(--blue,#3182F6); color:#fff; padding:6px 12px; border-radius:20px; font-size:12px; font-weight:700; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,.25); transform:translate(-50%,-130%);">📍 ${name}</div>`,
      anchor: new naver.maps.Point(0, 0)
    }
  });
  map.setCenter(pos);
  map.setZoom(18); // 건물 하나만 딱 붙어 보이지 않고, 바로 옆 건물들까지 자연스럽게 보이는 정도
  document.getElementById('map')?.scrollIntoView({ behavior:'smooth', block:'center' });
  if(fkey) highlightFacilityInList(fkey);
}

// 핀을 클릭했을 때(지도 위 마커든, 카드 클릭이든) 왼쪽 목록에서 해당 시설을 찾아
// 맨 위로 옮기고 테두리를 강조해서 "이게 그 시설이에요"를 바로 알 수 있게 함
// (스크롤만 하면 리스트 중간에 파묻혀 있어서 찾기 번거로우니, 아예 맨 앞으로 끌어올림)
function highlightFacilityInList(fkey){
  document.querySelectorAll('.facility-item.pin-focused').forEach(el => el.classList.remove('pin-focused'));
  let target = document.querySelector(`.facility-item[data-fkey="${cssEscape(fkey)}"]`);
  if(!target){
    // 목록은 기본 5개까지만 렌더링되고 "더보기"로 늘어나는 구조라, 추천 시설이 그 5개 밖에
    // 있으면 아직 화면(DOM)에 없어서 못 찾을 수 있음. 전체 목록에서 순서를 찾아 필요한
    // 만큼 펼친 뒤 다시 시도함.
    const idx = (currentPanelFacilities || []).findIndex(f => (f.sgg ? `${f.name}|${f.sgg}` : f.name) === fkey);
    if(idx === -1) return; // 이 동네 목록 자체에 없는 시설 — 조용히 종료
    const neededLimit = Math.ceil((idx + 1) / 5) * 5;
    if(neededLimit > facilityListLimit){
      facilityListLimit = neededLimit;
      onFilterChange();
      target = document.querySelector(`.facility-item[data-fkey="${cssEscape(fkey)}"]`);
    }
  }
  if(!target) return; // 필터(종목 등)에 걸려 아예 안 보이는 상태일 수 있음 — 이 경우도 조용히 종료
  target.classList.add('pin-focused');
  const parent = target.parentElement;
  if(parent && parent.firstElementChild !== target){
    parent.insertBefore(target, parent.firstElementChild);
  }
  target.scrollIntoView({ behavior:'smooth', block:'start' });
}

// data-fkey 안에 " · " 같은 특수문자가 있어도 querySelector가 깨지지 않도록 이스케이프
function cssEscape(str){
  if(window.CSS && CSS.escape) return CSS.escape(str);
  return String(str).replace(/[^a-zA-Z0-9가-힣_-]/g, c => `\\${c}`);
}

// 시설 이름 클릭 → 네이버 통합검색(업체 정보 페이지)으로 새 탭 이동
// 상호명 + 시군구로 검색 (예: "HYO태권도장 강남구") — 전화번호로 검색하면 오히려 업체 페이지가
// 아닌 엉뚱한 일반 검색 결과가 뜨는 경우가 많다는 피드백이 있어, 이름+지역 방식으로 되돌림.
// + naverTitle: 좌표 매칭 배치 작업에서 "이 시설의 네이버 등록 이름이 이거다"라고 검증까지
// 끝낸 실제 이름이 있으면(예: 우리 데이터엔 "HYO태권도장"인데 네이버엔 "역삼효태권도"로
// 등록된 경우) 그 이름을 최우선으로 씀 — 우리 쪽 이름과 네이버 등록명이 아예 다른 경우는
// 이름+지역을 아무리 조합해도 못 찾기 때문에, 검증된 진짜 이름을 쓰는 것 외엔 방법이 없음.
// (아직 좌표 매칭 배치가 안 끝난 시설은 이 값이 없어서 자동으로 기존 방식으로 대체됨)
function openNaverSearch(name, addr, sgg, tel, naverTitle){
  const q = naverTitle ? naverTitle : (sgg ? `${name} ${sgg}` : `${name} ${addr}`);
  window.open(`https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`, '_blank');
}

// "네이버 지도에서 길찾기" 클릭 → 네이버 지도 새 탭으로 이동
// [2026-08-20 재작업] 기존엔 이름/전화번호로 "검색"을 했는데, 검색은 결국 네이버 쪽 등록 정보와
// 매칭이 맞아야 해서 근본적으로 100% 보장이 안 됐음(팀원 보고서에서 80.3%까지 개선은 했지만
// 여전히 어긋나는 케이스가 있었음, 사용자 피드백으로 확인).
// 그래서 방식을 바꿈: 이름으로 "검색"하는 대신, 사이트 안 지도 핀(showFacilityOnMap)과 완전히
// 똑같은 방법 — 주소를 좌표로 변환(geocode)한 다음, 그 좌표를 직접 새 탭에 찍음.
// 좌표 지정 방식은 `https://map.naver.com/?lng=경도&lat=위도&title=이름` — 네이버 공식 문서는
// 아니지만 실제 위경도→네이버지도 정확도 검증에 쓰이는 걸로 확인된 방식(출처: velog.io 블로그,
// 주소로 좌표 얻은 뒤 이 URL로 재검색해 같은 위치인지 직접 스크린샷으로 확인한 사례).
// 이렇게 하면 "이 사이트가 보여주는 이름"과 "새 탭에 뜨는 핀 위치"가 항상 같은 좌표에서 나오므로
// 최소한 서로 어긋나는 일은 없어짐. 다만 도로명 주소 자체가 건물 단위라, 한 건물에 여러 시설이
// 있으면 그 시설들끼리는 좌표가 같게 나올 수 있음(이건 좌표 방식이 아니라 주소 데이터 자체의
// 한계라 이번 수정으로는 못 고침 — 필요하면 다음에 건물 내 정확한 호수 단위 데이터를 추가하거나
// 네이버 지역검색 API로 업체별 정확한 좌표를 한 번 매핑해두는 작업이 필요함).
function openNaverMap(name, addr, sgg, tel, naverTitle, naverLat, naverLng){
  const displayName = naverTitle || name; // 검증된 실제 등록명이 있으면 지도 라벨도 그걸로 표시
  // 좌표 매칭 배치에서 이미 검증된 좌표가 있으면 지오코딩 없이 바로 새 탭을 엶
  if(naverLat && naverLng){
    window.open(`https://map.naver.com/?lng=${naverLng}&lat=${naverLat}&title=${encodeURIComponent(displayName)}`, '_blank');
    return;
  }
  const fallback = (winRef) => {
    const q = naverTitle ? naverTitle : (tel ? tel : (sgg ? `${name} ${sgg}` : name));
    const url = `https://map.naver.com/p/search/${encodeURIComponent(q)}`;
    if(winRef && !winRef.closed) winRef.location.href = url; else window.open(url, '_blank');
  };
  const openAtCoord = (winRef, coord) => {
    const url = `https://map.naver.com/?lng=${coord.lng}&lat=${coord.lat}&title=${encodeURIComponent(displayName)}`;
    if(winRef && !winRef.closed) winRef.location.href = url; else window.open(url, '_blank');
  };
  // 이미 좌표를 알고 있으면(카드 클릭으로 지도 핀을 본 적 있으면) 바로 동기적으로 새 탭을 열어서 이동
  if(geocodeCache[addr]){
    window.open(`https://map.naver.com/?lng=${geocodeCache[addr].lng}&lat=${geocodeCache[addr].lat}&title=${encodeURIComponent(displayName)}`, '_blank');
    return;
  }
  if(typeof naver === 'undefined' || !naver.maps.Service){
    fallback(null);
    return;
  }
  // 좌표 변환은 비동기라, 팝업 차단을 피하려면 클릭 직후 빈 탭부터 동기적으로 열어두고
  // 변환이 끝나면 그 탭 주소를 바꿔치기함 (탭을 새로 못 열게 막혔다면 winRef가 null일 수 있음)
  const winRef = window.open('', '_blank');
  naver.maps.Service.geocode({ query: addr }, function(status, response){
    if(status !== naver.maps.Service.Status.OK || !response.v2.addresses.length){
      fallback(winRef);
      return;
    }
    const item = response.v2.addresses[0];
    const coord = { lat: parseFloat(item.y), lng: parseFloat(item.x) };
    geocodeCache[addr] = coord;
    openAtCoord(winRef, coord);
  });
}

// 시설 핀을 찍을 때 옅어졌던 지역 색상을 원래대로 되돌립니다 (다른 지역을 다시 선택할 때 호출)
function dimPolygonColors(){
  drawnPolygons.forEach(p=> p.setOptions({ fillOpacity: 0, strokeOpacity: 0.15 }));
}
function restorePolygonColors(){
  drawnPolygons.forEach((p,i)=>{
    const info = polygons[i];
    if(!info) return;
    const pct = parseFloat(currentGroup==='n' ? info.row.n_pct : info.row.s_pct);
    p.setOptions(polygonStyle(pct, currentGroup));
  });
}

async function loadCSV(path){
  const text = await (await fetch(path)).text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map(h=>h.replace(/^\uFEFF/,''));
  return lines.slice(1).map(line=>{
    const cells = [];
    let cur = '', inQuotes = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(ch === '"'){ inQuotes = !inQuotes; }
      else if(ch === ',' && !inQuotes){ cells.push(cur); cur=''; }
      else{ cur += ch; }
    }
    cells.push(cur);
    const obj = {};
    headers.forEach((h,i)=> obj[h.trim()] = cells[i] ? cells[i].trim() : '');
    return obj;
  });
}

// 지역별 시설 데이터를 그때그때 불러옵니다 ({code}.json, 지역당 평균 수십KB).
// 같은 지역을 여러 화면(시설찾기/지역현황/시설운영자)에서 다시 열어도 한 번만 fetch하도록 캐시합니다.
async function getRegionFacilities(code){
  const row = voucherData[code];
  if(!row) return [];
  const key = row.sido + '|' + row.region;
  if(facilitiesByRegion[key]) return facilitiesByRegion[key]; // 이미 캐시됨

  if(!facilitiesFetchCache[code]){
    facilitiesFetchCache[code] = fetch(`${code}.json`)
      .then(r => r.ok ? r.json() : [])
      .catch(() => []);
  }
  const rows = await facilitiesFetchCache[code];
  facilitiesByRegion[key] = rows;
  return rows;
}

// courses.csv(약 14MB)는 필수 데이터가 아니라서 화면이 뜬 뒤 브라우저가 한가할 때 불러옵니다.
// 시설명만으로 연결하면 동명 시설(예: "해동검도" 전국 45곳)에 엉뚱한 강좌가 붙는 문제가 있어서,
// "시설명+시군구"를 합친 키로 연결합니다. (courses.csv에 sgg 컬럼이 없으면 이름만으로 대체 — 하위호환)
function loadCoursesInBackground(){
  const run = async () => {
    try{
      const courseRows = await loadCSV('courses.csv');
      courseRows.forEach(r=>{
        const name = (r.name || r.facil_nm || '').trim();
        if(!name) return;
        const key = r.sgg ? `${name}|${r.sgg}` : name;
        if(!coursesByFacility[key]) coursesByFacility[key] = [];
        coursesByFacility[key].push(r);
      });
      console.log('강좌 상세정보 로드됨(백그라운드):', courseRows.length, '건');
    }catch(e){
      console.log('courses.csv 없음 — 강좌 상세정보 없이 진행 (시설 목록은 정상 표시됩니다)');
    }
  };
  if('requestIdleCallback' in window){
    requestIdleCallback(run, {timeout: 4000});
  }else{
    setTimeout(run, 1500);
  }
}

// config.json(신청 기간·결제 마감·데이터 기준일 등 매년 바뀌는 값)을 불러와 화면에 반영합니다.
// 매년 이 값들을 index.html 안에서 직접 찾아 고치지 않고 config.json 하나만 갱신하면 되게 하기 위함입니다.
async function loadConfigAndApply(){
  try{
    const cfg = await fetch('config.json').then(r=>r.json());
    spooConfig = cfg; // 캘린더 등록(.ics) 기능에서 재사용
    const tag = document.getElementById('headerConfigTag');
    if(tag) tag.textContent = `전국 ${cfg.regionCount}개 지역 · ${cfg.dataUpdatedAt} 기준`;
    renderConfigNotices();
  }catch(e){
    console.log('config.json 로드 실패 — 화면에 있는 기본 안내 문구로 표시됩니다.', e);
  }
}
loadConfigAndApply();

// 신청기간/결제마감 안내 문구를 현재 언어에 맞게 렌더링. config.json을 다시 불러올 필요 없이
// 캐시된 spooConfig를 재사용하며, 언어를 바꿀 때마다 다시 호출됩니다.
function renderConfigNotices(){
  if(!spooConfig) return;
  const cfg = spooConfig;
  const isKo = (currentLang === 'ko' || !currentLang);
  const fmt = (iso) => {
    const [y,m,d] = iso.split('-');
    return isKo ? `${parseInt(m)}월 ${parseInt(d)}일` : `${parseInt(m)}/${parseInt(d)}`;
  };

  const applyEl = document.getElementById('noticeApplyPeriod');
  if(applyEl){
    const range = isKo
      ? `${fmt(cfg.applyPeriod.start)}~${fmt(cfg.applyPeriod.end).replace(/^\d+월 /,'')}`
      : `${fmt(cfg.applyPeriod.start)} ~ ${fmt(cfg.applyPeriod.end)}`;
    const line = t('notice_apply_period_template', '신청 기간: {range}').replace('{range}', range);
    applyEl.innerHTML = `<b>${line}</b> — ${t('notice_apply_period_sub','1년에 한 번뿐인 전국 동시 신청 기간이에요.')}`;
  }
  const payEl = document.getElementById('noticePaymentDeadline');
  if(payEl){
    const line = t('notice_payment_template', '결제는 {date}까지').replace('{date}', fmt(cfg.paymentDeadline));
    payEl.innerHTML = `<b>${line}</b> — ${t('notice_payment_sub','마감일을 헷갈리지 마세요.')}`;
  }
}

/* ==================== 신청기간 캘린더 등록 (.ics 다운로드) ====================
   서버·회원가입 없이, 브라우저에서 표준 iCalendar(.ics) 파일을 만들어 다운로드합니다.
   config.json의 신청기간·결제마감 값을 그대로 사용하므로, 매년 config.json만 갱신하면
   따로 손댈 필요 없이 최신 날짜로 반영됩니다. (기획서 "① 캘린더 등록" 참고) */
function icsPad2(n){ return String(n).padStart(2, '0'); }

// "2026-11-10" -> "20261110"
function icsDateOnly(iso){ return iso.replace(/-/g, ''); }

// 종일 이벤트의 DTEND는 iCalendar 규격상 "다음날"을 넣어야 함 (exclusive)
function icsDateOnlyPlus1(iso){
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}${icsPad2(d.getMonth()+1)}${icsPad2(d.getDate())}`;
}

function icsEscape(text){
  return String(text).replace(/([,;])/g, '\\$1');
}

function buildIcsContent(cfg){
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${icsPad2(now.getUTCMonth()+1)}${icsPad2(now.getUTCDate())}T${icsPad2(now.getUTCHours())}${icsPad2(now.getUTCMinutes())}${icsPad2(now.getUTCSeconds())}Z`;

  function vevent(uid, summary, description, dateIso){
    return [
      'BEGIN:VEVENT',
      `UID:${uid}@spoo.1597circle.github.io`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icsDateOnly(dateIso)}`,
      `DTEND;VALUE=DATE:${icsDateOnlyPlus1(dateIso)}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:REMINDER',
      'TRIGGER:-P3D', // 3일 전 알림
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  }

  const events = [
    vevent('spoo-apply-start', 'SPOO 스포츠강좌이용권 신청 시작', 'SPOO에서 신청 서류를 미리 확인해보세요.', cfg.applyPeriod.start),
    vevent('spoo-apply-end', 'SPOO 스포츠강좌이용권 신청 마감', '오늘까지 신청을 완료해야 해요.', cfg.applyPeriod.end),
    vevent('spoo-payment-deadline', 'SPOO 스포츠강좌이용권 결제 마감', '12월 31일이 아니라 이 날짜까지예요. 헷갈리지 마세요!', cfg.paymentDeadline),
  ];

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SPOO//KO',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

// 구글 캘린더 "바로 추가" 링크 생성 — 파일 다운로드 없이 캘린더 앱이 바로 열립니다 (모바일에서 가장 확실한 방법)
function buildGcalUrl(title, startYmd, endYmdExclusive, details){
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${startYmd}/${endYmdExclusive}`,
    details: details || '',
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// 캘린더 추가 방법 선택 시트 — 구글 캘린더(권장) 또는 .ics 파일
async function openCalendarSheet(){
  let cfg = spooConfig;
  if(!cfg){
    try{ cfg = await fetch('config.json').then(r=>r.json()); spooConfig = cfg; }
    catch(e){ showToast('일정 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'); return; }
  }
  const y = (iso)=> icsDateOnly(iso);
  const applyUrl = buildGcalUrl(
    'SPOO 스포츠강좌이용권 신청기간',
    y(cfg.applyPeriod.start), icsDateOnlyPlus1(cfg.applyPeriod.end),
    'SPOO에서 신청 서류를 미리 확인해보세요. https://1597circle.github.io/SPOO/'
  );
  const payUrl = buildGcalUrl(
    'SPOO 스포츠강좌이용권 결제 마감',
    y(cfg.paymentDeadline), icsDateOnlyPlus1(cfg.paymentDeadline),
    '12월 31일이 아니라 이 날짜까지예요! https://1597circle.github.io/SPOO/'
  );

  let sheet = document.getElementById('calSheetOverlay');
  if(sheet) sheet.remove();
  sheet = document.createElement('div');
  sheet.id = 'calSheetOverlay';
  sheet.className = 'cal-sheet-overlay';
  sheet.innerHTML = `
    <div class="cal-sheet">
      <div class="cal-sheet-title">📅 캘린더에 추가하기</div>
      <a class="cal-sheet-btn primary" href="${applyUrl}" target="_blank" rel="noopener">📆 신청기간 추가 (구글 캘린더)</a>
      <a class="cal-sheet-btn primary" href="${payUrl}" target="_blank" rel="noopener">💳 결제마감 추가 (구글 캘린더)</a>
      <button class="cal-sheet-btn" onclick="downloadApplyCalendar(); document.getElementById('calSheetOverlay').remove();">📄 파일(.ics)로 받기 — 아이폰·기타 캘린더용</button>
      <button class="cal-sheet-close" onclick="document.getElementById('calSheetOverlay').remove()">닫기</button>
    </div>`;
  sheet.addEventListener('click', (e)=>{ if(e.target === sheet) sheet.remove(); });
  document.body.appendChild(sheet);
}

async function downloadApplyCalendar(){
  let cfg = spooConfig;
  if(!cfg){
    try{ cfg = await fetch('config.json').then(r=>r.json()); }
    catch(e){ alert('일정 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.'); return; }
  }
  const icsText = buildIcsContent(cfg);
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'SPOO_신청기간.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showIcsToast();
}

// 화면 하단에 잠깐 떴다 사라지는 공용 안내 토스트
function showToast(message){
  let toast = document.getElementById('icsToast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'icsToast';
    toast.className = 'ics-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(()=> toast.classList.remove('show'), 3800);
}

function showIcsToast(){
  showToast('📅 다운로드했어요. 파일을 열어 "캘린더에 추가"를 눌러주세요 (알림 시각은 캘린더 앱 설정에 따라 다를 수 있어요)');
}

/* ==================== 음성 안내 (Web Speech API) ====================
   브라우저 내장 음성합성 기능이라 서버·비용이 들지 않습니다. (기획서 "② 음성 안내" 참고)
   미지원 브라우저에서는 버튼 자체를 자동으로 숨겨서, 눌러도 반응 없는 버튼이 남지 않게 합니다. */
let currentSpeakBtn = null;

function speakText(text, btnEl){
  if(!('speechSynthesis' in window) || !text || !text.trim()) return;

  // 이미 읽고 있는 버튼을 다시 누르면 멈춤 (토글)
  if(speechSynthesis.speaking){
    const wasSameBtn = currentSpeakBtn === btnEl;
    speechSynthesis.cancel();
    setSpeakBtnPlaying(currentSpeakBtn, false);
    currentSpeakBtn = null;
    if(wasSameBtn) return; // 같은 버튼이면 멈추기만 하고 끝
  }

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = { ko:'ko-KR', en:'en-US', vi:'vi-VN', zh:'zh-CN' }[currentLang] || 'ko-KR';
  utter.onend = () => { setSpeakBtnPlaying(btnEl, false); currentSpeakBtn = null; };
  utter.onerror = () => { setSpeakBtnPlaying(btnEl, false); currentSpeakBtn = null; };
  currentSpeakBtn = btnEl;
  setSpeakBtnPlaying(btnEl, true);
  speechSynthesis.speak(utter);
}

function setSpeakBtnPlaying(btnEl, playing){
  if(!btnEl) return;
  btnEl.classList.toggle('playing', playing);
  btnEl.textContent = playing ? t('speak_stop','⏸ 멈추기') : t('speak_listen','🔊 들려주기');
}

// 화면에 실제로 보이는 텍스트를 그대로 읽어줍니다 (내용이 바뀌어도 별도 텍스트 관리가 필요 없음)
// <br>로 줄바꿈된 부분은 마침표로 바꿔서, 단어가 붙어 읽히지 않고 자연스럽게 끊어 읽히게 합니다.
function extractSpeakableText(el){
  const clone = el.cloneNode(true);
  clone.querySelectorAll('br').forEach(br => br.replaceWith('. '));
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

function speakElementsText(selector, btnEl, prefix){
  const els = document.querySelectorAll(selector);
  if(!els.length) return;
  const text = (prefix || '') + Array.from(els).map(extractSpeakableText).filter(Boolean).join('. ');
  speakText(text, btnEl);
}

// 브라우저가 음성합성을 지원 안 하면, 안내 버튼들을 아예 숨겨서 눌러도 반응 없는 상태를 방지
function hideSpeakButtonsIfUnsupported(){
  if('speechSynthesis' in window) return;
  document.querySelectorAll('.speak-btn').forEach(btn => btn.style.display = 'none');
}
document.addEventListener('DOMContentLoaded', hideSpeakButtonsIfUnsupported);

async function init(){
  try{
    const [voucherRows, geo] = await Promise.all([
      loadCSV('voucher_data.csv'),
      fetch('sigungu_simplified.json').then(r=>r.json())
    ]);

    // 옆동네 시설 표시 기능용 인접 시군구 매핑 (없어도 사이트는 정상 작동)
    try{
      neighborMap = await fetch('인접시군구_매핑.json').then(r=>r.json());
    }catch(e){
      console.log('인접시군구_매핑.json 없음 — 옆동네 시설 표시 기능 없이 진행');
    }

    // 「지역 현황 보기」 ② 비슷한 규모 지역과 비교 — 시군구별 전체 인구(KOSIS). 없어도 사이트는 정상 작동
    try{
      regionPopulation = await fetch('region_population.json').then(r=>r.json());
    }catch(e){
      console.log('region_population.json 없음 — 비슷한 규모 지역 비교 없이 진행');
    }

    // 시설 데이터(voucher_facilities.csv, 3.7MB)는 더 이상 통째로 미리 불러오지 않습니다.
    // 대신 ①지역별로 쪼갠 파일({code}.json)을 실제로 그 지역을 볼 때만 불러오고,
    // ②"개수"만 필요한 화면(담당자용, 즐겨찾기 비교, 옆동네 미리보기)은 아주 작은 facility_counts.json으로,
    // ③"이름으로 전국 검색"은 이름·주소만 담은 경량 인덱스(facility_names_index.json)로 대체합니다.
    try{
      facilityCounts = await fetch('facility_counts.json').then(r=>r.json());
    }catch(e){
      console.log('facility_counts.json 없음 — 시설 개수 표시가 제한될 수 있어요');
    }
    try{
      facilityNameIndex = await fetch('facility_names_index.json').then(r=>r.json());
    }catch(e){
      console.log('facility_names_index.json 없음 — 시설 이름 검색 없이 진행');
    }
    try{
      const sportTypes = await fetch('sport_types.json').then(r=>r.json());
      sportTypes.forEach(t=>allSportTypesGlobal.add(t));
    }catch(e){
      console.log('sport_types.json 없음 — 종목 필터 목록이 비어있을 수 있어요');
    }
    populateSportSelect();

    voucherRows.forEach(r=>{ voucherData[r.code] = r; });

    computeThresholds();
    computeRanks();
    buildSearchIndex();
    initMap();
    drawPolygons(geo.features);
    updateLegendBar();
    computeCentroids();
    populateAgeSelect();
    renderTop10();
    renderFavorites();

    // 강좌 상세정보(courses.csv, 약 14MB)는 초기 로딩을 막지 않도록 백그라운드에서 나중에 불러옵니다.
    // 이전에는 Promise.all 안에서 다른 필수 데이터와 함께 기다렸기 때문에, 첫 화면이 뜨기까지
    // 사용자가 14MB짜리 파일 다운로드+파싱이 끝날 때까지 기다려야 했습니다.
    // 자가진단(1단계)에는 강좌 상세정보가 필요 없으므로, 화면이 이미 뜬 뒤 유휴 시간에 불러옵니다.
    loadCoursesInBackground();

    const totalFacilities = Object.values(facilityCounts).reduce((a,b)=>a+b, 0);
    document.getElementById('loadStatus').textContent =
      `${voucherRows.length}개 지역, ${totalFacilities.toLocaleString()}개 시설 정보를 불러왔어요`;
  }catch(err){
    document.getElementById('loadStatus').innerHTML =
      '<span style="color:var(--red);">데이터를 못 불러왔어요: ' + err.message +
      '<br>voucher_data.csv, facility_counts.json, sigungu_simplified.json 등 필요한 파일이 같은 폴더에 있는지 확인해주세요.</span>';
    console.error(err);
  }
}

function computeRanks(){
  const rows = Object.values(voucherData);
  const byS = [...rows].sort((a,b)=> parseFloat(b.s_pct) - parseFloat(a.s_pct));
  const byN = [...rows].sort((a,b)=> parseFloat(b.n_pct) - parseFloat(a.n_pct));
  byS.forEach((r,i)=>{ sRankByCode[r.code] = i+1; });
  byN.forEach((r,i)=>{ nRankByCode[r.code] = i+1; });

  // ==== 「지역 현황 보기」용 집계: 시도 단위, 전국 중위값 ====
  const sidoMap = {};
  rows.forEach(r=>{
    if(!sidoMap[r.sido]) sidoMap[r.sido] = { sRecv:0, sTarget:0, nRecv:0, nTarget:0, count:0 };
    const g = sidoMap[r.sido];
    g.sRecv += Number(r.s_recv)||0; g.sTarget += Number(r.s_target)||0;
    g.nRecv += Number(r.n_recv)||0; g.nTarget += Number(r.n_target)||0;
    g.count += 1;
  });
  Object.entries(sidoMap).forEach(([sido, g])=>{
    g.sPct = g.sTarget ? (g.sRecv/g.sTarget*100) : 0;
    g.nPct = g.nTarget ? (g.nRecv/g.nTarget*100) : 0;
  });
  const sidoBySPct = Object.entries(sidoMap).sort((a,b)=> b[1].sPct - a[1].sPct);
  sidoBySPct.forEach(([sido], i)=>{ sidoMap[sido].sRank = i+1; });
  sidoStats = sidoMap;
  sidoTotalCount = Object.keys(sidoMap).length;

  const sPctSorted = rows.map(r=>parseFloat(r.s_pct)).sort((a,b)=>a-b);
  const nPctSorted = rows.map(r=>parseFloat(r.n_pct)).sort((a,b)=>a-b);
  medianSPct = sPctSorted[Math.floor(sPctSorted.length/2)];
  medianNPct = nPctSorted[Math.floor(nPctSorted.length/2)];
}

function buildSearchIndex(){
  regionSearchList = Object.values(voucherData).map(r=>({
    code:r.code, label: r.sido + ' ' + r.region, sido:r.sido, region:r.region
  }));
}

function computeCentroids(){
  // 이미 그려진 polygons 배열(ring 좌표)로 각 지역의 대략적인 중심점 계산
  const grouped = {};
  polygons.forEach(p=>{
    if(!grouped[p.code]) grouped[p.code] = [];
    grouped[p.code].push(p.ring);
  });
  Object.keys(grouped).forEach(code=>{
    let sumLat=0, sumLng=0, n=0;
    grouped[code].forEach(ring=>{
      ring.forEach(([lng,lat])=>{ sumLat+=lat; sumLng+=lng; n++; });
    });
    if(voucherData[code]) voucherData[code]._centroid = { lat: sumLat/n, lng: sumLng/n };
  });
}

/* ==================== TOP10 우선순위 지역 ==================== */
function renderTop10(){
  const rows = Object.values(voucherData);
  const matched = TOP10_PRIORITY.map(item=>{
    const found = rows.find(r => r.region.includes(item.region) && r.sido.includes(item.sidoHint));
    return found ? { code: found.code, region: found.region, sido: found.sido } : null;
  }).filter(Boolean);

  document.getElementById('top10List').innerHTML = matched.map((m,i)=>`
    <div class="top10-item" onclick="goToRegion('${m.code}')">
      <div class="t10-rank">${i+1}</div>
      <div>
        <div class="t10-name">${m.region}</div>
        <div class="t10-sido">${m.sido}</div>
      </div>
    </div>
  `).join('');
}

/* ==================== 즐겨찾기 (localStorage) ==================== */
function getFavorites(){
  try{ return JSON.parse(localStorage.getItem('fairplay_favorites') || '[]'); }
  catch(e){ return []; }
}
function saveFavorites(list){
  localStorage.setItem('fairplay_favorites', JSON.stringify(list));
}
function isFavorite(code){
  return getFavorites().includes(code);
}
function toggleFavorite(code){
  let favs = getFavorites();
  if(favs.includes(code)){ favs = favs.filter(c=>c!==code); }
  else{ favs.push(code); }
  saveFavorites(favs);
  compareOpen = false; // 목록이 바뀌면 비교화면은 접어서 다시 열게 함
  renderFavorites();
  if(currentPanelCode === code) onRegionClick(code, voucherData[code]);
}
function renderFavorites(){
  const favs = getFavorites();
  const favCard = document.getElementById('favCard');
  const favList = document.getElementById('favList');
  const compareBtn = document.getElementById('compareBtn');
  if(favs.length === 0){ favCard.style.display = 'none'; return; }
  favCard.style.display = 'block';
  favList.innerHTML = favs.map(code=>{
    const row = voucherData[code];
    if(!row) return '';
    return `<span class="fav-chip" onclick="goToRegion('${code}')">📍 ${row.sido} ${row.region}</span>`;
  }).join('');
  compareBtn.style.display = favs.length >= 2 ? 'block' : 'none';
  if(favs.length < 2) document.getElementById('compareBox').innerHTML = '';
}

// 즐겨찾는 동네 여러 곳을 나란히 비교 (수급률·순위·시설 수)
let compareOpen = false;
function toggleCompareFavorites(){
  compareOpen = !compareOpen;
  const box = document.getElementById('compareBox');
  const btn = document.getElementById('compareBtn');
  if(!compareOpen){ box.innerHTML = ''; btn.textContent = '📊 즐겨찾는 동네 비교하기'; return; }
  btn.textContent = '📊 비교 닫기';

  const favs = getFavorites();
  const rows = favs.map(code=>{
    const row = voucherData[code];
    if(!row) return null;
    const facCount = facilityCounts[code] ?? 0;
    return {
      code, name: `${row.sido} ${row.region}`,
      sPct: parseFloat(row.s_pct)||0, nPct: parseFloat(row.n_pct)||0,
      sRank: sRankByCode[code], nRank: nRankByCode[code], facCount
    };
  }).filter(Boolean);

  const bestS = Math.max(...rows.map(r=>r.sPct));
  const bestN = Math.max(...rows.map(r=>r.nPct));
  const bestFac = Math.max(...rows.map(r=>r.facCount));
  currentCompareRows = rows; // 엑셀 다운로드에서 재사용

  box.innerHTML = `<div class="compare-table">
    ${rows.map(r=>`
      <div class="compare-row" onclick="goToRegion('${r.code}')">
        <div class="compare-name">📍 ${r.name}</div>
        <div class="compare-stats">
          <span class="${r.sPct===bestS?'best':''}">기초수급 ${r.sPct}%</span>
          <span class="${r.nPct===bestN?'best':''}">차상위·한부모 ${r.nPct}%</span>
          <span class="${r.facCount===bestFac?'best':''}">시설 ${r.facCount}개</span>
        </div>
      </div>
    `).join('')}
    <div class="compare-hint">💡 초록색으로 표시된 게 즐겨찾기 중 가장 높은 값이에요</div>
    <button class="action-btn" style="width:100%; margin-top:12px;" onclick="downloadCompareExcel()">📊 비교 결과 엑셀로 다운로드</button>
  </div>`;
}

// 즐겨찾기 비교 — 여러 지역을 한 번에 엑셀로 다운로드
function downloadCompareExcel(){
  if(!currentCompareRows.length){ alert('먼저 즐겨찾는 동네를 추가해주세요.'); return; }
  if(typeof XLSX === 'undefined'){ alert('엑셀 저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return; }
  const data = currentCompareRows.map(r => ({
    '지역': r.name,
    '기초생활수급_수급률(%)': r.sPct,
    '차상위한부모_수급률(%)': r.nPct,
    '가맹시설수': r.facCount,
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '지역비교');
  XLSX.writeFile(workbook, `SPOO_지역비교_${data.length}곳.xlsx`);
}

/* ==================== 종목 필터 ==================== */
// 강좌 시작시간을 오전/오후/저녁 구간으로 분류합니다.
// 0~5시 강좌는 실제 새벽 운영이 아니라 시설 측 입력 오류일 가능성이 높아(수집 데이터 검증 결과 약 9%),
// 필터에서는 "오전"에 포함하되 화면엔 원래 시간을 그대로 보여줘 사용자가 직접 판단할 수 있게 합니다.
function getTimeBand(startTm){
  if(!startTm) return null;
  const hour = parseInt(String(startTm).split(':')[0], 10);
  if(isNaN(hour)) return null;
  if(hour < 12) return '오전';
  if(hour < 17) return '오후';
  return '저녁';
}

// 수강료 표시: 정상 범위를 벗어난 값(수집 과정에서 확인된 극소수 오입력, 예: 1원·999999원)은
// 잘못된 숫자를 그대로 보여주지 않고 "가격 문의"로 안내합니다.
function formatPrice(settlAmt){
  const n = Number(settlAmt);
  if(!settlAmt || isNaN(n) || n <= 1000 || n >= 999000) return '가격 문의';
  return n.toLocaleString() + '원';
}

/* ==================== 이용권 지원 + 내 돈 계산 ====================
   2024년 11월부터 월 지원 한도가 10.5만원으로 인상됨 (국민체육진흥공단 공식 확인).
   ⚠ 주의: 강좌 금액의 결제 주기가 강좌마다 다릅니다 (월 단위/분기 단위 등이 섞여 있음).
   315,000원(=한도의 3배, 2025년 5월부터 도입된 3개월 결제 한도)에 몰려있는 강좌들은
   3개월치 금액을 월 요금으로 착각해 계산하면 정반대의 결과를 보여줄 위험이 있어,
   이 구간은 계산하지 않고 "금액 확인 필요"로 안내합니다. */
const VOUCHER_LIMIT = 105000;
function getCostBreakdown(amt){
  const n = Number(amt);
  if(!amt || isNaN(n) || n <= 1000 || n >= 999000) return null; // 오입력값
  if(n >= 315000) return { special: 'confirm' }; // 기간 단위가 다를 가능성이 큰 구간
  return {
    covered: Math.min(n, VOUCHER_LIMIT),
    myCost: Math.max(0, n - VOUCHER_LIMIT)
  };
}
// 강좌 태그 등 좁은 공간에 쓰는 짧은 문구
function getCostLabelShort(amt){
  const b = getCostBreakdown(amt);
  if(!b) return '가격 문의';
  if(b.special === 'confirm') return '금액 확인 필요';
  if(b.myCost === 0) return '내 돈 0원';
  return `내 돈 ${(b.myCost/10000).toLocaleString(undefined,{maximumFractionDigits:1})}만원`;
}
// 강좌 상세 팝업 등 넓은 공간에 쓰는 전체 문구
function getCostLabelFull(amt){
  const b = getCostBreakdown(amt);
  if(!b) return null;
  if(b.special === 'confirm'){
    return { text: '이 강좌는 결제 주기(월/분기 등)가 다를 수 있어 정확한 부담금 계산이 어려워요. 시설에 직접 확인해주세요.', ok:false };
  }
  const text = b.myCost === 0
    ? `월 기준 이용권 ${b.covered.toLocaleString()}원 + 내 돈 0원`
    : `월 기준 이용권 ${b.covered.toLocaleString()}원 + 내 돈 ${b.myCost.toLocaleString()}원`;
  return { text, ok: b.myCost === 0 };
}

let facilityListLimit = 5; // "더보기" 누를 때마다 5개씩 늘어남 (지역 바뀌면 초기화)

// 종목별 아이콘 — 시설 목록·강좌 태그·필터 칩에서 공통으로 사용
function getSportEmoji(typeStr){
  const t = String(typeStr || '');
  const table = [
    [['태권도','합기도','유도','검도','격투기','주짓수'], '🥋'],
    [['복싱','킥복싱'], '🥊'],
    [['수영'], '🏊'],
    [['축구','풋살'], '⚽'],
    [['농구'], '🏀'],
    [['배드민턴'], '🏸'],
    [['탁구'], '🏓'],
    [['테니스'], '🎾'],
    [['볼링'], '🎳'],
    [['골프'], '⛳'],
    [['필라테스','요가'], '🧘'],
    [['헬스','피트니스','크로스핏'], '🏋️'],
    [['댄스','발레','무용','에어로빅'], '💃'],
    [['클라이밍'], '🧗'],
    [['스케이트','인라인','롤러'], '⛸️'],
    [['승마'], '🐴'],
    [['양궁'], '🏹'],
    [['체조'], '🤸'],
  ];
  for(const [keys, emoji] of table){
    if(keys.some(k => t.includes(k))) return emoji;
  }
  return '🏅';
}

// 가격 필터용 구간 분류 (0원 / 3만원까지 / 5만원까지) — 실제 데이터 분포(68.3%/75.6%/84.2%) 기준
function getCostBand(amt){
  const b = getCostBreakdown(amt);
  if(!b || b.special === 'confirm') return '__unknown__';
  if(b.myCost === 0) return 'free';
  if(b.myCost <= 30000) return 'under3';
  if(b.myCost <= 50000) return 'under5';
  return 'over5';
}

function renderFacilityList(facilities, filterType, timeFilter, costFilter){
  const filtered = filterType && filterType !== '__all__'
    ? facilities.filter(f => (f.type||'').includes(filterType))
    : facilities;
  const list = filtered.slice(0, facilityListLimit);

  if(list.length === 0){
    return `<p class="placeholder-msg">이 조건에 맞는 시설이 없어요</p>`;
  }
  const itemsHtml = list.map(f=>{
    // 시설명만으로 찾으면 동명 시설과 섞일 수 있어 "이름+시군구" 키로 조회 (courses.csv에 sgg 없으면 이름만 사용)
    const facilityKey = f.sgg ? `${f.name}|${f.sgg}` : f.name;
    let courses = coursesByFacility[facilityKey] || [];
    if(timeFilter && timeFilter !== '__all__'){
      courses = courses.filter(c => getTimeBand(c.start_tm) === timeFilter);
    }
    if(costFilter && costFilter !== '__all__'){
      courses = courses.filter(c => {
        const band = getCostBand(c.settl_amt);
        if(costFilter === 'free') return band === 'free';
        if(costFilter === 'under3') return ['free','under3'].includes(band);
        if(costFilter === 'under5') return ['free','under3','under5'].includes(band);
        return true;
      });
    }
    // 종목·요일·금액이 완전히 똑같은 강좌는 중복으로 보이니 하나만 남김 (금액은 그대로 정확히 표시)
    const seenCourseKeys = new Set();
    courses = courses.filter(c=>{
      const dupKey = `${c.item_nm||c.course_nm||''}|${c.day||''}|${c.settl_amt||''}`;
      if(seenCourseKeys.has(dupKey)) return false;
      seenCourseKeys.add(dupKey);
      return true;
    });
    const courseTags = courses.slice(0,3).map((c,i)=>{
      const parts = [c.item_nm || c.course_nm, c.day].filter(Boolean);
      const costLabel = getCostLabelShort(c.settl_amt);
      const isFree = costLabel === '내 돈 0원';
      const emoji = getSportEmoji(c.item_nm || c.course_nm);
      const payload = escapeAttr(JSON.stringify({
        facility: f.name, course_nm: c.course_nm||'', item_nm: c.item_nm||'',
        day: c.day||'', start_tm: c.start_tm||'', end_tm: c.end_tm||'',
        settl_amt: c.settl_amt||'', desc: (c.course_seta_desc_cn||'').slice(0,500)
      }));
      return `<span class="course-tag${isFree?' cost-free':''}" onclick="event.stopPropagation(); showCourseDetail('${payload}')">${emoji} ${parts.join(' · ')} · <b>${costLabel}</b>${isFree?' ✅':''} <span class="cm-hint">▸</span></span>`;
    }).join('');
    const hasAnyCourse = courses.length > 0 || (coursesByFacility[facilityKey] || []).length > 0;
    const emptyMsg = timeFilter && timeFilter !== '__all__' && hasAnyCourse
      ? `<div class="course-empty-hint">선택한 시간대엔 강좌가 없어요</div>`
      : `<div class="course-empty-hint">강좌 상세정보 준비 중이에요</div>`;
    const phone = formatPhone(f.tel);
    const phoneHtml = phone ? `<div class="ftel">📞 ${phone}</div>` : '';
    const sportIcon = getSportEmoji(f.type);
    const fkey = escapeAttr(f.sgg ? `${f.name}|${f.sgg}` : f.name);
    return `<div class="facility-item" data-fkey="${fkey}" onclick="showFacilityOnMap('${escapeAttr(f.name)}','${escapeAttr(f.addr)}','${escapeAttr(f.sgg||'')}','${escapeAttr(f.naver_lat||'')}','${escapeAttr(f.naver_lng||'')}')">
      <div class="fname"><span class="sport-icon">${sportIcon}</span><span onclick="event.stopPropagation(); openNaverSearch('${escapeAttr(f.name)}','${escapeAttr(f.addr)}','${escapeAttr(f.sgg||'')}','${escapeAttr(phone||'')}','${escapeAttr(f.naver_title||'')}')">${f.name}</span></div>
      <div class="faddr">📍 ${f.addr}<span class="fdist" style="display:none;"></span></div>
      ${phoneHtml}
      <div class="fhint-row">
        <span class="fhint-tap">👆 눌러서 정확한 위치 확인</span>
        <span class="fhint" onclick="event.stopPropagation(); openNaverMap('${escapeAttr(f.name)}','${escapeAttr(f.addr)}','${escapeAttr(f.sgg||'')}','${escapeAttr(phone||'')}','${escapeAttr(f.naver_title||'')}','${escapeAttr(f.naver_lat||'')}','${escapeAttr(f.naver_lng||'')}')">네이버 지도에서 길찾기 →</span>
      </div>
      ${courseTags || emptyMsg}
    </div>`;
  }).join('');

  const moreHtml = filtered.length > facilityListLimit
    ? `<button class="more-btn" onclick="showMoreFacilities()">더보기 (${filtered.length - facilityListLimit}개 더 있어요) ▾</button>`
    : '';

  return itemsHtml + moreHtml;
}

function showMoreFacilities(){
  facilityListLimit += 5;
  onFilterChange();
}

/* ==================== 처음 이용자 안내 코치마크 (공용 컴포넌트) ====================
   특정 버튼/요소를 "처음 보여줄 때" 딱 한 번, 화살표로 가리키며 짧게 설명해주는 말풍선입니다.
   - key로 localStorage에 "이미 봤음"을 기록해서, 같은 사람에겐 다시 안 뜹니다.
   - 버튼을 실제로 누르면(원래 하려던 행동을 하면) 그것도 "이해했다"로 보고 자동으로 닫고 기록합니다.
   - 화면 바깥을 눌러도 닫히지만, 이 경우엔 "다시 볼 수 있게" 기록하지 않습니다 (실수로 닫았을 수 있으니).
   새로운 곳에 쓰고 싶으면: showCoachmark(document.getElementById('버튼id'), '안내 문구', '고유키');
*/
function showCoachmark(targetEl, message, key, opts){
  if(!targetEl) return;
  if(localStorage.getItem(`fp_tip_seen_${key}`)) return; // 이미 봤으면 다시 안 띄움

  const placement = (opts && opts.placement) || 'top'; // 'top' | 'bottom'

  const wrap = document.createElement('div');
  wrap.className = 'coachmark';
  wrap.innerHTML = `
    <button class="coachmark-close" aria-label="닫기">✕</button>
    <span class="coachmark-text">${message}</span>
    <span class="coachmark-arrow"></span>
  `;
  document.body.appendChild(wrap);

  function position(){
    const r = targetEl.getBoundingClientRect();
    const arrow = wrap.querySelector('.coachmark-arrow');
    const wrapW = wrap.offsetWidth;

    // 화면 밖으로 안 나가게 가로 위치 보정
    let left = r.left + r.width/2 - wrapW/2;
    left = Math.max(12, Math.min(left, window.innerWidth - wrapW - 12));
    wrap.style.left = `${left}px`;

    if(placement === 'top'){
      wrap.style.top = `${r.top - wrap.offsetHeight - 12}px`;
      arrow.style.bottom = '-5px';
    } else {
      wrap.style.top = `${r.bottom + 12}px`;
      arrow.style.top = '-5px';
    }
    // 화살표는 항상 대상 버튼의 가운데를 가리키도록
    const arrowLeft = Math.max(14, Math.min(r.left + r.width/2 - left - 6, wrapW - 20));
    arrow.style.left = `${arrowLeft}px`;
  }

  position();
  requestAnimationFrame(()=> wrap.classList.add('show'));
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);

  function cleanup(){
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    wrap.remove();
  }
  function markSeen(){ localStorage.setItem(`fp_tip_seen_${key}`, '1'); }

  // 버튼을 실제로 눌러서 원래 동작을 했다면: 이해한 것으로 보고 기록 + 닫기
  targetEl.addEventListener('click', ()=>{ markSeen(); cleanup(); }, { once:true });
  // 닫기(x) 버튼: 기록하고 닫기
  wrap.querySelector('.coachmark-close').addEventListener('click', (e)=>{
    e.stopPropagation(); markSeen(); cleanup();
  });
  // 말풍선 바깥을 누르면: 닫기만 하고, 다음에 다시 보여줄 수 있도록 기록은 안 함
  setTimeout(()=>{
    document.addEventListener('click', function onOutside(e){
      if(!wrap.contains(e.target) && e.target !== targetEl){
        document.removeEventListener('click', onOutside);
        cleanup();
      }
    });
  }, 0);
}

// 옆동네 시설 포함 보기 토글 (기능1) — 실제로 눌렀을 때만 이웃 지역 데이터를 불러옵니다
async function toggleNeighborFacilities(){
  const btn = document.getElementById('neighborToggleBtn');
  if(!btn) return;
  facilityListLimit = 5;

  // 아직 이웃 지역 데이터를 안 받아왔으면(처음 누른 경우) 지금 받아옵니다
  if(!currentPanelIncludingNeighbors){
    const originalText = btn.textContent;
    btn.textContent = '불러오는 중...';
    btn.disabled = true;
    const neighborFacilitiesArrays = await Promise.all(currentPanelNeighborCodes.map(nc => getRegionFacilities(nc)));
    currentPanelIncludingNeighbors = currentPanelOwnOnly.concat(...neighborFacilitiesArrays);
    btn.disabled = false;
  }

  const showingAll = currentPanelFacilities === currentPanelIncludingNeighbors;
  if(showingAll){
    currentPanelFacilities = currentPanelOwnOnly;
    btn.textContent = `옆 동네 포함 총 ${currentPanelIncludingNeighbors.length}개 시설 보기 →`;
  } else {
    currentPanelFacilities = currentPanelIncludingNeighbors;
    btn.textContent = `우리 동네만 다시 보기 (${currentPanelOwnOnly.length}개)`;
  }
  onFilterChange();
}

// 강좌 가격 상세 팝업 (정확한 금액 + 강좌 정보 + 시설 안내문)
function showCourseDetail(jsonStr){
  let c;
  try{ c = JSON.parse(jsonStr); }catch(e){ return; }

  const amt = Number(c.settl_amt);
  const validAmt = c.settl_amt && !isNaN(amt) && amt > 1000 && amt < 999000;
  const priceHtml = validAmt
    ? `${amt.toLocaleString()}<span style="font-size:15px;">원</span>`
    : `가격 문의`;

  const costInfo = getCostLabelFull(c.settl_amt);
  const costHtml = costInfo
    ? `<div class="cm-cost ${costInfo.ok ? 'ok' : (costInfo.text.includes('확인') ? 'warn' : '')}">${costInfo.text}</div>`
    : '';

  const timeRange = (c.start_tm && c.end_tm) ? `${c.start_tm} ~ ${c.end_tm}` : (c.start_tm || '정보 없음');

  const rows = [
    ['종목', c.item_nm || '-'],
    ['요일', c.day || '-'],
    ['운영 시간', timeRange],
  ].map(([label,val])=>`<div class="cm-row"><span>${label}</span><span>${val}</span></div>`).join('');

  const descHtml = c.desc && c.desc.trim()
    ? `<div class="cm-desc">🏢 시설 안내문<br>${c.desc.replace(/</g,'&lt;')}</div>`
    : '';

  document.getElementById('courseModalBody').innerHTML = `
    <h3>${c.course_nm || c.item_nm || '강좌 정보'}</h3>
    <div class="cm-facility">${c.facility}</div>
    <div class="cm-price">${priceHtml}</div>
    ${costHtml}
    <div class="cm-price-note">
      ${validAmt
        ? '스포츠강좌이용권 등록 기준 결제금액이에요. 정확한 결제 단위(월/1회/기간권 등)는 시설마다 다를 수 있어\n등록 전 시설에 꼭 확인해보세요.'
        : '이 강좌는 표시된 가격이 정상 범위를 벗어나 있어요. 정확한 금액은 시설에 문의해주세요.'}
    </div>
    ${rows}
    ${descHtml}
  `;
  document.getElementById('courseModalOverlay').classList.add('show');
}
function closeCourseDetail(){
  document.getElementById('courseModalOverlay').classList.remove('show');
}

function onFilterChange(){
  const typeSel = document.getElementById('typeFilter');
  const timeSel = document.getElementById('timeFilter');
  const costSel = document.getElementById('costFilter');
  const listBox = document.getElementById('facilityListBox');
  if(!listBox) return;
  const typeVal = typeSel ? typeSel.value : '__all__';
  const timeVal = timeSel ? timeSel.value : '__all__';
  const costVal = costSel ? costSel.value : '__all__';
  listBox.innerHTML = renderFacilityList(currentPanelFacilities, typeVal, timeVal, costVal);
  document.querySelectorAll('#typeChips .chip').forEach(el=>{
    el.classList.toggle('active', el.dataset.type === typeVal);
  });
  // 종목 필터를 바꾸면 지도 핀도 그 종목에 맞게 다시 찍어줌
  if(currentStep === 3){
    const filtered = (typeVal !== '__all__')
      ? currentPanelFacilities.filter(f => (f.type||'').includes(typeVal))
      : currentPanelFacilities;
    placeFacilityPinsFor(filtered);
  }
  updateFilterBadge();
}

// 필터 바텀시트 (3단계) — 평소엔 접어두고 버튼 눌렀을 때만 펼침
function openFilterSheet(){ document.getElementById('filterSheetOverlay').classList.add('show'); }
function closeFilterSheet(){ document.getElementById('filterSheetOverlay').classList.remove('show'); }

/* ==================== 「지역 현황 보기」— 정책·현장 담당자, 연구자, 기자 등 ====================
   검증 완료(기획서 기준): 지역 유형 진단, 유형별 대응 방향, 시도 단위 집계, 목표 설정 계산,
   시설당 대상자 수(포화도), 결과 이미지 저장. "비슷한 규모 지역 비교"는 인구 데이터가 없어 보류. */
// 헤더 "더 알아보기" 드롭다운 — 담당자·운영자용 링크를 하나로 묶어 헤더가 덜 복잡해 보이게 함
function toggleHeaderMoreMenu(){
  const menu = document.getElementById('headerMoreMenu');
  closeLangMenu();
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}
function closeHeaderMoreMenu(){
  document.getElementById('headerMoreMenu').style.display = 'none';
}
document.addEventListener('click', (e)=>{
  const menu = document.getElementById('headerMoreMenu');
  if(menu && menu.style.display === 'block' && !e.target.closest('#headerMoreMenu') && !e.target.closest('.header-link')){
    menu.style.display = 'none';
  }
  const langMenu = document.getElementById('langMenu');
  if(langMenu && langMenu.style.display === 'block' && !e.target.closest('#langMenu') && !e.target.closest('.header-link')){
    langMenu.style.display = 'none';
  }
});

function openRegionView(){
  bindRegionViewSearch();
  document.getElementById('regionViewOverlay').classList.add('show');
  document.getElementById('rvSearchInput').focus();
}
function closeRegionView(){
  document.getElementById('regionViewOverlay').classList.remove('show');
}

const RESPONSE_TEXT = {
  'type-both': { title: '양쪽 모두 최우선 유형', desc: '두 집단 모두 최하위권이에요. 복합 대응이 필요하고, 지역 여건에 따른 판단이 필요해요.' },
  'type-city': { title: '대도시형', desc: '차상위·한부모 집단만 유독 저조해요. 이 집단은 시설 밀도와 통계적으로 무관해서(상관 -0.072), 시설 확충보다 학교·지역아동센터 연계, 신청 창구 접근성 개선 등 인지도 개선에 우선 배분하는 게 효과적일 수 있어요.' },
  'type-rural': { title: '농어촌형', desc: '대상 인원 자체가 적은 편이에요(전국 평균 483명). 기초생활수급 집단은 시설 밀도와 관련 있어서(상관 0.494), 비율(%)보다 실인원 기준으로 관리하고 개별 접촉을 시도하는 게 유효할 수 있어요.' },
  'type-good': { title: '양호', desc: '두 집단 모두 비교적 잘 받고 있는 지역이에요. 다만 실제 미수급 인원이 있는지는 아래 수치로 함께 확인해보세요.' },
};

// 5-2 ② 비슷한 규모 지역과 비교 — 인구 4구간(5만↓/5~15만/15~50만/50만↑)으로 묶어서
// "인구 2만 명 농촌이 서울 강남구와 같은 기준으로 비교되는" 문제를 완화. 데이터 없으면 조용히 생략.
function classifyPopulationBucket(pop){
  if(pop == null) return null;
  if(pop <= 50000) return { key:'b1', label:'5만 명 이하' };
  if(pop <= 150000) return { key:'b2', label:'5~15만 명' };
  if(pop <= 500000) return { key:'b3', label:'15~50만 명' };
  return { key:'b4', label:'50만 명 이상' };
}
function renderPopulationCompareSection(row){
  const pop = regionPopulation[row.code];
  if(pop == null) return ''; // 인구 데이터 없으면 이 섹션 자체를 생략 (다른 기능엔 영향 없음)
  const bucket = classifyPopulationBucket(pop);
  const peers = Object.values(voucherData).filter(r => {
    const p = regionPopulation[r.code];
    return p != null && classifyPopulationBucket(p).key === bucket.key;
  });
  const peerAvgS = peers.reduce((s,r)=> s + parseFloat(r.s_pct), 0) / peers.length;
  const sortedByS = [...peers].sort((a,b)=> parseFloat(b.s_pct) - parseFloat(a.s_pct));
  const peerRank = sortedByS.findIndex(r => r.code === row.code) + 1;

  return `
      <div class="rv2-card rv2-card-white">
        <div class="rv2-card-label">📐 비슷한 규모 지역과 비교</div>
        <p style="font-size:var(--fs-caption); color:var(--ink-faint); margin:-4px 0 10px;">인구 ${pop.toLocaleString()}명 · "${bucket.label}" 그룹 (${peers.length}곳)과 비교했어요</p>
        <div class="rv2-stat-row">
          <div class="rv2-stat"><div class="rv2-stat-num">${peerRank}/${peers.length}위</div><div class="rv2-stat-label">같은 규모 그룹 내 순위(기초수급)</div></div>
          <div class="rv2-stat"><div class="rv2-stat-num">${peerAvgS.toFixed(1)}%</div><div class="rv2-stat-label">같은 규모 그룹 평균 수급률</div></div>
        </div>
      </div>`;
}

function renderRegionView(code){
  currentRvCode = code;
  const row = voucherData[code];
  if(!row) return;
  const type = classifyRegion(row);
  const info = RESPONSE_TEXT[type.cls];
  const sPct = parseFloat(row.s_pct), nPct = parseFloat(row.n_pct);
  const sRank = sRankByCode[code], nRank = nRankByCode[code];
  const totalRegions = Object.keys(voucherData).length;
  const sido = sidoStats[row.sido] || {};
  const facCount = facilityCounts[code] ?? 0;
  const totalTarget = (Number(row.s_target)||0) + (Number(row.n_target)||0);
  const perFacility = facCount ? (totalTarget / facCount) : null;

  // 목표 설정 계산 (전국 중위 수급률 대비 추가 발굴 필요 인원) — 단정하지 않고 참고 지표로 안내
  const sGoal = Math.max(0, Math.round((medianSPct/100) * (Number(row.s_target)||0) - (Number(row.s_recv)||0)));
  const nGoal = Math.max(0, Math.round((medianNPct/100) * (Number(row.n_target)||0) - (Number(row.n_recv)||0)));

  // "10명 중 N명" 식 문구용 근사치
  const sOutOfTen = Math.max(0, Math.min(10, Math.round(sPct/10)));
  const nOutOfHundred = Math.max(0, Math.round(nPct));
  const isUrgent = sRank <= totalRegions/2;
  const rankPhrase = isUrgent
    ? '도움이 가장 시급한 지역 중 하나예요.'
    : '전국 평균보다 비교적 잘 받고 있는 지역이에요.';

  document.getElementById('rvContent').innerHTML = `
    <div id="rvSaveArea">
      <div class="rv2-location-row">
        <span>📍 ${row.sido} ${row.region}</span>
        <span class="rv2-change-link" onclick="document.getElementById('rvSearchInput')?.focus()">변경 ›</span>
      </div>

      <div class="rv2-card rv2-card-white">
        <div class="rv2-card-label">🔍 ${row.region} 데이터로 확인해보니</div>
        <div class="rv2-card-headline">기초생활수급 가정은 10명 중 <b>${sOutOfTen}명</b>이 받고 있지만, 차상위·한부모 가정은 100명 중 <b>${nOutOfHundred}명</b>만 받고 있어요.</div>
        <div class="rv2-stat-row">
          <div class="rv2-stat"><div class="rv2-stat-num">${Math.round(Number(row.s_target)||0).toLocaleString()}명</div><div class="rv2-stat-label">S그룹 대상</div></div>
          <div class="rv2-stat"><div class="rv2-stat-num">${sPct.toFixed(1)}%</div><div class="rv2-stat-label">S그룹 수급률</div></div>
          <div class="rv2-stat"><div class="rv2-stat-num">${nPct.toFixed(1)}%</div><div class="rv2-stat-label">N그룹 수급률</div></div>
        </div>
      </div>

      <div class="rv2-card rv2-card-blue">
        <div class="rv2-card-label">📊 전국에서 비교해보면</div>
        <div class="rv2-card-headline">${row.region}은 229곳 중 <b>${sRank}위</b>로, ${rankPhrase}</div>
      </div>

      <div class="rv2-card rv2-card-mint">
        <div class="rv2-card-label">🌱 이 지역엔 이런 접근이 맞아요</div>
        <div class="rv2-card-title">${info.title}</div>
        <div class="rv2-card-desc">${info.desc}</div>
      </div>

      <div class="rv2-card rv2-card-white">
        <div class="rv2-card-label">🗺️ ${row.sido} 시도 단위 집계</div>
        <div class="rv2-stat-row">
          <div class="rv2-stat"><div class="rv2-stat-num">${sido.sPct ? sido.sPct.toFixed(1) : '-'}%</div><div class="rv2-stat-label">${row.sido} 평균(기초수급) · 17개 시도 중 ${sido.sRank||'-'}위</div></div>
          <div class="rv2-stat"><div class="rv2-stat-num">${sido.count||'-'}개</div><div class="rv2-stat-label">${row.sido} 내 시군구 수</div></div>
        </div>
      </div>

      ${renderPopulationCompareSection(row)}

      <div class="rv2-card rv2-card-white">
        <div class="rv2-card-label">🎯 목표 설정 계산 <span style="font-weight:500; color:var(--ink-faint);">(참고 지표)</span></div>
        <div style="font-size:var(--fs-label); color:var(--ink-sub); line-height:1.7;">
          전국 중위 수급률(기초생활수급 ${medianSPct.toFixed(1)}%)에 도달하려면<br>
          <b style="color:var(--ink);">${sGoal.toLocaleString()}명</b> 규모의 추가 발굴이 필요해요 (차상위·한부모는 <b style="color:var(--ink);">${nGoal.toLocaleString()}명</b>).<br>
          <span style="font-size:var(--fs-caption); opacity:.85;">※ 실제 선정은 예산과 지자체 심사에 따라 달라질 수 있는 참고 수치예요.</span>
        </div>
      </div>

      <div class="rv2-card rv2-card-white">
        <div class="rv2-card-label">🏢 시설당 대상자 수 (포화도)</div>
        ${perFacility
          ? `<div class="rv2-stat-row">
               <div class="rv2-stat"><div class="rv2-stat-num">${perFacility.toFixed(1)}명</div><div class="rv2-stat-label">가맹시설 ${facCount}개 · 시설 1곳당 대상자</div></div>
               <div class="rv2-stat"><div class="rv2-stat-num">15.3명</div><div class="rv2-stat-label">전국 중위 (비교 기준)</div></div>
             </div>`
          : `<p class="placeholder-msg" style="margin:0;">이 지역은 가맹시설이 없어 계산할 수 없어요.</p>`}
      </div>
    </div>

    <button class="action-btn" style="width:100%; margin-top:20px;" onclick="saveRegionViewResult()">📸 지역 현황 이미지로 저장</button>
    <div style="display:flex; gap:8px; margin-top:8px;">
      <button class="action-btn" style="flex:1;" onclick="downloadRegionPDF()">📄 PDF로 저장</button>
      <button class="action-btn" style="flex:1;" onclick="downloadRegionExcel()">📊 엑셀로 다운로드</button>
    </div>
  `;
}

function saveRegionViewResult(){
  const target = document.getElementById('rvSaveArea');
  if(!target){ alert('먼저 지역을 검색해주세요.'); return; }
  if(typeof html2canvas === 'undefined'){ alert('저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return; }
  html2canvas(target, { backgroundColor:'#ffffff', scale:2 }).then(canvas=>{
    const link = document.createElement('a');
    link.download = 'spoo-지역현황.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

// PDF로 저장 — 화면 캡처형(방법 A). 한글 폰트 깨짐 걱정이 없어 가장 안전한 방식.
async function downloadRegionPDF(){
  const target = document.getElementById('rvSaveArea');
  if(!target){ alert('먼저 지역을 검색해주세요.'); return; }
  if(typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined'){
    alert('PDF 저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return;
  }
  const row = voucherData[currentRvCode];
  const canvas = await html2canvas(target, { backgroundColor:'#ffffff', scale:2 });
  const imgData = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const imgWidth = pageWidth - 40;
  const imgHeight = canvas.height * (imgWidth / canvas.width);
  pdf.addImage(imgData, 'PNG', 20, 20, imgWidth, imgHeight);
  pdf.save(`SPOO_${row ? row.region : '지역'}_현황.pdf`);
}

// 엑셀로 다운로드 — 서버 없이 브라우저 안에서 즉시 생성 (SheetJS, 공식 CDN 사용)
function downloadRegionExcel(){
  const row = voucherData[currentRvCode];
  if(!row){ alert('먼저 지역을 검색해주세요.'); return; }
  if(typeof XLSX === 'undefined'){ alert('엑셀 저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return; }
  const facCount = facilityCounts[currentRvCode] ?? 0;
  const type = classifyRegion(row);
  const info = RESPONSE_TEXT[type.cls];
  const data = [{
    '지역': `${row.sido} ${row.region}`,
    '기초생활수급_대상인원': row.s_target,
    '기초생활수급_수급인원': row.s_recv,
    '기초생활수급_수급률(%)': row.s_pct,
    '기초생활수급_전국순위': sRankByCode[currentRvCode],
    '차상위한부모_대상인원': row.n_target,
    '차상위한부모_수급인원': row.n_recv,
    '차상위한부모_수급률(%)': row.n_pct,
    '차상위한부모_전국순위': nRankByCode[currentRvCode],
    '가맹시설수': facCount,
    '지역유형': info ? info.title : '',
    '조회일자': new Date().toLocaleDateString('ko-KR'),
  }];
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '지역현황');
  XLSX.writeFile(workbook, `SPOO_${row.region}_현황.xlsx`);
}

// 정책·현장 담당자용 — 전국 229개 지역 종합 데이터를 CSV(엑셀에서 바로 열림)로 다운로드.
// 서버 저장 없이 브라우저 안에서 이미 불러온 데이터로 즉시 생성합니다.
function downloadRegionDataCSV(){
  const header = ['시도','시군구','기초생활수급_대상','기초생활수급_수급','기초생활수급_수급률(%)','기초생활수급_전국순위',
                   '차상위한부모_대상','차상위한부모_수급','차상위한부모_수급률(%)','차상위한부모_전국순위',
                   '가맹시설수','지역유형'];
  const rows = Object.values(voucherData).map(row=>{
    const facCount = facilityCounts[row.code] ?? 0;
    const type = classifyRegion(row);
    const info = RESPONSE_TEXT[type.cls];
    return [
      row.sido, row.region,
      row.s_target, row.s_recv, row.s_pct, sRankByCode[row.code],
      row.n_target, row.n_recv, row.n_pct, nRankByCode[row.code],
      facCount, info ? info.title : ''
    ];
  });
  const csvLines = [header, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));
  const csvContent = '\ufeff' + csvLines.join('\r\n'); // BOM 포함 — 엑셀에서 한글 깨짐 방지
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SPOO_전국지역데이터_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/* ==================== 「시설 운영자」— 가맹 여부와 상관없이 잠재수요·포화도·차별화 확인 ====================
   기획서 5-3 기준: ①잠재 수요 확인 ②포화도 확인 ③지역 내 차별화 확인 ④가맹 신청 절차 안내 ⑤내 시설 정보 조회.
   모두 이미 있는 데이터(voucherData, facilitiesByRegion)로 계산하는 조회형 기능이라 회원가입·서버가 필요 없음. */
let fvSelectedCode = null;
let fvLastStats = {};
let currentCompareRows = [];

function openFacilityView(){
  bindFacilityViewSearch();
  document.getElementById('facilityViewOverlay').classList.add('show');
  document.getElementById('fvRegionInput').focus();
}
function closeFacilityView(){
  document.getElementById('facilityViewOverlay').classList.remove('show');
}

// 시설 정보 수정 요청 — 회원가입·서버 없이, 필요한 항목을 미리 채운 이메일을 여는 방식으로 처리.
// 인증 서류(사업자등록증 등)는 이용자가 이메일에 직접 첨부해서 보내주시면 됩니다.
function openCorrectionMail(){
  const facilityName = (document.getElementById('fvFacilitySearch')?.value || '').trim();
  const subject = encodeURIComponent(`[SPOO] 시설 정보 수정 요청${facilityName ? ' - ' + facilityName : ''}`);
  const body = encodeURIComponent(
`안녕하세요, SPOO 운영자입니다.

아래 항목을 채워서 보내주시면 확인 후 정보를 수정해드릴게요.

■ 시설명 :
■ 주소 :
■ 수정이 필요한 내용 :


■ 첨부해주세요 (이 메일에 파일로 첨부)
- 사업자등록증 사본
- 시설 운영을 증명할 수 있는 서류 (가맹시설 등록증 등)

감사합니다.`
  );
  window.location.href = `mailto:circle1597@naver.com?subject=${subject}&body=${body}`;
}

function bindFacilityViewSearch(){
  const input = document.getElementById('fvRegionInput');
  const suggest = document.getElementById('fvRegionSuggest');
  if(!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  input.addEventListener('input', ()=>{
    const q = input.value.trim();
    if(!q){ suggest.style.display='none'; return; }
    const matches = regionSearchList.filter(r => r.label.includes(q)).slice(0,8);
    if(!matches.length){ suggest.style.display='none'; return; }
    suggest.innerHTML = matches.map(m=>`<div class="sugg-item" data-code="${m.code}">${m.label}</div>`).join('');
    suggest.style.display='block';
    suggest.querySelectorAll('.sugg-item').forEach(el=>{
      el.onclick = () => {
        input.value = el.textContent;
        suggest.style.display='none';
        renderFacilityViewRegion(el.dataset.code);
      };
    });
  });
}

// ①②: 우리 지역 잠재 수요(S+N 미수급 합계) · 포화도(시설 1곳당 대상자 수)
async function renderFacilityViewRegion(code){
  const row = voucherData[code];
  if(!row) return;
  fvSelectedCode = code;
  document.getElementById('fvRegionContent').innerHTML = `<p class="placeholder-msg" style="margin-top:14px;">불러오는 중...</p>`;
  document.getElementById('fvDiffBox').innerHTML = `<p class="placeholder-msg" style="margin:0;">불러오는 중...</p>`;

  const facilities = await getRegionFacilities(code);
  const facCount = facilities.length;
  const unmet = Math.max(0, (Number(row.s_target)||0) - (Number(row.s_recv)||0))
              + Math.max(0, (Number(row.n_target)||0) - (Number(row.n_recv)||0));
  const totalTarget = (Number(row.s_target)||0) + (Number(row.n_target)||0);
  const perFacility = facCount ? (totalTarget / facCount) : null;
  fvLastStats = { code, unmet, facCount, perFacility }; // PDF·엑셀 다운로드에서 재사용

  document.getElementById('fvRegionContent').innerHTML = `
    <div id="fvSaveArea">
      <h3 style="margin:14px 0 2px;">${row.sido} ${row.region}</h3>
      <div class="rv-stat-row" style="margin-top:10px;">
        <div class="rv-stat-box"><div class="rv-stat-num">${Math.round(unmet).toLocaleString()}명</div><div class="rv-stat-label">잠재 수요 (미수급 인원 합계)</div></div>
        <div class="rv-stat-box"><div class="rv-stat-num">${facCount}개</div><div class="rv-stat-label">현재 가맹시설 수</div></div>
      </div>
      ${perFacility ? `
      <div class="rv-goal-box" style="margin-top:12px;">
        이 지역은 가맹시설 <b>1곳당 평균 ${perFacility.toFixed(1)}명</b>을 담당하고 있어요 (전국 중위 <b>15.3명</b>).<br>
        <span style="font-size:var(--fs-caption); opacity:.85;">※ 실제 가맹 여부는 사업성 검토가 필요한 참고 지표예요.</span>
      </div>` : `<p class="placeholder-msg" style="margin-top:12px;">이 지역은 아직 가맹시설이 없어요.</p>`}
    </div>
    <div style="display:flex; gap:8px; margin-top:14px;">
      <button class="action-btn" style="flex:1;" onclick="downloadFacilityPDF()">📄 PDF로 저장</button>
      <button class="action-btn" style="flex:1;" onclick="downloadFacilityExcel()">📊 엑셀로 다운로드</button>
    </div>
  `;

  renderFacilityDiffBox(code, facilities);
}

// 시설 운영자용 PDF 저장 (화면 캡처형)
async function downloadFacilityPDF(){
  const target = document.getElementById('fvSaveArea');
  if(!target){ alert('먼저 지역을 검색해주세요.'); return; }
  if(typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined'){
    alert('PDF 저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return;
  }
  const row = voucherData[fvLastStats.code];
  const canvas = await html2canvas(target, { backgroundColor:'#ffffff', scale:2 });
  const imgData = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation:'portrait', unit:'pt', format:'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const imgWidth = pageWidth - 40;
  const imgHeight = canvas.height * (imgWidth / canvas.width);
  pdf.addImage(imgData, 'PNG', 20, 20, imgWidth, imgHeight);
  pdf.save(`SPOO_${row ? row.region : '지역'}_시설운영자자료.pdf`);
}

// 시설 운영자용 엑셀 다운로드
function downloadFacilityExcel(){
  const row = voucherData[fvLastStats.code];
  if(!row){ alert('먼저 지역을 검색해주세요.'); return; }
  if(typeof XLSX === 'undefined'){ alert('엑셀 저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return; }
  const data = [{
    '지역': `${row.sido} ${row.region}`,
    '잠재수요(미수급 합계)': fvLastStats.unmet,
    '가맹시설수': fvLastStats.facCount,
    '시설당_평균담당인원': fvLastStats.perFacility ? fvLastStats.perFacility.toFixed(1) : '',
    '전국중위_시설당담당인원': 15.3,
    '조회일자': new Date().toLocaleDateString('ko-KR'),
  }];
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '시설운영자자료');
  XLSX.writeFile(workbook, `SPOO_${row.region}_시설운영자자료.xlsx`);
}

// ③: 지역 내 차별화 확인 — 선택한 종목의 가맹시설이 이 지역에 몇 곳인지 (1곳이면 "유일" 안내)
// facilities는 renderFacilityViewRegion에서 이미 fetch한 배열을 그대로 받아 재요청하지 않습니다.
function renderFacilityDiffBox(code, facilities){
  const row = voucherData[code];
  const typeCount = {};
  facilities.forEach(f=>{
    (f.type||'').split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>{
      typeCount[t] = (typeCount[t]||0) + 1;
    });
  });
  const types = Object.keys(typeCount).sort();
  if(!types.length){
    document.getElementById('fvDiffBox').innerHTML = `<p class="placeholder-msg" style="margin:0;">${row.sido} ${row.region}엔 아직 등록된 가맹시설이 없어요.</p>`;
    return;
  }
  const options = types.map(t=>`<option value="${t}">${t} (${typeCount[t]}곳)</option>`).join('');
  document.getElementById('fvDiffBox').innerHTML = `
    <select id="fvDiffSelect" class="recommend-select" style="width:100%;">${options}</select>
    <div id="fvDiffResult" style="margin-top:10px;"></div>
  `;
  const showDiff = () => {
    const t = document.getElementById('fvDiffSelect').value;
    const c = typeCount[t] || 0;
    const resultEl = document.getElementById('fvDiffResult');
    if(c <= 1){
      resultEl.innerHTML = `<div class="rv-goal-box">🎯 ${row.sido} ${row.region}에서 <b>"${t}"</b> 가맹시설은 <b>귀 시설이 유일</b>해요.</div>`;
    } else {
      resultEl.innerHTML = `<p class="placeholder-msg" style="margin:0;">${row.sido} ${row.region}에는 "${t}" 가맹시설이 <b>${c}곳</b> 있어요.</p>`;
    }
  };
  document.getElementById('fvDiffSelect').onchange = showDiff;
  showDiff();
}

// ⑤: 내 시설 정보 조회 — 이름 중복이 많아(예: "해동검도" 전국 45곳) 시도·시군구·주소를 함께 표시
(function bindFacilityNameSearch(){
  document.addEventListener('input', (e)=>{
    if(e.target && e.target.id === 'fvFacilitySearch'){
      const q = e.target.value.trim();
      const resultsEl = document.getElementById('fvFacilityResults');
      if(q.length < 2){ resultsEl.innerHTML=''; return; }
      const matches = facilityNameIndex.filter(f => (f.name||'').includes(q)).slice(0, 20);
      if(!matches.length){
        resultsEl.innerHTML = `<p class="placeholder-msg" style="margin:0;">일치하는 시설이 없어요.</p>`;
        return;
      }
      resultsEl.innerHTML = matches.map(f=>`
        <div class="neighbor-row" style="border-bottom:1px solid var(--line); padding:8px 0;">
          <span><b>${f.name}</b><br><span style="color:var(--ink-faint); font-size:12px;">${f.sido} ${f.sgg} · ${f.addr||''}</span></span>
        </div>
      `).join('');
    }
  });
})();

function resetFilterSheet(){
  ['timeFilter','costFilter'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = '__all__';
  });
  updateFilterBadge();
}
function updateFilterBadge(){
  const badge = document.getElementById('filterActiveBadge');
  if(!badge) return;
  const ids = ['typeFilter','timeFilter','costFilter'];
  const activeCount = ids.filter(id=>{
    const el = document.getElementById(id);
    return el && el.value !== '__all__';
  }).length;
  if(activeCount > 0){ badge.textContent = activeCount; badge.style.display = 'inline-flex'; }
  else{ badge.style.display = 'none'; }
}

// 인기 종목 칩 클릭 → 종목 드롭다운과 연동 (다시 누르면 선택 해제)
function selectTypeChip(type){
  const sel = document.getElementById('typeFilter');
  if(!sel) return;
  sel.value = (sel.value === type) ? '__all__' : type;
  facilityListLimit = 5;
  onFilterChange();
}

/* ==================== 공유하기 ==================== */
function shareRegion(){
  const row = voucherData[currentPanelCode];
  if(!row) return;
  const text = `${row.sido} ${row.region}의 스포츠강좌이용권 지원 현황을 SPOO에서 확인해보세요!`;
  if(navigator.share){
    navigator.share({ title:'SPOO', text, url: location.href }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(`${text}\n${location.href}`).then(()=>{
      alert('링크를 복사했어요! 카카오톡 등에 붙여넣어 공유해보세요 😊');
    }).catch(()=>{
      alert('공유하기를 지원하지 않는 환경이에요. 주소를 직접 복사해주세요.');
    });
  }
}

/* ==================== 진단 결과 저장(이미지) ==================== */
function saveDiagnoseResult(){
  const target = document.querySelector('#s1-resultIntro .s1-vcenter-inner');
  if(!target || !document.getElementById('resultIntroTitle')?.textContent.trim()){
    alert('저장할 결과가 없어요. 자가진단을 먼저 완료해주세요.'); return;
  }
  if(typeof html2canvas === 'undefined'){ alert('저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return; }
  html2canvas(target, { backgroundColor:"#ffffff", scale:2 }).then(canvas=>{
    const link = document.createElement('a');
    link.download = 'spoo-결과.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

// 우리동네 현황(수급률·순위)도 이미지로 저장 — 카톡 공유하면 그 자체로 홍보가 됨
function saveRegionResult(){
  const target = document.getElementById('regionStatsCard');
  if(!target || !currentPanelCode){ alert('먼저 지도에서 동네를 선택해주세요.'); return; }
  if(typeof html2canvas === 'undefined'){ alert('저장 기능을 불러오지 못했어요. 인터넷 연결을 확인해주세요.'); return; }
  html2canvas(target, { backgroundColor:'#ffffff', scale:2 }).then(canvas=>{
    const link = document.createElement('a');
    link.download = 'spoo-우리동네현황.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

/* ==================== 온보딩 (대화형, 페이지별 애니메이션) ==================== */
let wpCurrentPage = 0;
let wpHistory = [];
// 진행 점(dot) 표시용 — 메인 흐름상의 페이지 순서 (분기 페이지 2b/2c는 점에 포함 안 함)
const WP_DOT_MAIN_PAGES = ['1','2','4','3'];

// 어떤 상황에서도 온보딩 페이지가 두 개 이상 겹쳐 보이지 않도록,
// 보여줄 페이지를 정하기 전에 나머지는 전부 강제로 숨김
function wpShowOnly(id){
  document.querySelectorAll('.welcome-overlay > .wp').forEach(el=>{
    if(el.id !== `wp${id}`){
      el.classList.remove('wp-enter','wp-exit');
      el.style.display = 'none';
    }
  });
  const target = document.getElementById(`wp${id}`);
  target.style.display = 'flex';
  target.classList.add('wp-enter');
  setTimeout(()=>target.classList.remove('wp-enter'), 350);
  const firstInput = target.querySelector('input');
  if(firstInput) setTimeout(()=>firstInput.focus(), 200);
  return target;
}

function initOnboarding(){
  // 테스트용: 주소 끝에 ?reset 붙이면 온보딩을 처음부터 다시 보여줌 (예: .../Fairflay/?reset)
  if(new URLSearchParams(location.search).has('reset')){
    localStorage.removeItem('fairplay_onboarded');
    localStorage.removeItem('fairplay_name');
    localStorage.removeItem('fairplay_child_name');
    localStorage.removeItem('fairplay_display_name');
    localStorage.removeItem('fairplay_birth');
    localStorage.removeItem('fairplay_age');
    localStorage.removeItem('fairplay_household');
    localStorage.removeItem('fairplay_goal');
  }
  if(localStorage.getItem('fairplay_onboarded')){
    // 이미 온보딩 완료 — 저장된 정보만 미리 반영해두고, 화면은 아래에서 처음 방문자와
    // 똑같이 스플래시("SPOO · 시작하기")부터 보여줌. "시작하기"를 누르면 wpSplashNext()가
    // 재방문자인지 확인해서 짧은 환영 화면(Return)으로 자연스럽게 이어줌.
    applyStoredProfile();
    applyReturnGreeting();
  }
  wpCurrentPage = 0;
  wpShowOnly(0);
  document.getElementById('welcomeOverlay').classList.add('show');
}

// 스플래시("시작하기") 버튼 — 처음 방문자는 "시작해볼까요?"(이름 입력, 1)로,
// 재방문자는 "오늘은 어떤 걸 알아볼까요?" 짧은 메뉴 화면(Return)으로 안내
function wpSplashNext(){
  wpHistory.push(0);
  const isReturning = localStorage.getItem('fairplay_onboarded') && localStorage.getItem('fairplay_name');
  if(isReturning){
    wpCurrentPage = 'Return';
    wpShowOnly('Return');
  } else {
    wpGoTo(1, true);
  }
}

// 재방문자가 "내 나이·이름 설정하기"를 누르면 처음 방문자와 완전히 동일한
// 이름 → 생년월일 입력 흐름으로 들어감 (wp1부터 그대로 재사용, 뒤로가기도 자연스럽게 연결됨)
function wpEditProfile(){
  wpHistory.push('Return');
  wpShowOnly(1);
  wpCurrentPage = 1;
  wpUpdateDots(1);
}

function wpReturnFinish(goal){
  document.getElementById('welcomeOverlay').classList.remove('show');
  wpFinish(goal);
}
// "시설을 운영하고 계신가요?" — 온보딩 닫고 바로 「시설 운영자」 자료제공 화면으로 이동
function wpGoToOperatorPage(){
  document.getElementById('welcomeOverlay').classList.remove('show');
  goToStep(1);
  openFacilityView();
}
// "그냥 둘러볼게요" — 목표 선택 없이 기본 화면으로
function wpReturnDismiss(){
  document.getElementById('welcomeOverlay').classList.remove('show');
  goToStep(1);
}

function wpUpdateDots(pageId){
  const idx = WP_DOT_MAIN_PAGES.indexOf(String(pageId));
  if(idx === -1) return;
  document.querySelectorAll(`.wp-dots`).forEach(dotsEl=>{
    [...dotsEl.children].forEach((dot,i)=>{
      dot.classList.toggle('active', i === idx);
      dot.classList.toggle('done', i < idx);
    });
  });
}

function wpGoTo(n, skipHistory){
  if(!skipHistory) wpHistory.push(wpCurrentPage);
  wpShowOnly(n);
  wpCurrentPage = n;
  wpUpdateDots(n);
}

function wpBack(){
  if(wpHistory.length === 0) return;
  const prev = wpHistory.pop();
  wpGoTo(prev, true);
}

// "나중에 할게요" — 지금까지 입력한 것만 저장하고 바로 앱으로 진입
// "나중에 할게요"는 온보딩을 마친 게 아니므로 완료 표시를 남기지 않음
// → 다음에 다시 들어와도 처음 방문자와 완전히 똑같이 온보딩부터 다시 보여줌
function wpSkip(){
  document.getElementById('welcomeOverlay').classList.remove('show');
  goToStep(1);
  maybeShowHomeTips();
}

function wpSubmitName(){
  const val = document.getElementById('wpName').value.trim();
  if(!val){
    document.getElementById('wpName').style.borderColor = 'var(--coral)';
    document.getElementById('wpName').placeholder = '이름을 입력해주세요';
    return;
  }
  localStorage.setItem('fairplay_name', val);
  document.getElementById('wpGreeting').textContent = t('wp_greeting_named', `반갑습니다, ${val}님!`).replace('{name}', val);
  wpGoTo(2);
}

function wpSubmitBirth(){
  const val = document.getElementById('wpBirth').value;
  if(!val){
    document.getElementById('wpBirth').style.borderColor = 'var(--coral)';
    return;
  }
  const age = wpCalcAge(val);
  localStorage.setItem('fairplay_birth', val);

  if(age > 18){
    // 성인 나이 — 아이가 이용하는지 물어보는 갈림길로
    wpGoTo('2b');
    return;
  }
  localStorage.setItem('fairplay_age', age);
  // 본인이 직접 이용 대상인 경우 — 표시용 이름은 본인 이름으로 확정.
  // (다른 세션에서 "아이가 이용해요" 흐름을 탄 적이 있다면 남아있을 수 있는
  //  이전 아이 이름 데이터가 이후 화면에 잘못 노출되지 않도록 함께 정리합니다.)
  localStorage.setItem('fairplay_display_name', localStorage.getItem('fairplay_name') || '');
  localStorage.removeItem('fairplay_child_name');
  wpShowAgeNote(age);
  wpGoTo(4);
}

function wpCalcAge(dateStr){
  const birthDate = new Date(dateStr);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if(m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

function wpSubmitChildName(){
  const val = document.getElementById('wpChildName').value.trim();
  if(!val){
    document.getElementById('wpChildName').style.borderColor = 'var(--coral)';
    document.getElementById('wpChildName').placeholder = '아이 이름을 입력해주세요';
    return;
  }
  localStorage.setItem('fairplay_child_name', val);
  document.getElementById('wpChildBirthQ').innerHTML = t('wp_child_birth_q', `${escapeHtml(val)} 어린이의<br>생년월일을 알려주세요`).replace('{name}', escapeHtml(val));
  wpGoTo('2d');
}

function wpSubmitChildBirth(){
  const val = document.getElementById('wpChildBirth').value;
  if(!val){
    document.getElementById('wpChildBirth').style.borderColor = 'var(--coral)';
    return;
  }
  const age = wpCalcAge(val);
  const childName = localStorage.getItem('fairplay_child_name') || '아이';

  const emojiEl = document.getElementById('wpChildResultEmoji');
  const textEl = document.getElementById('wpChildResultText');
  const btnEl = document.getElementById('wpChildResultBtn');

  if(age >= 5 && age <= 18){
    localStorage.setItem('fairplay_age', age);
    localStorage.setItem('fairplay_display_name', childName); // 이후 화면(가정유형 결과, 서류 체크리스트 등)에 아이 이름이 뜨도록
    wpShowAgeNote(age);
    emojiEl.textContent = '🎉';
    textEl.innerHTML = t('wp_child_result_ok', `${escapeHtml(childName)} 어린이는<br>이용 가능해요!`).replace('{name}', escapeHtml(childName));
    btnEl.textContent = t('wp_child_result_btn_ok', '이용할 시설 알아볼까요?');
    btnEl.onclick = () => wpGoTo(4);
  } else {
    emojiEl.textContent = '😅';
    textEl.innerHTML = age < 5
      ? t('wp_child_result_too_young', `${escapeHtml(childName)} 어린이는<br>아직 조금 더 커야 해요`).replace('{name}', escapeHtml(childName))
      : t('wp_child_result_too_old', `${escapeHtml(childName)} 어린이는<br>이미 나이가 지났어요`).replace('{name}', escapeHtml(childName));
    btnEl.textContent = t('wp_child_result_btn_facility', '그래도 시설은 찾아볼게요');
    btnEl.onclick = () => wpFinish('facility');
  }
  wpGoTo('2e');
}

// 경계값(5세·18세) 케이스 안내 문구
function wpShowAgeNote(age){
  const el = document.getElementById('wpAgeNote');
  if(!el) return;
  if(age === 18) el.textContent = t('wp_age_note_18', '⏰ 올해가 지나면 대상에서 제외돼요. 지금 놓치지 마세요!');
  else if(age === 5) el.textContent = t('wp_age_note_5', '🎉 이제 막 이용 가능한 나이가 됐어요!');
  else el.textContent = '';
}

function wpSubmitHousehold(val){
  localStorage.setItem('fairplay_household', val);
  // 실제 이용 대상 이름: "아이가 이용해요" 흐름이면 아이 이름, 본인 이용이면 본인 이름.
  // (예전 방식으로 fairplay_name만 쓰면 아이 흐름을 타도 계속 부모님 본인 이름이 떠서 수정함)
  const name = localStorage.getItem('fairplay_display_name') || localStorage.getItem('fairplay_name') || '';
  const age = Number(localStorage.getItem('fairplay_age'));
  wpRenderEligibility(age, val, name);
  document.getElementById('wpGoalTitle').innerHTML = t('wp_goal_title', `${escapeHtml(name)}님,<br>무엇을 먼저 해볼까요?`).replace('{name}', escapeHtml(name));
  // 서류 안내가 있는 경우(대상+범주 확실) "신청 서류 준비하기" 선택지도 보여줌
  const docBtn = document.getElementById('wpDocGoalBtn');
  if(docBtn) docBtn.style.display = (val !== 'unsure') ? 'flex' : 'none';
  wpGoTo(3);
}

// 온보딩 안에서 바로 보여주는 간단 자격 결과 (자세한 서류 체크리스트는 1단계에서 계속)
function wpRenderEligibility(age, val, name){
  const el = document.getElementById('wpEligibilityResult');
  if(!el) return;
  if(val === 'unsure'){
    el.innerHTML = `<div class="wp-result">${t('wp_elig_unsure', '헷갈리실 땐 주민센터 복지 담당자(☎ KSPO 02-410-1298~9)한테 문의해보세요')}</div>`;
    return;
  }
  if(val === 'near'){
    el.innerHTML = `<div class="wp-result alert">${t('wp_elig_near', '<b>차상위계층도 받을 수 있어요!</b> 근데 100명 중 2~3명만 신청하고 있어요 — 꼭 신청해보세요')}</div>`;
  } else {
    el.innerHTML = `<div class="wp-result ok">${t('wp_elig_ok', `<b>${escapeHtml(name)}님은 지원 대상이에요! 🎉</b> 1단계에서 필요한 서류도 바로 확인할 수 있어요`).replace('{name}', escapeHtml(name))}</div>`;
  }
}

function wpFinish(goal){
  localStorage.setItem('fairplay_onboarded', '1');
  localStorage.setItem('fairplay_goal', goal);
  document.getElementById('welcomeOverlay').classList.remove('show');
  applyStoredProfile();

  if(goal === 'diagnose'){
    goToStep(1);
  } else {
    goToStep(2);
  }
  maybeShowHomeTips();
}

// 저장된 이름/나이/가정형태를 자가진단 화면에 자동 반영
function applyStoredProfile(){
  const age = localStorage.getItem('fairplay_age');
  const ageSel = document.getElementById('ageSelect');
  if(age && ageSel){
    ageSel.value = age;
    const valueEl = document.getElementById('ageSliderValue');
    if(valueEl){ valueEl.textContent = `${age}세`; valueEl.classList.add('set'); }
    const pct = ((age - ageSel.min) / (ageSel.max - ageSel.min)) * 100;
    ageSel.style.setProperty('--pct', pct + '%');
  }
  const household = localStorage.getItem('fairplay_household');
  if(household){
    const radio = document.querySelector(`input[name="household"][value="${household}"]`);
    if(radio && !document.querySelector('input[name="household"]:checked')){
      radio.checked = true;
    }
  }
  s1Init(); // 1단계 화면 초기 상태 결정 (정보 있으면 인트로→결과, 없으면 질문부터)
}

/* ==================== 마감임박 배너 ==================== */
if(localStorage.getItem('fairplay_hide_banner')){
  document.getElementById('deadlineBanner').style.display = 'none';
}
document.getElementById('closeBanner').addEventListener('click', ()=>{
  document.getElementById('deadlineBanner').style.display = 'none';
  localStorage.setItem('fairplay_hide_banner', '1');
});

/* ==================== 인앱 브라우저(카카오톡·인스타그램 등) 안내 배너 ==================== */
// 카카오톡, 인스타그램, 페이스북 등의 인앱 브라우저는 지도 API 스크립트를 자주 차단해서
// 지도가 안 보이는 경우가 많아, "기본 브라우저로 열기" 안내를 보여줍니다.
(function checkInAppBrowser(){
  const ua = navigator.userAgent || '';
  const isKakao = /KAKAOTALK/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const isFacebook = /FBAN|FBAV/i.test(ua);
  const isNaverApp = /NAVER\(/i.test(ua);

  if(!isKakao && !isInstagram && !isFacebook && !isNaverApp) return;

  const banner = document.getElementById('inappBanner');
  const btn = document.getElementById('inappOpenBtn');
  const textEl = document.getElementById('inappBannerText');
  banner.style.display = 'flex';

  if(isKakao){
    // 카카오톡은 외부 브라우저로 강제로 여는 전용 스킴을 지원함
    textEl.textContent = '⚠️ 카카오톡 안에서는 지도가 안 보일 수 있어요';
    btn.style.display = 'inline-block';
    btn.textContent = '기본 브라우저로 열기';
    btn.addEventListener('click', ()=>{
      location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href);
    });
  } else {
    // 인스타그램·페이스북·네이버 앱은 프로그래밍적으로 여는 공식 방법이 없어 수동 안내
    const appName = isInstagram ? '인스타그램' : isFacebook ? '페이스북' : '네이버 앱';
    textEl.textContent = `⚠️ ${appName} 안에서는 지도가 안 보일 수 있어요 — 오른쪽 위 메뉴(⋮ 또는 •••)에서 "다른 브라우저로 열기"를 선택해주세요`;
  }
})();

function computeThresholds(){
  const sVals = Object.values(voucherData).map(v=>parseFloat(v.s_pct)).filter(v=>!isNaN(v)).sort((a,b)=>a-b);
  const nVals = Object.values(voucherData).map(v=>parseFloat(v.n_pct)).filter(v=>!isNaN(v)).sort((a,b)=>a-b);
  sLowThreshold = sVals[Math.floor(sVals.length*0.25)];
  nLowThreshold = nVals[Math.floor(nVals.length*0.25)];
}

function classifyRegion(row){
  const sLow = parseFloat(row.s_pct) <= sLowThreshold;
  const nLow = parseFloat(row.n_pct) <= nLowThreshold;
  if(sLow && nLow) return {label:'😥 두 가정 모두 많이 아쉬워요', cls:'type-both'};
  if(nLow) return {label:'🏙️ 차상위·한부모 가정이 유독 아쉬워요', cls:'type-city'};
  if(sLow) return {label:'🌾 기초생활수급 가정이 유독 아쉬워요', cls:'type-rural'};
  return {label:'✅ 두 가정 모두 잘 받고 있어요', cls:'type-good'};
}

function initMap(){
  map = new naver.maps.Map('map', { center: new naver.maps.LatLng(36.2, 127.9), zoom: 7, minZoom: 6 });
}

function colorFor(pct, group){
  const max = group === 's' ? 45 : 10;
  const t = Math.max(0, Math.min(1, (pct||0) / max));
  // S그룹(기초생활수급)=파란색 계열, N그룹(차상위·한부모)=코랄 계열로 구분
  const from = group === 's' ? [49,130,246] : [240,96,63]; // --blue / --coral
  const to   = [255,255,255];
  const rgb = from.map((c,i)=>Math.round(c + (to[i]-c)*t));
  return `rgb(${rgb.join(',')})`;
}

// 그룹 미선택 시: 색칠 없이 얇은 경계선만 (일반 지도 그대로 보여주기 위함)
// 그룹 선택 시: 해당 그룹 수급률 기준 색칠
function polygonStyle(pct, group){
  if(group === null){
    return { fillColor:'#000000', fillOpacity:0, strokeColor:'#8B95A1', strokeWeight:1, strokeOpacity:0.5 };
  }
  return { fillColor: colorFor(pct, group), fillOpacity:0.75, strokeColor:'#fff', strokeWeight:1.5, strokeOpacity:0.8 };
}

let drawnPolygons = [];
function drawPolygons(features){
  features.forEach(f=>{
    const code = f.properties.sggcd;
    const row = voucherData[code];
    if(!row) return;

    const geomType = f.geometry.type;
    const polys = geomType === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;

    polys.forEach(polyCoords=>{
      const outerRing = polyCoords[0];
      const path = outerRing.map(c=>new naver.maps.LatLng(c[1], c[0]));
      const pct = parseFloat(currentGroup==='n' ? row.n_pct : row.s_pct);
      const style = polygonStyle(pct, currentGroup);

      const polygon = new naver.maps.Polygon({ map: map, paths: [path], ...style });
      drawnPolygons.push(polygon);
      polygons.push({ring: outerRing, code, row});
    });
  });

  naver.maps.Event.addListener(map, 'click', function(e){
    const lat = e.coord.y, lng = e.coord.x;
    const hit = polygons.find(p => pointInRing(lng, lat, p.ring));
    if(hit) onRegionClick(hit.code, hit.row);
  });
}

function pointInRing(x, y, ring){
  let inside = false;
  for(let i=0, j=ring.length-1; i<ring.length; j=i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi>y) !== (yj>y)) && (x < (xj-xi) * (y-yi) / (yj-yi) + xi);
    if(intersect) inside = !inside;
  }
  return inside;
}

function redrawColors(){
  drawnPolygons.forEach(p=>p.setMap(null));
  drawnPolygons = [];
  polygons.forEach(p=>{
    const pct = parseFloat(currentGroup==='n' ? p.row.n_pct : p.row.s_pct);
    const path = p.ring.map(c=>new naver.maps.LatLng(c[1], c[0]));
    const style = polygonStyle(pct, currentGroup);
    const polygon = new naver.maps.Polygon({ map: map, paths: [path], ...style });
    drawnPolygons.push(polygon);
  });
}

function updateLegendBar(){
  const bar = document.getElementById('legendBar');
  const hint = document.getElementById('legendHint');
  const wrap = document.getElementById('legendWrap');
  if(!bar) return;
  if(currentGroup === null){
    if(hint) hint.style.display = 'block';
    if(wrap) wrap.style.display = 'none';
    return;
  }
  if(hint) hint.style.display = 'none';
  if(wrap) wrap.style.display = 'flex';
  bar.style.background = currentGroup === 's'
    ? 'linear-gradient(to right, var(--blue), #fff)'
    : 'linear-gradient(to right, var(--coral), #fff)';
}

// 그룹 버튼을 다시 누르면 선택 해제(색상 없이 일반 지도로 복귀)
// 지도를 없애면서 S/N 그룹 색상 토글 버튼도 함께 제거했어요.
// currentGroup은 이제 항상 null로 고정되고, 순위는 두 그룹을 각각 따로 보여줍니다.

// 숫자 카운트업 애니메이션 (지역 통계 카드가 새로 그려질 때마다 실행)
function animateRegionStats(){
  const duration = 700;
  document.querySelectorAll('#regionStatsCard .s2c-num[data-target]').forEach(el=>{
    const target = parseFloat(el.dataset.target) || 0;
    const pctSpan = el.querySelector('.s2c-pct');
    const start = performance.now();
    const tick = (now)=>{
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      el.firstChild.textContent = (target * eased).toFixed(2).replace(/\.?0+$/, '');
      if(t < 1) requestAnimationFrame(tick);
      else el.firstChild.textContent = target;
    };
    requestAnimationFrame(tick);
  });
}

// 2→3단계 사이 "추천 시설" 3곳 뽑기 — 실제로 갖고 있는 데이터로만 판단합니다.
// (이용횟수·리뷰 데이터는 없어서 "인기순"이 아니라, "내 돈 0원 강좌 보유" → "강좌 다양함"
//  → "전화 문의 가능(정보 충실)" 순으로 우선순위를 매겨서 서로 다른 이유로 3곳을 추천함)
function computeTopPicks(facilities){
  if(!facilities || !facilities.length) return [];
  const scored = facilities.map(f=>{
    const key = f.sgg ? `${f.name}|${f.sgg}` : f.name;
    const courses = coursesByFacility[key] || [];
    const hasFree = courses.some(c => getCostBand(c.settl_amt) === 'free');
    return { f, courseCount: courses.length, hasFree };
  });
  const picks = [];
  const used = new Set();

  const freeOnes = scored.filter(s => s.hasFree).sort((a,b) => b.courseCount - a.courseCount);
  if(freeOnes.length){ picks.push({ ...freeOnes[0], badge: '내 돈 0원 강좌 있음' }); used.add(freeOnes[0].f.name); }

  const byCourseCount = scored.filter(s => !used.has(s.f.name) && s.courseCount > 0).sort((a,b) => b.courseCount - a.courseCount);
  if(byCourseCount.length){ picks.push({ ...byCourseCount[0], badge: `강좌 ${byCourseCount[0].courseCount}개 보유` }); used.add(byCourseCount[0].f.name); }

  const withPhone = scored.filter(s => !used.has(s.f.name) && s.f.tel).sort((a,b) => b.courseCount - a.courseCount);
  if(withPhone.length){ picks.push({ ...withPhone[0], badge: '전화 문의 가능' }); used.add(withPhone[0].f.name); }

  if(picks.length < 3){
    scored.filter(s => !used.has(s.f.name)).slice(0, 3 - picks.length).forEach(s=>{
      picks.push({ ...s, badge: '우리 동네 시설' });
      used.add(s.f.name);
    });
  }
  return picks.slice(0, 3);
}

function renderTopPicksScreen(facilities){
  const listEl = document.getElementById('topPicksList');
  const nextBtn = document.getElementById('topPicksNextBtn');
  if(!listEl || !nextBtn) return;
  const picks = computeTopPicks(facilities);
  if(!picks.length){
    listEl.innerHTML = `<p class="placeholder-msg">아직 강좌 정보가 없어요.<br>전체 시설 목록에서 확인해보세요.</p>`;
  } else {
    listEl.innerHTML = picks.map(p => `
      <div class="pick-item" onclick="closeTopPicks(); goToStep(3); setTimeout(()=>showFacilityOnMap('${escapeAttr(p.f.name)}','${escapeAttr(p.f.addr)}','${escapeAttr(p.f.sgg||'')}','${escapeAttr(p.f.naver_lat||'')}','${escapeAttr(p.f.naver_lng||'')}'), 200);">
        <span class="pick-icon">${getSportEmoji(p.f.type)}</span>
        <div class="pick-body">
          <div class="pick-name">${p.f.name}</div>
          <span class="pick-badge">${p.badge}</span>
        </div>
        <span class="pick-arrow">→</span>
      </div>`).join('');
  }
  nextBtn.textContent = `전체 ${facilities.length}개 시설 다 보기 →`;
}

function showTopPicks(){
  const el = document.getElementById('s2-picks');
  if(el) el.style.display = 'flex';
}
function closeTopPicks(){
  const el = document.getElementById('s2-picks');
  if(el) el.style.display = 'none';
}
function goToStepFromPicks(){
  closeTopPicks();
  goToStep(3);
}

async function onRegionClick(code, row){
  restorePolygonColors(); // 시설 핀 보느라 지워졌던 지역 색을 다시 보여줍니다
  if(facilityMarker){ facilityMarker.setMap(null); facilityMarker = null; }
  document.getElementById('step2Panel')?.classList.add('has-region'); // 지역 골랐으니 전체화면 검색 → 작은 검색바로
  document.getElementById('step2SearchWrap')?.classList.add('picked');
  const sPct = parseFloat(row.s_pct) || 0;
  const nPct = parseFloat(row.n_pct) || 0;
  const type = classifyRegion(row);
  const totalRegions = Object.keys(voucherData).length;
  const sRank = sRankByCode[code], nRank = nRankByCode[code];

  // 지역별 시설 데이터를 그때그때 불러옵니다 (지역당 평균 수십KB) — 불러오는 동안 잠깐 로딩 표시
  const facCard = document.getElementById('regionFacilityCard');
  if(facCard) facCard.innerHTML = `<p class="placeholder-msg" style="margin-top:20px;">시설 정보를 불러오는 중...</p>`;
  const facilities = await getRegionFacilities(code);

  currentPanelCode = code;
  currentPanelFacilities = facilities;
  facilityListLimit = 5; // 새 지역 선택 시 더보기 목록 초기화
  currentPanelOwnOnly = facilities;
  currentPanelIncludingNeighbors = null; // "옆 동네 포함 보기"를 실제로 눌렀을 때만 그 지역들을 불러와 계산합니다
  currentPanelNeighborCodes = []; // toggleNeighborFacilities에서 사용

  // ---- 옆동네 시설 표시 (기능1) ----
  // 시설 개수와 상관없이 항상 인접 시군구(진짜 이웃 동네) 시설을 함께 볼 수 있는 옵션을 제공합니다.
  // 미리보기 개수는 작은 facility_counts.json으로만 계산해서, 실제로 누르기 전까진 이웃 지역 데이터를 받지 않습니다.
  let neighborSectionHtml = '';
  const neighborEntry = neighborMap[code];
  if(neighborEntry && neighborEntry.neighbors.length){
    const neighborList = neighborEntry.neighbors
      .map(n => ({ code:n.code, name:n.name, count: facilityCounts[n.code] ?? 0 }))
      .filter(n => n.count > 0)
      .sort((a,b)=> b.count - a.count);

    const neighborTotal = neighborList.reduce((sum,n)=>sum+n.count, 0);

    if(neighborList.length){
      currentPanelNeighborCodes = neighborList.map(n=>n.code);
      const rowsHtml = neighborList.map(n=>
        `<div class="neighbor-row"><span>${n.name}</span><span>${n.count}개</span></div>`
      ).join('');
      const isLow = facilities.length <= LOW_FACILITY_THRESHOLD;
      const titleHtml = isLow
        ? `📍 우리 동네엔 ${facilities.length}개 뿐이지만...`
        : `📍 이웃 동네도 함께 볼까요?`;
      const subHtml = isLow ? `옆 동네까지 합치면 훨씬 많아요` : `${neighborList.map(n=>n.name).join(', ')} 시설도 같이 보여드려요`;
      neighborSectionHtml = `
        <div class="neighbor-box">
          <div class="neighbor-title">${titleHtml}</div>
          <div class="neighbor-sub">${subHtml}</div>
          ${rowsHtml}
          <button class="neighbor-toggle-btn" id="neighborToggleBtn" onclick="toggleNeighborFacilities()">
            옆 동네 포함 총 ${facilities.length + neighborTotal}개 시설 보기 →
          </button>
        </div>`;
    }
  }

  // 이 지역 시설들의 종목 목록 (필터용, 콤마로 이어진 값들을 분리)
  const allTypes = new Set();
  facilities.forEach(f => (f.type||'').split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>allTypes.add(t)));
  const typeOptions = ['<option value="__all__">전체 종목</option>']
    .concat([...allTypes].sort().map(t=>`<option value="${t}">${t}</option>`)).join('');

  // 전국 상위 5개 인기 종목 중, 이 지역에 실제로 있는 것만 칩으로 보여줍니다 (한 번에 눌러 필터링)
  const POPULAR_TYPES = ['태권도','헬스','필라테스','복싱','기타종목'];
  const chipTypes = POPULAR_TYPES.filter(t=>allTypes.has(t));
  const chipsHtml = chipTypes.length
    ? `<div class="type-chips" id="typeChips">
        ${chipTypes.map(t=>`<button class="chip" data-type="${t}" onclick="selectTypeChip('${escapeAttr(t)}')">${getSportEmoji(t)} ${t}</button>`).join('')}
       </div>`
    : '';

  const timeOptions = `
    <option value="__all__">전체 시간대</option>
    <option value="오전">오전 (~12시)</option>
    <option value="오후">오후 (12~17시)</option>
    <option value="저녁">저녁 (17시~)</option>`;

  const costOptions = `
    <option value="__all__">내 돈 전체</option>
    <option value="free">내 돈 0원</option>
    <option value="under3">내 돈 3만원까지</option>
    <option value="under5">내 돈 5만원까지</option>`;

  const filterHtml = facilities.length
    ? `${chipsHtml}
       <button class="filter-open-btn" id="filterOpenBtn" onclick="openFilterSheet()">🔍 필터 <span id="filterActiveBadge" style="display:none;"></span></button>`
    : '';

  const facilitiesHtml = facilities.length
    ? renderFacilityList(facilities, '__all__', '__all__', '__all__')
    : (neighborSectionHtml
        ? `<p class="placeholder-msg">이 동네엔 등록된 시설이 없어요. 위에서 옆 동네 시설을 확인해보세요.</p>`
        : `<p class="placeholder-msg">이 동네엔 등록된 시설 정보가 아직 없어요. 지자체에 문의해보시는 걸 추천드려요.</p>`);

  const favActive = isFavorite(code);
  const sRankPct = Math.max(2, Math.min(98, (sRank / totalRegions) * 100));
  const nRankPct = Math.max(2, Math.min(98, (nRank / totalRegions) * 100));

  // ---- 2단계: 우리동네 현황 카드 (숫자 먼저 미니멀 스타일, 각 숫자에 라벨·순위 명시) ----
  document.getElementById('regionStatsCard').innerHTML = `
    <div style="display:flex; justify-content:flex-end; margin-bottom:4px;">
      <button class="fav-star ${favActive?'active':''}" onclick="toggleFavorite('${code}')" title="즐겨찾기">⭐</button>
    </div>
    <div class="s2c-tag"><span class="dot"></span>${row.sido} ${row.region} · 스포츠강좌이용권 현황</div>
    <div style="text-align:center; margin-top:16px;"><span class="type-badge" style="background:var(--coral-soft); color:var(--coral-deep);">${type.label}</span></div>
    <div class="s2c-numbers">
      <div class="s2c-num-col">
        <div class="s2c-num-label">기초생활수급 가정</div>
        <span class="s2c-num" data-target="${sPct}">0<span class="s2c-pct">%</span></span>
        <div class="s2c-rank">전국 ${totalRegions}곳 중 <b>${sRank}위</b></div>
      </div>
      <div class="s2c-num-col">
        <div class="s2c-num-label">차상위 · 한부모 가정</div>
        <span class="s2c-num coral" data-target="${nPct}">0<span class="s2c-pct">%</span></span>
        <div class="s2c-rank">전국 ${totalRegions}곳 중 <b>${nRank}위</b></div>
      </div>
    </div>
    <div class="s2c-caption">대상자 중 실제로 지원받은 비율이에요</div>
    <div class="s2c-cheer">얼른 이용해보세요! 🎉</div>
  `;
  animateRegionStats();
  renderTopPicksScreen(facilities);
  const toStep3Btn = document.getElementById('toStep3Btn');
  if(toStep3Btn) toStep3Btn.style.display = 'block';

  // ---- 3단계: 시설 찾기 카드 ----
  document.getElementById('regionFacilityCard').innerHTML = `
    <h2>${row.sido} ${row.region} · 가까운 시설</h2>
    ${neighborSectionHtml}
    ${filterHtml}
    <div id="facilityListBox">${facilitiesHtml}</div>
    <a class="official-link" href="https://svoucher.kspo.or.kr" target="_blank" rel="noopener">실시간 강좌 정보 보러가기 →</a>
    <div class="action-row">
      <button class="action-btn" onclick="shareRegion()">🔗 공유하기</button>
    </div>
  `;

  // 처음 이용자에게만: "옆동네 확장" 버튼이 처음 등장했을 때 살짝 안내 (한 번 보면 다시 안 뜸)
  if(neighborSectionHtml){
    const neighborBtn = document.getElementById('neighborToggleBtn');
    if(neighborBtn){
      setTimeout(()=> showCoachmark(
        neighborBtn,
        '여기 누르면 이웃 동네 시설도 같이 보여드려요',
        'neighbor_toggle'
      ), 400); // 카드가 화면에 자리잡을 시간을 살짝 준 뒤 표시
    }
  }

  // 필터 바텀시트 안의 종목 목록은 지역마다 달라서 매번 새로 채워줌
  const sheetTypeFilter = document.getElementById('typeFilter');
  if(sheetTypeFilter) sheetTypeFilter.innerHTML = typeOptions;
  resetFilterSheet();

  // 지도를 눌러 지역을 고르면(검색·즐겨찾기 포함), 자연스럽게 2단계(우리동네 현황)로 이동
  if(currentStep === 1) goToStep(2);
  // 이미 3단계(시설찾기)에 있는데 다른 동네를 골랐다면, 핀도 새 동네 기준으로 갱신
  if(currentStep === 3) placeFacilityPinsForCurrentRegion();
}

// 2단계: 즐겨찾기/TOP10을 기본으로 접어두고, 필요할 때만 펼침 (여백 있는 화면 유지)
function toggleMoreInfo(){
  const section = document.getElementById('moreInfoSection');
  const arrow = document.getElementById('moreInfoArrow');
  const btn = document.getElementById('moreInfoToggle');
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  arrow.textContent = isOpen ? '▾' : '▴';
  btn.firstChild.textContent = isOpen ? '더 많은 정보 보기 ' : '접기 ';
}

// 나이 슬라이더 초기화 — 값이 바뀔 때마다 큰 숫자로 표시하고 진단을 다시 실행
function populateAgeSelect(){
  const slider = document.getElementById('ageSelect');
  const valueEl = document.getElementById('ageSliderValue');
  if(!slider) return;
  const updateLabel = ()=>{
    if(slider.value){
      valueEl.textContent = `${slider.value}세`;
      valueEl.classList.add('set');
      const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--pct', pct + '%');
    }
  };
  slider.addEventListener('input', ()=>{ updateLabel(); runDiagnose(); });
  updateLabel();
}

function populateSportSelect(){
  const sel = document.getElementById('favoriteSport');
  if(!sel) return;
  [...allSportTypesGlobal].sort().forEach(t=>{
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t;
    sel.appendChild(opt);
  });
}

/* ==================== 🎯 맞춤 시설 추천 (나이·종목·실시간 위치 기반) ==================== */
function haversineKm(lat1,lng1,lat2,lng2){
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// 우리동네+옆동네에 원하는 종목이 없을 때, 좀 더 멀리(2단계 인접)까지 훑어서
// 그 종목이 있는 가까운 동네를 찾아 안내
async function findSportAlternatives(startCode, startRow, sport){
  const visited = new Set([startCode]);
  const found = []; // {code, name, count}
  let frontier = [startCode];

  for(let depth = 0; depth < 2 && found.length < 3; depth++){
    const nextFrontier = [];
    const candidateCodes = [];
    frontier.forEach(code=>{
      const nb = neighborMap[code];
      if(!nb) return;
      nb.neighbors.forEach(n=>{
        if(visited.has(n.code)) return;
        visited.add(n.code);
        nextFrontier.push(n.code);
        candidateCodes.push(n);
      });
    });
    // 이번 깊이에서 새로 만난 지역들의 시설 데이터를 한 번에 병렬로 불러옵니다
    const results = await Promise.all(candidateCodes.map(n => getRegionFacilities(n.code)));
    candidateCodes.forEach((n, i)=>{
      const count = results[i].filter(f => (f.type||'').includes(sport)).length;
      if(count > 0) found.push({ code: n.code, name: `${n.sido} ${n.name}`, count });
    });
    frontier = nextFrontier;
  }

  found.sort((a,b)=> b.count - a.count);
  const top = found.slice(0, 3);

  if(top.length === 0){
    return `<p class="placeholder-msg">${startRow.sido} ${startRow.region} 근처에서 "${sport}" 종목을 찾지 못했어요. 종목을 바꿔서 다시 시도해보세요.</p>`;
  }

  return `
    <div class="placeholder-msg" style="text-align:left;">
      <b>${startRow.sido} ${startRow.region}</b>엔 "${sport}" 시설이 없어요.<br>가장 가까운 곳은:
    </div>
    <div class="sport-alt-list">
      ${top.map(t=>`
        <button class="sport-alt-item" onclick="goToRegion('${t.code}'); goToStep(3);">
          <span>${t.name}</span><span class="sport-alt-count">${t.count}곳 →</span>
        </button>
      `).join('')}
    </div>
  `;
}

function runRecommend(){
  const sport = document.getElementById('favoriteSport').value;
  const resultEl = document.getElementById('recommendResult');

  if(!navigator.geolocation){
    resultEl.innerHTML = `<p class="placeholder-msg">이 브라우저는 위치 기능을 지원하지 않아요</p>`;
    return;
  }
  resultEl.innerHTML = `<p class="placeholder-msg">📍 위치 확인 중...</p>`;

  navigator.geolocation.getCurrentPosition(async pos=>{
    const userLat = pos.coords.latitude, userLng = pos.coords.longitude;

    // 1. 가장 가까운 시군구 찾기 (지역 중심좌표 기준)
    let nearestCode = null, nearestDist = Infinity;
    Object.entries(voucherData).forEach(([code, row])=>{
      if(!row._centroid) return;
      const d = haversineKm(userLat, userLng, row._centroid.lat, row._centroid.lng);
      if(d < nearestDist){ nearestDist = d; nearestCode = code; }
    });
    if(!nearestCode){
      resultEl.innerHTML = `<p class="placeholder-msg">지역을 찾지 못했어요. 다시 시도해주세요.</p>`;
      return;
    }
    const nearestRow = voucherData[nearestCode];

    // 2. 후보 시설: 그 지역 + 인접 지역 전부 (지역별 파일을 그때그때 병렬로 불러옵니다)
    const nb = neighborMap[nearestCode];
    const neighborCodes = nb ? nb.neighbors.map(n=>n.code) : [];
    const [ownFacilities, ...neighborFacilitiesArrays] = await Promise.all([
      getRegionFacilities(nearestCode),
      ...neighborCodes.map(nc => getRegionFacilities(nc))
    ]);
    let candidates = ownFacilities.concat(...neighborFacilitiesArrays);
    if(sport){ candidates = candidates.filter(f => (f.type||'').includes(sport)); }

    if(candidates.length === 0){
      resultEl.innerHTML = await findSportAlternatives(nearestCode, nearestRow, sport);
      return;
    }

    resultEl.innerHTML = `<p class="placeholder-msg">🤖 ${candidates.length}곳 중 가까운 순으로 계산 중...</p>`;

    // 3. 계산량 제한을 위해 최대 40곳만 좌표 변환하는데, 파일 순서 그대로 자르면
    //    진짜 가까운 지역의 시설이 41번째 밖으로 밀려 통째로 누락될 수 있음.
    //    그래서 먼저 "그 시설이 속한 지역의 중심점까지 거리"로 후보를 정렬한 뒤 자름.
    const regionDist = {};
    Object.entries(voucherData).forEach(([rcode, rrow])=>{
      if(!rrow._centroid) return;
      regionDist[rrow.sido + '|' + rrow.region] = haversineKm(userLat, userLng, rrow._centroid.lat, rrow._centroid.lng);
    });
    candidates.sort((a,b) =>
      (regionDist[a.sido+'|'+a.sgg] ?? Infinity) - (regionDist[b.sido+'|'+b.sgg] ?? Infinity)
    );

    const pool = candidates.slice(0, 40);
    let done = 0;
    let finished = false;
    const withDist = [];
    const checkFinish = ()=>{
      if(done === pool.length && !finished){ finished = true; finishRecommend(withDist, resultEl, sport, nearestRow); }
    };
    // 8초 안에 응답 없는 지오코딩이 있어도 받은 것만으로 결과를 보여줌 (무한 대기 방지)
    setTimeout(()=>{
      if(!finished){ finished = true; finishRecommend(withDist, resultEl, sport, nearestRow); }
    }, 8000);

    if(typeof naver === 'undefined' || !naver.maps.Service){
      resultEl.innerHTML = `<p class="placeholder-msg">지도 기능을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>`;
      return;
    }

    pool.forEach(f=>{
      if(geocodeCache[f.addr]){
        const c = geocodeCache[f.addr];
        withDist.push({ ...f, dist: haversineKm(userLat, userLng, c.lat, c.lng) });
        done++; checkFinish();
        return;
      }
      naver.maps.Service.geocode({ query: f.addr }, function(status, response){
        done++;
        if(status === naver.maps.Service.Status.OK && response.v2.addresses.length){
          const item = response.v2.addresses[0];
          const c = { lat: parseFloat(item.y), lng: parseFloat(item.x) };
          geocodeCache[f.addr] = c;
          withDist.push({ ...f, dist: haversineKm(userLat, userLng, c.lat, c.lng) });
        }
        checkFinish();
      });
    });
  }, ()=>{
    resultEl.innerHTML = `<p class="placeholder-msg">위치 정보를 가져올 수 없어요. 브라우저 위치 권한을 확인해주세요.</p>`;
  });
}

function finishRecommend(list, resultEl, sport, nearestRow){
  list.sort((a,b)=>a.dist-b.dist);
  const top = list.slice(0,5);
  if(top.length === 0){
    resultEl.innerHTML = `<p class="placeholder-msg">위치를 정확히 계산하지 못했어요. 다시 시도해주세요.</p>`;
    return;
  }
  resultEl.innerHTML = `
    <div class="recommend-title">🤖 ${sport ? sport+' · ' : ''}가까운 순 추천 ${top.length}곳 (${nearestRow.sido} ${nearestRow.region} 기준)</div>
    ${top.map(f=>{ const phone = formatPhone(f.tel); return `
      <div class="facility-item" onclick="showFacilityOnMap('${escapeAttr(f.name)}','${escapeAttr(f.addr)}','${escapeAttr(f.sgg||'')}','${escapeAttr(f.naver_lat||'')}','${escapeAttr(f.naver_lng||'')}')">
        <div class="fname" onclick="event.stopPropagation(); openNaverSearch('${escapeAttr(f.name)}','${escapeAttr(f.addr)}','${escapeAttr(f.sgg||'')}','${escapeAttr(phone||'')}','${escapeAttr(f.naver_title||'')}')">${f.name}</div>
        <div class="faddr">📍 ${f.addr} · <b>${f.dist.toFixed(1)}km</b></div>
        <div class="fhint-row">
          <span class="fhint-tap">👆 눌러서 정확한 위치 확인</span>
          <span class="fhint" onclick="event.stopPropagation(); openNaverMap('${escapeAttr(f.name)}','${escapeAttr(f.addr)}','${escapeAttr(f.sgg||'')}','${escapeAttr(phone||'')}','${escapeAttr(f.naver_title||'')}','${escapeAttr(f.naver_lat||'')}','${escapeAttr(f.naver_lng||'')}')">네이버 지도에서 길찾기 →</span>
        </div>
      </div>
    `; }).join('')}
  `;
}

/* ---- 검색으로 동네 찾기 ---- */
function goToRegion(code){
  const row = voucherData[code];
  if(!row || !row._centroid) return;
  map.setCenter(new naver.maps.LatLng(row._centroid.lat, row._centroid.lng));
  map.setZoom(11);
  onRegionClick(code, row);
}

const searchInput = document.getElementById('searchInput');
const searchSuggest = document.getElementById('searchSuggest');

searchInput.addEventListener('input', ()=>{
  const q = searchInput.value.trim();
  if(!q){ searchSuggest.style.display='none'; return; }
  const matches = regionSearchList.filter(r => r.label.includes(q)).slice(0,8);
  if(matches.length === 0){
    searchSuggest.innerHTML = `<div class="sugg-item" style="color:var(--ink-faint);">검색 결과가 없어요</div>`;
  } else {
    searchSuggest.innerHTML = matches.map(m=>
      `<div class="sugg-item" data-code="${m.code}">${m.label}</div>`
    ).join('');
  }
  searchSuggest.style.display = 'block';
});

searchSuggest.addEventListener('click', (e)=>{
  const item = e.target.closest('.sugg-item[data-code]');
  if(!item) return;
  goToRegion(item.dataset.code);
  searchInput.value = item.textContent;
  searchSuggest.style.display = 'none';
});

// 검색창에서 자동완성 목록이 떠 있을 때 엔터를 누르면, 클릭한 것처럼 맨 위 결과를 바로 선택
function bindEnterToFirstSuggestion(inputEl, suggestEl){
  if(!inputEl || !suggestEl) return;
  inputEl.addEventListener('keydown', (e)=>{
    if(e.key !== 'Enter') return;
    e.preventDefault();
    const first = suggestEl.querySelector('.sugg-item[data-code]');
    if(first) first.click();
  });
}
bindEnterToFirstSuggestion(searchInput, searchSuggest);

// 이름·생년월일 입력 화면에서 엔터를 누르면 "다음" 버튼을 누른 것과 똑같이 진행됨
function bindEnterToSubmit(inputId, submitFn){
  const el = document.getElementById(inputId);
  if(!el) return;
  el.addEventListener('keydown', (e)=>{
    if(e.key !== 'Enter') return;
    e.preventDefault();
    submitFn();
  });
}
bindEnterToSubmit('wpName', wpSubmitName);
bindEnterToSubmit('wpBirth', wpSubmitBirth);
bindEnterToSubmit('wpChildName', wpSubmitChildName);
bindEnterToSubmit('wpChildBirth', wpSubmitChildBirth);

document.addEventListener('click', (e)=>{
  if(!e.target.closest('.search-box')) searchSuggest.style.display = 'none';
});

/* ---- 지역 현황 보기 전용 검색 (같은 방식, 결과만 rvContent로) — DOM이 스크립트보다 뒤에 있어 지연 바인딩 ---- */
let rvSearchBound = false;
// 2단계 컴팩트 검색바 (지역 선택 후 재검색용) — 지연 바인딩 불필요, DOM이 스크립트보다 먼저 있음
const searchInputCompact = document.getElementById('searchInputCompact');
const searchSuggestCompact = document.getElementById('searchSuggestCompact');
if(searchInputCompact){
  searchInputCompact.addEventListener('input', ()=>{
    const q = searchInputCompact.value.trim();
    if(!q){ searchSuggestCompact.style.display='none'; return; }
    const matches = regionSearchList.filter(r => r.label.includes(q)).slice(0,8);
    searchSuggestCompact.innerHTML = matches.length === 0
      ? `<div class="sugg-item" style="color:var(--ink-faint);">검색 결과가 없어요</div>`
      : matches.map(m=>`<div class="sugg-item" data-code="${m.code}">${m.label}</div>`).join('');
    searchSuggestCompact.style.display = 'block';
  });
  searchSuggestCompact.addEventListener('click', (e)=>{
    const item = e.target.closest('.sugg-item[data-code]');
    if(!item) return;
    goToRegion(item.dataset.code);
    searchInputCompact.value = '';
    searchSuggestCompact.style.display = 'none';
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('#compactSearchRow')) searchSuggestCompact.style.display = 'none';
  });
  document.getElementById('locateBtnCompact')?.addEventListener('click', ()=>{
    document.getElementById('locateBtn')?.click();
  });
  bindEnterToFirstSuggestion(searchInputCompact, searchSuggestCompact);
}

function bindRegionViewSearch(){
  if(rvSearchBound) return;
  rvSearchBound = true;
  const rvSearchInput = document.getElementById('rvSearchInput');
  const rvSearchSuggest = document.getElementById('rvSearchSuggest');
  rvSearchInput.addEventListener('input', ()=>{
    const q = rvSearchInput.value.trim();
    if(!q){ rvSearchSuggest.style.display='none'; return; }
    const matches = regionSearchList.filter(r => r.label.includes(q)).slice(0,8);
    rvSearchSuggest.innerHTML = matches.length === 0
      ? `<div class="sugg-item" style="color:var(--ink-faint);">검색 결과가 없어요</div>`
      : matches.map(m=>`<div class="sugg-item" data-code="${m.code}">${m.label}</div>`).join('');
    rvSearchSuggest.style.display = 'block';
  });
  rvSearchSuggest.addEventListener('click', (e)=>{
    const item = e.target.closest('.sugg-item[data-code]');
    if(!item) return;
    renderRegionView(item.dataset.code);
    rvSearchInput.value = item.textContent;
    rvSearchSuggest.style.display = 'none';
  });
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('#rvSearchInput') && !e.target.closest('#rvSearchSuggest')) rvSearchSuggest.style.display = 'none';
  });
  bindEnterToFirstSuggestion(rvSearchInput, rvSearchSuggest);
}

/* ---- 내 동네 찾기 (위치 기반) ---- */
document.getElementById('locateBtn').addEventListener('click', ()=>{
  const btn = document.getElementById('locateBtn');
  if(!navigator.geolocation){
    alert('이 브라우저는 위치 찾기를 지원하지 않아요.');
    return;
  }
  btn.classList.add('loading');
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      btn.classList.remove('loading');
      const { latitude, longitude } = pos.coords;
      const hit = polygons.find(p => pointInRing(longitude, latitude, p.ring));
      if(hit){
        map.setCenter(new naver.maps.LatLng(latitude, longitude));
        map.setZoom(12);
        onRegionClick(hit.code, hit.row);
      } else {
        alert('현재 위치를 지도 범위 안에서 찾지 못했어요. 검색으로 동네를 찾아보세요.');
      }
    },
    ()=>{
      btn.classList.remove('loading');
      alert('위치 정보를 가져올 수 없어요. 브라우저 위치 권한을 확인해주세요.');
    }
  );
});

/* ==================== 3단계 흐름 (자가진단 → 우리동네 → 시설찾기) ==================== */
let currentStep = 1;
// 헤더 로고 클릭 — 열려있는 오버레이를 전부 닫고 처음 화면(1단계 자가진단)으로 돌아감
function goHome(){
  document.getElementById('regionViewOverlay')?.classList.remove('show');
  document.getElementById('facilityViewOverlay')?.classList.remove('show');
  document.getElementById('welcomeOverlay')?.classList.remove('show');
  document.getElementById('courseModalOverlay')?.classList.remove('show');
  document.getElementById('filterSheetOverlay')?.classList.remove('show');
  closeHeaderMoreMenu();
  goToStep(1);
}

function goToStep(n){
  currentStep = n;
  [1,2,3].forEach(i=>{
    const panel = document.getElementById(`step${i}Panel`);
    if(panel) panel.style.display = (i===n) ? 'block' : 'none';
    const tab = document.querySelector(`.step-tab[data-step="${i}"]`);
    if(tab) tab.classList.toggle('active', i===n);
  });
  document.getElementById('sidebar')?.scrollTo({top:0, behavior:'smooth'});

  if(n === 1){
    s1Init();
  } else {
    s1HideAll(); // 1단계의 전체화면 오버레이가 2·3단계 위에 계속 떠있는 걸 방지
  }

  const appEl = document.getElementById('app');
  if(n === 3){
    appEl?.classList.remove('no-map');
    // 숨겨져 있던 지도를 다시 보여줄 때는 크기를 다시 계산해줘야 정상적으로 그려짐
    setTimeout(()=>{
      if(typeof naver !== 'undefined' && map){
        naver.maps.Event.trigger(map, 'resize');
      }
      placeFacilityPinsForCurrentRegion();
    }, 50);
  } else {
    appEl?.classList.add('no-map');
    clearFacilityPins();
  }
}

// 3단계(시설찾기) 진입 시: 선택된 동네로 지도를 확대하고, 시설들 위치에 핀을 한번에 찍어줍니다
let facilityPinMarkers = [];
// 15개 핀은 각각 따로 비동기(지오코딩)로 지도에 올라와서, 사용자가 카드 하나를 눌러
// "핀 하나만 보기"로 바꾼 뒤에도 뒤늦게 도착한 나머지 핀들이 그대로 지도에 추가되는
// 문제가 있었음(경쟁 상태). 이 번호로 "지금 이 배치가 아직 유효한 배치인지"를 확인해서,
// 이미 낡은 배치의 핀은 도착해도 무시하게 함.
let facilityPinsRequestId = 0;
function clearFacilityPins(){
  facilityPinMarkers.forEach(m=>m.setMap(null));
  facilityPinMarkers = [];
}
function placeFacilityPinsForCurrentRegion(){
  placeFacilityPinsFor(currentPanelFacilities);
}

// 세션당 한 번만 물어보는 내 위치 (거리 표시용)
let userLocation = null;
let userLocationAsked = false;
function getUserLocationOnce(){
  return new Promise(resolve=>{
    if(userLocation){ resolve(userLocation); return; }
    if(userLocationAsked || !navigator.geolocation){ resolve(null); return; }
    userLocationAsked = true;
    navigator.geolocation.getCurrentPosition(
      pos=>{ userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }; resolve(userLocation); },
      ()=> resolve(null),
      { timeout: 6000 }
    );
  });
}

// 시설 목록의 거리 표시란을 채워줌 (지도 핀 계산과 동시에 진행)
function updateFacilityDistance(f, distKm){
  const fkey = escapeAttr(f.sgg ? `${f.name}|${f.sgg}` : f.name);
  document.querySelectorAll(`.facility-item[data-fkey="${fkey}"] .fdist`).forEach(el=>{
    el.textContent = ` · ${distKm < 1 ? Math.round(distKm*1000)+'m' : distKm.toFixed(1)+'km'}`;
    el.style.display = 'inline';
  });
}

async function placeFacilityPinsFor(facilities){
  if(!currentPanelCode) return;
  const row = voucherData[currentPanelCode];
  if(!row || !row._centroid) return;

  const requestId = ++facilityPinsRequestId; // 이 배치만의 번호표

  clearFacilityPins();
  if(facilityMarker){ facilityMarker.setMap(null); facilityMarker = null; }
  dimPolygonColors(); // 시설 핀이 잘 보이도록 지역 색은 옅게

  map.setCenter(new naver.maps.LatLng(row._centroid.lat, row._centroid.lng));
  map.setZoom(13);

  if(typeof naver === 'undefined' || !naver.maps.Service) return;

  const userLoc = await getUserLocationOnce(); // 실패해도 null로 그냥 진행 (거리 없이 핀만 표시)
  if(requestId !== facilityPinsRequestId) return; // 기다리는 동안 사용자가 다른 동작을 해서 이 배치가 낡아짐

  // 이미 좌표를 알고 있는 시설(naver_lat/naver_lng)은 API 호출 없이 바로 핀을 찍고,
  // 좌표가 없는 시설만 실시간 지오코딩을 하되 그 개수만 15개로 제한해서 API 호출량을 아낍니다.
  const list = facilities || [];
  let liveGeocodeCount = 0;
  const MAX_LIVE_GEOCODE = 15;
  list.forEach(f=>{
    const placePin = (coord)=>{
      if(requestId !== facilityPinsRequestId) return; // 늦게 도착한 핀 — 이미 다른 배치/단일 핀으로 넘어갔으면 무시
      let distKm = null;
      if(userLoc){
        distKm = haversineKm(userLoc.lat, userLoc.lng, coord.lat, coord.lng);
        updateFacilityDistance(f, distKm);
      }
      const distLabel = distKm !== null ? ` · ${distKm < 1 ? Math.round(distKm*1000)+'m' : distKm.toFixed(1)+'km'}` : '';
      const pos = new naver.maps.LatLng(coord.lat, coord.lng);
      const marker = new naver.maps.Marker({
        position: pos, map: map,
        icon: {
          content: `<div style="background:#fff; border:2px solid var(--coral,#1B64DA); color:var(--coral-deep,#0F4DAD); padding:4px 10px; border-radius:14px; font-size:11px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px; box-shadow:0 2px 6px rgba(0,0,0,.2); cursor:pointer;" title="${f.name}">📍 ${f.name}${distLabel}</div>`,
          anchor: new naver.maps.Point(0, 0)
        }
      });
      naver.maps.Event.addListener(marker, 'click', ()=> showFacilityOnMap(f.name, f.addr, f.sgg, f.naver_lat, f.naver_lng));
      facilityPinMarkers.push(marker);
    };
    // ① 이미 저장된 좌표가 있으면 API 호출 없이 즉시 핀 표시
    if(f.naver_lat && f.naver_lng){
      placePin({ lat: parseFloat(f.naver_lat), lng: parseFloat(f.naver_lng) });
      return;
    }
    // ② 저장된 좌표가 없는 시설만 실시간 지오코딩 (이번 검색에서 15곳까지만)
    if(geocodeCache[f.addr]){ placePin(geocodeCache[f.addr]); return; }
    if(liveGeocodeCount >= MAX_LIVE_GEOCODE) return;
    liveGeocodeCount++;
    naver.maps.Service.geocode({ query: f.addr }, function(status, response){
      if(requestId !== facilityPinsRequestId) return; // 이 배치가 이미 낡았으면 결과 자체를 버림
      if(status === naver.maps.Service.Status.OK && response.v2.addresses.length){
        const item = response.v2.addresses[0];
        const coord = { lat: parseFloat(item.y), lng: parseFloat(item.x) };
        geocodeCache[f.addr] = coord;
        placePin(coord);
      }
    });
  });
}

// 진단 질문에 답하면 추천 카드를 부드럽게 펼침 (처음부터 다 보여주지 않고 한 단계씩)
// 1단계 서브스텝 전환 (age → household → result → recommend), 온보딩과 같은 방식
const S1_STEPS = ['age','household','priorhistory','resultIntro','docsChecklist','docsNotice','docsContact','resultAction','recommend'];
let s1Initialized = false;
let s1CurrentStepName = null; // 현재 활성화된 s1 서브스텝 (2·3단계로 이동할 때 숨겼다가, 다시 돌아오면 복원하는 용도)

// 1단계 진입 시(최초 1회): 온보딩에서 이미 나이·가정형태를 알고 있으면 바로 결과로,
// 모르면(온보딩을 건너뛴 경우) 기존 질문 흐름(나이→가정형태)부터 시작.
// 이미 초기화된 뒤에는(사용자가 이미 화면을 넘기고 있는 중) 다시 처음으로 안 돌아감.
function s1Init(){
  if(s1Initialized){
    // 이미 진행 중이었으면, 2·3단계 갔다 오면서 숨겨뒀던 화면을 그대로 복원
    if(s1CurrentStepName) s1GoTo(s1CurrentStepName, true);
    return;
  }
  s1Initialized = true;
  const age = localStorage.getItem('fairplay_age');
  const household = localStorage.getItem('fairplay_household');

  if(age && household){
    renderPriorityNotice(household, localStorage.getItem('fairplay_prior_history') || 'unsure');
    runDiagnose();
    s1GoTo('resultIntro');
  } else {
    s1GoTo('age');
  }
}

// 1단계의 모든 서브스텝을 강제로 숨김 — 2·3단계로 넘어갈 때 전체화면 오버레이가 위에 계속 떠서
// 다른 화면을 가리는 문제를 막기 위함
function s1HideAll(){
  S1_STEPS.forEach(s=>{
    const el = document.getElementById(`s1-${s}`);
    if(el) el.style.display = 'none';
  });
}

function s1GoTo(step, skipHistory){
  const idx = S1_STEPS.indexOf(step);
  if(idx === -1) return;
  s1CurrentStepName = step;
  S1_STEPS.forEach(s=>{
    const el = document.getElementById(`s1-${s}`);
    if(!el) return;
    if(s === step){
      // display:block으로 무조건 덮어쓰면 .s1-vcenter-wrap의 display:flex(가운데 정렬)가 깨짐 →
      // 이 화면이 flex 레이아웃을 쓰는지 클래스로 확인해서 맞는 값으로 켜줌
      el.style.display = el.classList.contains('s1-vcenter-wrap') ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });
  document.querySelectorAll('#s1Dots .dot').forEach((dot,i)=>{
    dot.classList.toggle('active', i===idx);
    dot.classList.toggle('done', i<idx);
  });
  document.getElementById('sidebar')?.scrollTo({top:0, behavior:'smooth'});
}

function runDiagnose(){
  const age = document.getElementById('ageSelect').value;
  const household = document.querySelector('input[name="household"]:checked');
  const introEmoji = document.getElementById('resultIntroEmoji');
  const introTitle = document.getElementById('resultIntroTitle');
  const introSub = document.getElementById('resultIntroSub');
  const docsContent = document.getElementById('docsContent');
  if(!introTitle || !docsContent) return;
  if(!age || !household){ introTitle.textContent = ''; docsContent.innerHTML = ''; return; }
  const val = household.value;
  const priorityEl = document.getElementById('priorityNotice');

  if(val === 'unsure'){
    if(priorityEl) priorityEl.innerHTML = '';
    introEmoji.textContent = '🤔';
    introTitle.innerHTML = t('result_unsure_title', '헷갈리실 땐<br>이렇게 확인해보세요');
    introSub.className = 's1-info-box';
    introSub.style.display = 'block';
    introSub.innerHTML = t('result_unsure_sub', `
      <div class="info-row">📍 우리 동네 <b>주민센터</b> 복지 담당자에게 문의</div>
      <div class="info-row">📞 <a href="tel:02-410-1298">KSPO 고객센터 02-410-1298~9</a></div>`);
    docsContent.innerHTML = '';
    // 서류 페이지엔 보여줄 정보가 없으니, 확인 후 바로 다음 단계(시설 찾기 등)로 안내
    setResultIntroNextBtn(t('btn_action_next', '확인했어요, 다음으로 →'), 'resultAction');
    return;
  }
  if(age < 5 || age > 18){
    if(priorityEl) priorityEl.innerHTML = '';
    introEmoji.textContent = '😅';
    introTitle.innerHTML = t('result_ineligible_title', '아쉽지만<br>대상이 아니에요');
    introSub.className = 's1-info-box';
    introSub.style.display = 'block';
    introSub.innerHTML = t('result_ineligible_sub', `<div class="info-row">이 지원은 <b>만 5~18세</b>만 받을 수 있어요</div>`);
    docsContent.innerHTML = '';
    setResultIntroNextBtn(t('btn_facility_next', '그래도 시설은 둘러볼게요 →'), 'resultAction');
    return;
  }

  const docChecklist = {
    crime: [t('doc_id_card','신분증'), t('doc_application_form','신청서 (신청 시 현장 작성 가능)'), t('doc_cert_crime','사건사고사실확인원 (관할 경찰서 발급)')],
    basic: [t('doc_id_card','신분증'), t('doc_application_form','신청서 (신청 시 현장 작성 가능)'), t('doc_cert_basic','기초생활수급자 증명서 (주민센터 발급, 온라인 정부24 가능)')],
    near: [t('doc_id_card','신분증'), t('doc_application_form','신청서 (신청 시 현장 작성 가능)'), t('doc_cert_near','차상위계층 확인서 (주민센터 발급 — 꼭 미리 받아두세요)')],
    single: [t('doc_id_card','신분증'), t('doc_application_form','신청서 (신청 시 현장 작성 가능)'), t('doc_cert_single','한부모가족증명서 (주민센터 발급)')],
  };
  const docs = docChecklist[val] || [];
  const docsHtml = docs.length
    ? `<div class="doc-checklist">
        <div class="doc-title">📋 ${t('doc_title_text','신청할 때 필요한 서류')} <span class="doc-progress" id="docProgress"></span></div>
        <button class="speak-btn speak-btn-inline" onclick="speakElementsText('.doc-item span', this, '${escapeAttr(t('doc_speak_prefix','신청할 때 필요한 서류는 다음과 같아요. '))}')">${t('speak_listen','🔊 들려주기')}</button>
        ${docs.map((d,i)=>{
          const key = `fp_doc_${val}_${i}`;
          const checked = localStorage.getItem(key) === '1';
          return `<label class="doc-item"><input type="checkbox" class="doc-checkbox" data-key="${key}" ${checked?'checked':''} onchange="onDocCheck(this)"><span>${d}</span></label>`;
        }).join('')}
       </div>`
    : '';

  const userName = localStorage.getItem('fairplay_display_name') || localStorage.getItem('fairplay_name');
  const displayName = userName || t('generic_applicant', '대상자');
  const namePrefix = userName ? `${userName}${t('name_suffix','님은')}` : t('generic_applicant_subject','대상자는');

  docsContent.innerHTML = docsHtml;
  hideSpeakButtonsIfUnsupported(); // 방금 새로 생긴 듣기 버튼도 미지원 브라우저면 숨김

  if(val === 'near'){
    introEmoji.textContent = '🎉';
    introTitle.innerHTML = t('result_near_title', `${escapeHtml(namePrefix)}<br>차상위계층도 받을 수 있어요!`).replace('{name}', escapeHtml(displayName));
    introSub.className = 's1-sub';
    introSub.style.display = 'block';
    introSub.innerHTML = t('result_near_sub', `100명 중 <b class="stat-callout">2~3명</b>만 신청 중이에요<br>대부분 몰라서 못 받고 있는 거예요`);
  } else {
    introEmoji.textContent = '🎉';
    introTitle.innerHTML = t('result_eligible_title', `${escapeHtml(namePrefix)}<br>받을 수 있는 대상이에요!`).replace('{name}', escapeHtml(displayName));
    introSub.className = 's1-sub';
    introSub.style.display = 'none';
  }
  setResultIntroNextBtn(t('btn_docs_next', '필요한 서류 알아볼까요? →'), 'docsChecklist');
  updateDocProgress();
}

// 자가진단 결과 화면의 다음 버튼은 결과에 따라 목적지가 달라짐
// (자격이 확실할 때만 "서류" 페이지로 보내고, 애매하거나 대상이 아니면 바로 다음 행동으로 안내해서
//  빈 화면을 보여주는 일이 없게 함)
function setResultIntroNextBtn(label, targetStep){
  const btn = document.getElementById('resultIntroNextBtn');
  if(!btn) return;
  btn.textContent = label;
  btn.onclick = () => s1GoTo(targetStep);
}

// 신규1 — 신청 창구 안내 (상담센터·카드사·지자체 담당자 조회, 공식 자료 기준)
function applyHelpHtml(){
  return `
    <div class="apply-help">
      <div class="doc-title" style="margin-bottom:10px;">📞 궁금한 점이 있으면</div>
      <a class="apply-help-item" href="tel:1551-0078">상담센터 1551-0078 <span>신청·자격 문의</span></a>
      <a class="apply-help-item" href="tel:1544-7000">신한카드 1544-7000 <span>카드 발급·분실 문의</span></a>
      <a class="apply-help-item" href="https://svoucher.kspo.or.kr" target="_blank" rel="noopener">우리 동네 담당자 찾기 → <span>지자체별 담당자 조회</span></a>
    </div>`;
}

// 서류 체크박스 — 체크 상태를 저장해두고, 준비 완료 개수를 보여줍니다
function onDocCheck(el){
  localStorage.setItem(el.dataset.key, el.checked ? '1' : '0');
  updateDocProgress();
}
function updateDocProgress(){
  const boxes = document.querySelectorAll('.doc-checkbox');
  const progressEl = document.getElementById('docProgress');
  if(!boxes.length || !progressEl) return;
  const total = boxes.length;
  const done = [...boxes].filter(b=>b.checked).length;
  progressEl.textContent = done === total ? `${done}/${total} 완료 ✅` : `${done}/${total} 준비됨`;
}

document.getElementById('ageSelect').addEventListener('change', runDiagnose);
document.querySelectorAll('input[name="household"]').forEach(el=>{
  el.addEventListener('change', ()=>{
    runDiagnose();
    // "잘 모르겠어요"는 순위 계산이 의미 없으니 바로 결과로, 나머지는 이전 이용 여부부터 물어봄
    if(el.value === 'unsure'){ s1GoTo('resultIntro'); }
    else{ s1GoTo('priorhistory'); }
  });
});

// 신규2 — 선정 순위 안내 (정부24 공식 4단계 기준, 신중한 문구로)
// ⚠ "선정됩니다/떨어집니다"로 단정하지 않고, 일반적인 기준임을 항상 함께 표시합니다.
function s1SubmitPriorHistory(val){
  localStorage.setItem('fairplay_prior_history', val);
  const household = document.querySelector('input[name="household"]:checked')?.value;
  renderPriorityNotice(household, val);
  s1GoTo('resultIntro');
}

function renderPriorityNotice(household, priorHistory){
  const el = document.getElementById('priorityNotice');
  if(!el) return;
  if(priorHistory === 'unsure' || !household){ el.innerHTML = ''; return; }

  let tierText = '';
  if(household === 'crime'){
    tierText = '범죄피해가정은 별도 우선순위 기준이 적용돼요. 자세한 내용은 지자체에 문의해주세요.';
  } else {
    const isNew = priorHistory === 'new';
    if(household === 'basic'){
      tierText = isNew ? '일반적으로 <b>1순위</b>에 해당하는 조건이에요.' : '일반적으로 <b>3순위</b>에 해당하는 조건이에요.';
    } else if(household === 'near' || household === 'single'){
      tierText = isNew ? '일반적으로 <b>2순위</b>에 해당하는 조건이에요.' : '일반적으로 <b>4순위</b>에 해당하는 조건이에요.';
    }
  }
  if(!tierText){ el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="priority-notice">
      <div class="doc-title" style="margin-bottom:6px;">🏅 예상 선정 순위</div>
      <div>${tierText}</div>
      <div class="priority-disclaimer">
        ※ 정부24 공식 기준(생계·의료·주거급여 1·3순위, 차상위·한부모 2·4순위)을 바탕으로 한 <b>일반적인 안내</b>예요.
        신청자 모두가 선정되는 건 아니고, 실제 선정은 지자체 예산과 사정에 따라 달라질 수 있어요.
        정확한 내용은 우리 지역 공고를 꼭 확인해주세요.
      </div>
    </div>`;
}

// ==================== PWA 바로가기 (App Shortcuts) ====================
// 홈 화면 아이콘을 길게 눌러 나오는 단축 메뉴에서 진입한 경우, 온보딩(이름 입력 등)을
// 거치지 않고 바로 원하는 화면으로 이동시킵니다. (Android Chrome 계열에서만 지원되는 기능이며,
// manifest.json의 "shortcuts" 항목과 짝을 이룹니다.) 처리했으면 true를 반환해서 온보딩 화면을 건너뜁니다.
function handlePwaShortcut(){
  const shortcut = new URLSearchParams(location.search).get('shortcut');
  if(!shortcut) return false;

  if(localStorage.getItem('fairplay_onboarded')) applyStoredProfile();

  if(shortcut === 'diagnose'){
    goToStep(1);
  } else if(shortcut === 'facility'){
    goToStep(2);
  } else {
    return false; // 모르는 값이면 평소처럼 온보딩부터 시작
  }
  return true;
}

window.addEventListener('load', ()=>{
  // 검정 프리로드 스플래시: SPO+O가 합쳐지는 애니메이션(~1.2초)과 태그라인이 다 나온 뒤 사라짐
  setTimeout(()=>{
    const pre = document.getElementById('preloadSplash');
    if(pre){
      pre.classList.add('hide');
      setTimeout(()=> pre.remove(), 500);
    }
  }, 3400);

  if(!handlePwaShortcut()) initOnboarding();
  registerServiceWorker();
  setupInstallPrompt();
  setTimeout(()=>{
    if(typeof naver === 'undefined' && !window.__NAVER_AUTH_FAILED){
      document.getElementById('map').innerHTML =
        '<div style="padding:24px;font-family:sans-serif;color:#F04452;">네이버 지도가 안 열려요. Client ID를 넣었는지 확인해주세요.</div>';
      return;
    }
    if(typeof naver !== 'undefined'){ init(); }
  }, 300);
});

/* ==================== PWA: 서비스워커 등록 + 홈 화면 추가 안내 ==================== */
function registerServiceWorker(){
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').then(()=>{
      console.log('서비스워커 등록 완료 — 이제 홈 화면에 앱으로 설치할 수 있어요');
    }).catch((err)=>{
      console.log('서비스워커 등록 실패(무시 가능, 사이트는 정상 작동):', err);
    });
  }
}

let deferredInstallPrompt = null;
function setupInstallPrompt(){
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  if(isStandalone) return; // 이미 앱으로 설치되어 실행 중이면 안내 안 함

  if(isIOS){
    if(localStorage.getItem('fairplay_hide_install')) return;
    const banner = document.getElementById('installBanner');
    document.getElementById('installBtn').style.display = 'none';

    // iOS에서 "홈 화면에 추가"는 사파리의 공유 메뉴에만 있어요 (크롬 등 다른 브라우저는 이 옵션 자체가 없음)
    const isSafari = /^((?!CriOS|FxiOS|EdgiOS|OPiOS|mercury).)*Safari/i.test(ua);
    if(isSafari){
      banner.querySelector('span').textContent = '📱 하단 공유 버튼 → "홈 화면에 추가"로 앱처럼 쓸 수 있어요';
    } else {
      banner.querySelector('span').textContent = '📱 홈 화면 추가는 사파리에서만 가능해요 — 사파리로 열어서 시도해주세요';
    }
    banner.style.display = 'flex';
    return;
  }

  // 안드로이드/크롬: 브라우저가 "설치 가능" 신호를 주면 잡아뒀다가, 안내 버튼에서 사용
  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBanner();
  });
  window.addEventListener('appinstalled', ()=>{
    hideInstallBanner();
  });
}
function showInstallBanner(){
  if(localStorage.getItem('fairplay_hide_install')) return;
  const banner = document.getElementById('installBanner');
  if(banner) banner.style.display = 'flex';
}
function hideInstallBanner(){
  const banner = document.getElementById('installBanner');
  if(banner) banner.style.display = 'none';
}
function triggerInstall(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(()=>{ deferredInstallPrompt = null; });
}
document.getElementById('closeInstallBanner')?.addEventListener('click', ()=>{
  hideInstallBanner();
  localStorage.setItem('fairplay_hide_install', '1');
});
document.getElementById('installBtn')?.addEventListener('click', triggerInstall);

import * as store from './store.js';
import * as sync from './sync.js';
import * as drive from './drive.js';
import * as idb from './idb.js';
import { recognize, normalizeImage } from './ocr.js';
import { detectCard, warpCard } from './scan.js';
import { isNative, Native, App, base64ToBlob } from './native.js';
import * as rules from './contactRules.js';
import { contactDisplayName, getUsePhoto } from './contactRules.js';
import { parseCard, chosung, formatPhone, hyphenatePhone } from './parser.js';
import { buildShareText, copyText, shareCardText, shareVCard, sharePhotos, downloadBlob } from './share.js';
import { FIELDS, FIELD_KEYS, fieldLabel } from './fields.js';
import { icon } from './icons.js';
import { APP_VERSION, AUTH_VERSION } from './config.js';

const $app = document.getElementById('app');
const $overlay = document.getElementById('overlay-root');
const $toast = document.getElementById('toast-root');

const MAX_PHOTOS = 2;
const PHONE_KEYS = ['mobile', 'phone', 'fax'];
const ui = { filter: 'all', query: '', sort: 'recent', ...store.getUiPrefs() };
ui.query = '';
let draft = null; // 편집 중인 명함
let capture = null; // 사진 선택 후 할 일 { mode: 'new' | 'add' | 'replace', mine }
let imageUrls = []; // 해제할 objectURL

// ---------- 유틸 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const digits = s => String(s || '').replace(/\D/g, '');
const fmtDate = t => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const timeAgo = t => {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(t).toLocaleDateString('ko-KR');
};
const objectUrl = blob => {
  const url = URL.createObjectURL(blob);
  imageUrls.push(url);
  return url;
};
const releaseUrls = () => {
  imageUrls.forEach(u => URL.revokeObjectURL(u));
  imageUrls = [];
};
const sideLabel = i => (i === 0 ? '앞면' : '뒷면');

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $toast.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 4500 : 2500);
}

function cardColor(card) {
  if (card.isMine) return 'var(--primary)';
  const g = card.groupIds?.map(store.getGroup).find(Boolean);
  if (g) return g.color;
  const palette = store.GROUP_COLORS;
  let h = 0;
  for (const ch of card.name || card.company || '?') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
const initial = card => (card.name || card.company || '?').trim().charAt(0).toUpperCase();
const avatar = (card, cls = '') => `<div class="avatar ${cls}" style="--c:${cardColor(card)}">${esc(initial(card))}</div>`;

// ---------- 오버레이 (시트 / 대화상자) ----------
function openOverlay(html, { center = false, cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = `overlay ${center ? 'center' : ''} ${cls}`;
  el.innerHTML = html;
  $overlay.appendChild(el);
  return el;
}

function sheet({ title = '', sub = '', items, grid = false }) {
  return new Promise(resolve => {
    const el = openOverlay(`
      <div class="sheet" role="dialog">
        ${title ? `<p class="sheet-title">${esc(title)}</p>` : ''}
        ${sub ? `<p class="sheet-sub">${esc(sub)}</p>` : ''}
        <div class="${grid ? 'sheet-grid' : ''}">
          ${items.map((it, i) => `
            <button class="sheet-item ${it.danger ? 'danger' : ''}" data-i="${i}">
              ${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</span>
            </button>`).join('')}
        </div>
      </div>`);
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-i]');
      if (!btn && e.target !== el) return;
      el.remove();
      resolve(btn ? items[+btn.dataset.i].value : null);
    });
  });
}

function dialog({ title, message = '', buttons, input = null }) {
  return new Promise(resolve => {
    const el = openOverlay(`
      <div class="dialog" role="alertdialog">
        <h2>${esc(title)}</h2>
        ${message ? `<p>${esc(message)}</p>` : ''}
        ${input ? `<input class="input" id="dialog-input" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}">` : ''}
        <div class="buttons ${buttons.length <= 2 ? 'row' : ''}">
          ${buttons.map((b, i) => `<button class="btn ${b.style || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>`, { center: true });
    const $input = el.querySelector('#dialog-input');
    const finish = value => {
      el.remove();
      resolve(input ? (value === null ? null : { value, text: $input.value.trim() }) : value);
    };
    if ($input) {
      setTimeout(() => $input.focus(), 50);
      $input.addEventListener('keydown', e => e.key === 'Enter' && finish(buttons[0].value));
    }
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-i]');
      if (btn) finish(buttons[+btn.dataset.i].value);
      else if (e.target === el) finish(null);
    });
  });
}

const confirmDialog = (title, message, okLabel = '확인', danger = false) =>
  dialog({ title, message, buttons: [{ label: okLabel, value: true, style: danger ? 'danger' : 'primary' }, { label: '취소', value: false }] });

async function promptDialog(title, value = '', placeholder = '') {
  const res = await dialog({ title, input: { value, placeholder }, buttons: [{ label: '확인', value: 'ok', style: 'primary' }, { label: '취소', value: null }] });
  return res && res.value === 'ok' ? res.text : null;
}

function viewImage(url) {
  const el = openOverlay(`<img src="${url}" alt="명함 사진">`, { center: true, cls: 'viewer' });
  el.addEventListener('click', () => el.remove());
}

// 명함 테두리 맞추기: 자동으로 찾은 네 모서리를 보여 주고, 끌어서 조정한 뒤 반듯하게 펴서 잘라냅니다.
// 반환: 잘라낸 Blob | 원본 Blob('자르지 않기') | null(취소)
async function cropDialog(blob, det = null) {
  det ||= await detectCard(blob);
  const corners = det.corners.map(p => ({ ...p }));
  return new Promise(resolve => {
    const el = openOverlay(`
      <div class="cropper">
        <div class="crop-bar">
          <button class="icon-btn" data-c="cancel" aria-label="취소">${icon('x')}</button>
          <h1>명함 테두리 맞추기</h1>
        </div>
        <div class="crop-stage">
          <div class="crop-wrap">
            <img src="${objectUrl(blob)}" alt="" draggable="false">
            <svg class="crop-svg"><path class="crop-shade" fill-rule="evenodd"/><polygon class="crop-line"/></svg>
            ${corners.map((_, i) => `<div class="crop-handle" data-k="${i}"></div>`).join('')}
          </div>
        </div>
        <p class="crop-hint">${det.found ? '명함 테두리를 찾았어요. 모서리 점을 끌어서 더 정확히 맞출 수 있어요.' : '테두리를 찾지 못했어요. 네 점을 명함 모서리로 옮겨 주세요.'}</p>
        <div class="crop-actions">
          <button class="btn ghost" data-c="full">자르지 않기</button>
          <button class="btn primary" data-c="ok">${icon('check')}확인</button>
        </div>
      </div>`, { cls: 'crop-overlay' });
    const wrap = el.querySelector('.crop-wrap');
    const img = wrap.querySelector('img');
    const svg = wrap.querySelector('svg');
    const handles = [...wrap.querySelectorAll('.crop-handle')];

    const layout = () => {
      const s = img.clientWidth / det.width;
      if (!s) return;
      const pts = corners.map(p => [p.x * s, p.y * s]);
      svg.setAttribute('viewBox', `0 0 ${img.clientWidth} ${img.clientHeight}`);
      svg.querySelector('.crop-line').setAttribute('points', pts.map(p => p.join(',')).join(' '));
      svg.querySelector('.crop-shade').setAttribute('d',
        `M0 0H${img.clientWidth}V${img.clientHeight}H0Z M${pts.map(p => p.join(' ')).join(' L')}Z`);
      handles.forEach((hd, i) => (hd.style.transform = `translate(${pts[i][0]}px, ${pts[i][1]}px)`));
    };
    img.onload = layout;
    if (img.complete) layout();
    window.addEventListener('resize', layout);

    let dragging = null;
    wrap.addEventListener('pointerdown', e => {
      const hd = e.target.closest('.crop-handle');
      if (!hd) return;
      dragging = +hd.dataset.k;
      hd.setPointerCapture(e.pointerId);
      hd.classList.add('active');
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', e => {
      if (dragging === null) return;
      const r = img.getBoundingClientRect();
      const s = r.width / det.width;
      corners[dragging] = {
        x: Math.max(0, Math.min(det.width, (e.clientX - r.left) / s)),
        y: Math.max(0, Math.min(det.height, (e.clientY - r.top) / s)),
      };
      layout();
    });
    const endDrag = () => {
      handles.forEach(hd => hd.classList.remove('active'));
      dragging = null;
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    const finish = value => {
      window.removeEventListener('resize', layout);
      el.remove();
      resolve(value);
    };
    el.addEventListener('click', async e => {
      const c = e.target.closest('[data-c]')?.dataset.c;
      if (c === 'cancel') finish(null);
      else if (c === 'full') finish(blob);
      else if (c === 'ok') {
        e.target.closest('button').disabled = true;
        el.querySelector('.crop-hint').textContent = '반듯하게 펴는 중…';
        try {
          finish(await warpCard(blob, corners));
        } catch (err) {
          toast('자르기에 실패했습니다: ' + err.message, 'error');
          finish(blob);
        }
      }
    });
  });
}

// ---------- 라우팅 ----------
function route() {
  const [, view = '', id = ''] = (location.hash.slice(1) || '/').split('/');
  return { view: view || 'list', id: decodeURIComponent(id) };
}
// 앱 안에서 지나온 화면 기록 (뒤로 가기를 브라우저 기록과 맞추기 위함)
const visited = [location.hash || '#/'];
let replacing = false;

function go(hash, { replace = false } = {}) {
  if ((location.hash || '#/') === hash) return render();
  replacing = replace;
  if (replace) location.replace(hash);
  else location.hash = hash;
}

function onHashChange() {
  const h = location.hash || '#/';
  if (replacing) visited[visited.length - 1] = h;
  else if (visited.at(-2) === h) visited.pop();
  else visited.push(h);
  replacing = false;
  render();
}

function back() {
  const { view, id } = route();
  const parent = view === 'edit' ? `#/card/${id}` : '#/';
  if (visited.at(-2) === parent) history.back();
  else go(parent, { replace: true });
}

function render() {
  releaseUrls();
  $overlay.innerHTML = '';
  const { view, id } = route();
  window.scrollTo(0, 0);
  if (needsLogin()) return renderLogin();
  if (view === 'card') return renderDetail(id);
  if (view === 'edit') return renderEditor(id);
  if (view === 'new') return renderEditor(null);
  if (view === 'me') return renderMyCard();
  if (view === 'groups') return renderGroups();
  if (view === 'settings') return renderSettings();
  return renderList();
}

// ---------- Google 계정 로그인 ----------
// 앱은 Google 계정으로 로그인해야 쓸 수 있고, 로그아웃하기 전까지 로그인이 유지됩니다.
// (웹은 로그인 없이 이 기기에만 저장해서 쓸 수도 있습니다)
const isLoggedIn = () => !!store.getSyncMeta().email;
const needsLogin = () => isNative && !isLoggedIn();

const GOOGLE_G = `<svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

function renderLogin() {
  $app.innerHTML = `
    <main class="login">
      <img class="login-logo" src="icons/icon.svg" alt="">
      <h1>카들리</h1>
      <p class="login-sub">명함을 찍으면 자동으로 정리되는<br>나만의 명함첩</p>
      <button class="btn google-btn" data-action="login">${GOOGLE_G}Google 계정으로 로그인</button>
      <p class="login-error" id="login-error"></p>
      <p class="small-note">명함과 사진은 로그인한 Google 계정의 Drive<br>'명함관리' 폴더에 저장되어, 휴대폰을 바꿔도 그대로 불러옵니다.</p>
    </main>`;
}

async function loginGoogle() {
  const btn = document.querySelector('[data-action="login"]');
  if (btn) btn.disabled = true;
  try {
    const user = await sync.connect();
    toast(`${user.emailAddress} 계정으로 로그인했습니다.`);
    render();
  } catch (e) {
    const box = document.getElementById('login-error');
    if (box) box.textContent = '로그인하지 못했습니다: ' + e.message;
    else toast(e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
  updateSyncBadge();
}

// 로그아웃: Drive에 먼저 저장한 뒤 이 기기의 데이터를 지웁니다. (다시 로그인하면 Drive에서 불러옴)
async function logout() {
  if (!(await confirmDialog('로그아웃할까요?', '이 기기에 있는 명함은 지워지고, 다시 로그인하면 Google Drive에서 그대로 불러옵니다.', '로그아웃'))) return;
  await sync.syncNow();
  if (sync.getStatus().state !== 'synced' &&
      !(await confirmDialog('Drive에 저장하지 못했어요', `${sync.getStatus().message || '인터넷 연결을 확인해 주세요.'}\n지금 로그아웃하면 아직 저장되지 않은 변경은 사라질 수 있습니다.`, '그래도 로그아웃', true))) return;
  sync.disconnect();
  store.resetAll();
  await idb.clearImages().catch(() => {});
  draft = null;
  toast('로그아웃했습니다.');
  go('#/', { replace: true });
}

// ---------- 동기화 표시 ----------
const SYNC_LABEL = {
  local: ['cloudOff', '로그인 안 됨'],
  auth: ['alert', '다시 로그인'],
  syncing: ['refresh', '동기화 중'],
  synced: ['cloudCheck', '동기화됨'],
  offline: ['cloudOff', '오프라인'],
  error: ['alert', '동기화 오류'],
};
function syncBadge() {
  const st = sync.getStatus();
  const [ic, label] = SYNC_LABEL[st.state] || SYNC_LABEL.local;
  return `<button class="sync-btn" id="sync-indicator" data-action="sync-click" data-state="${st.state}" title="${esc(st.message)}">${icon(ic)}<span>${label}</span></button>`;
}
function updateSyncBadge() {
  const el = document.getElementById('sync-indicator');
  if (el) el.outerHTML = syncBadge();
  if (route().view === 'settings') {
    const box = document.getElementById('drive-status');
    if (box) box.innerHTML = driveStatusHtml();
  }
}

async function onSyncClick() {
  const st = sync.getStatus().state;
  if (st === 'local') return go('#/settings');
  if (st === 'auth') return loginGoogle();
  if (st === 'error') toast(sync.getStatus().message, 'error');
  await sync.syncNow();
}

// ---------- 목록 ----------
function filteredCards() {
  let list = store.cards();
  const f = ui.filter;
  if (f === 'fav') list = list.filter(c => c.favorite);
  else if (f === 'none') list = list.filter(c => !c.groupIds?.length);
  else if (f !== 'all') list = list.filter(c => c.groupIds?.includes(f));

  const q = ui.query.trim().toLowerCase();
  if (q) {
    const qDigits = digits(q);
    const isCho = /^[ㄱ-ㅎ\s]+$/.test(q);
    const qCompact = q.replace(/\s/g, '');
    list = list.filter(c => {
      if (isCho) return [c.name, c.company].some(v => chosung(v).replace(/\s/g, '').includes(qCompact));
      const hay = [c.name, c.company, c.department, c.title, c.email, c.address, c.memo, c.website].join(' ').toLowerCase();
      if (hay.includes(q) || hay.replace(/\s/g, '').includes(qCompact)) return true;
      return qDigits.length >= 3 && [c.mobile, c.phone, c.fax].some(n => digits(n).includes(qDigits));
    });
  }
  const byText = k => (a, b) => (a[k] || '￿').localeCompare(b[k] || '￿', 'ko');
  if (ui.sort === 'name') list.sort(byText('name'));
  else if (ui.sort === 'company') list.sort((a, b) => byText('company')(a, b) || byText('name')(a, b));
  else list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function myCardBanner() {
  const mine = store.getMyCard();
  if (!mine) {
    return `
      <button class="my-card add" data-action="nav" data-to="#/me">
        <div class="avatar" style="--c:var(--primary)">${icon('user')}</div>
        <div class="grow"><strong>내 명함 등록하기</strong><small>등록해 두면 언제든 바로 보낼 수 있어요</small></div>
        ${icon('chevron')}
      </button>`;
  }
  const sub = [mine.company, mine.title].filter(Boolean).join(' · ');
  return `
    <div class="my-card" data-action="open" data-id="${mine.id}">
      ${avatar(mine)}
      <div class="grow"><span class="badge">내 명함</span><strong>${esc(mine.name || '(이름 없음)')}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
      <button class="btn small primary" data-action="share" data-id="${mine.id}">${icon('share')}보내기</button>
    </div>`;
}

function renderList() {
  const all = store.cards();
  const groups = store.groups();
  if (ui.filter !== 'all' && ui.filter !== 'fav' && ui.filter !== 'none' && !store.getGroup(ui.filter)) ui.filter = 'all';
  const chip = (id, label, count, color) =>
    `<button class="chip ${ui.filter === id ? 'on' : ''}" data-action="filter" data-id="${id}">${color ? `<span class="dot" style="--c:${color}"></span>` : ''}${esc(label)} <span class="count">${count}</span></button>`;

  $app.innerHTML = `
    <header class="topbar">
      <div class="brand">${icon('contact')}<span>카들리</span></div>
      <div class="topbar-actions">
        ${syncBadge()}
        <button class="icon-btn" data-action="nav" data-to="#/groups" aria-label="그룹 관리">${icon('users')}</button>
        <button class="icon-btn" data-action="nav" data-to="#/settings" aria-label="설정">${icon('settings')}</button>
      </div>
    </header>
    <div class="list-tools">
      <label class="search">${icon('search')}<input id="search" type="search" placeholder="이름, 회사, 번호 검색 (초성 ㅎㄱㄷ 가능)" value="${esc(ui.query)}" autocomplete="off"></label>
      <div class="chips scroll">
        ${chip('all', '전체', all.length)}
        ${chip('fav', '★ 즐겨찾기', all.filter(c => c.favorite).length)}
        ${groups.map(g => chip(g.id, g.name, all.filter(c => c.groupIds?.includes(g.id)).length, g.color)).join('')}
        ${groups.length ? chip('none', '미분류', all.filter(c => !c.groupIds?.length).length) : ''}
        <button class="chip dashed" data-action="add-group-quick">${icon('plus')}그룹</button>
      </div>
      <div class="list-meta">
        <span id="list-count"></span>
        <select id="sort" aria-label="정렬">
          <option value="recent" ${ui.sort === 'recent' ? 'selected' : ''}>최근 등록순</option>
          <option value="name" ${ui.sort === 'name' ? 'selected' : ''}>이름순</option>
          <option value="company" ${ui.sort === 'company' ? 'selected' : ''}>회사순</option>
        </select>
      </div>
    </div>
    <div id="my-card-slot" class="my-card-slot"></div>
    <main class="card-list" id="card-list"></main>
    <button class="fab" data-action="add">${icon('camera')}<span>명함 추가</span></button>`;
  renderListItems();
}

function renderListItems() {
  const box = document.getElementById('card-list');
  if (!box) return;
  const slot = document.getElementById('my-card-slot');
  slot.innerHTML = ui.filter === 'all' && !ui.query.trim() ? myCardBanner() : '';
  const list = filteredCards();
  document.getElementById('list-count').textContent = `${list.length}개`;
  if (!store.cards().length) {
    box.innerHTML = `
      <div class="empty">
        ${icon('scan')}
        <h2>첫 명함을 등록해 보세요</h2>
        <p>명함을 촬영하면 이름, 회사, 연락처를 자동으로 읽어옵니다.</p>
        <button class="btn primary" data-action="capture">${icon(isNative ? 'scan' : 'camera')}${isNative ? '명함 스캔하기' : '명함 촬영하기'}</button>
      </div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty"><p>조건에 맞는 명함이 없습니다.</p></div>`;
    return;
  }
  box.innerHTML = list.map(c => {
    const sub = [c.company, c.department].filter(Boolean).join(' · ');
    const contact = c.mobile || c.phone || c.email;
    const tel = c.mobile || c.phone;
    return `
      <div class="card-item" data-action="open" data-id="${c.id}">
        ${avatar(c)}
        <div class="ci-body">
          <div class="ci-top"><strong>${esc(c.name || '(이름 없음)')}</strong><span class="ci-title">${esc(c.title)}</span>${c.favorite ? icon('star', 'ci-star') : ''}</div>
          ${sub ? `<div class="ci-sub">${esc(sub)}</div>` : ''}
          ${contact ? `<div class="ci-sub2">${esc(contact)}</div>` : ''}
        </div>
        ${tel ? `<a class="ci-call" href="tel:${esc(digits(tel))}" aria-label="전화 걸기">${icon('phone')}</a>` : ''}
      </div>`;
  }).join('');
}

// ---------- 명함 추가 / 사진 선택 ----------
// source: 'camera' | 'gallery' | 'scanned'(갤럭시 카메라 문서 스캔으로 이미 잘라 둔 사진 → 자르기 화면 생략)
//         | 'native-scan'(앱 전용: ML Kit 문서 스캐너로 테두리를 잡아 촬영)
function pickPhoto(source, target) {
  if (source === 'native-scan') return nativeScan(target);
  capture = { ...target, scanned: source === 'scanned' };
  document.getElementById(source === 'camera' ? 'file-camera' : 'file-gallery').click();
}

const PHOTO_SOURCES = isNative
  ? [
      { label: '명함 스캔', desc: '테두리를 자동으로 잡아 반듯하게 찍습니다 (앞·뒷면 연속 촬영 가능)', icon: 'scan', value: 'native-scan' },
      { label: '앨범에서 사진 선택', icon: 'image', value: 'gallery' },
    ]
  : [
      { label: '카메라로 촬영', desc: '찍은 뒤 명함 테두리를 맞춰 자릅니다', icon: 'camera', value: 'camera' },
      { label: '갤럭시 카메라로 스캔한 사진', desc: '문서 스캔으로 잘라 둔 사진을 그대로 인식', icon: 'scan', value: 'scanned' },
      { label: '앨범에서 사진 선택', icon: 'image', value: 'gallery' },
    ];

// 앱: ML Kit 문서 스캐너. 새 명함이면 앞면·뒷면 2장까지 이어서 찍을 수 있습니다.
async function nativeScan(target) {
  try {
    const res = await Native.scanDocument({ pageLimit: target.mode === 'new' ? MAX_PHOTOS : 1 });
    if (res.cancelled || !res.images?.length) return;
    const blobs = [];
    for (const b64 of res.images) blobs.push(await normalizeImage(await base64ToBlob(b64)));
    addPickedPhotos(blobs, target);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function addCard({ mine = false } = {}) {
  const choice = await sheet({
    title: mine ? '내 명함 등록' : '명함 추가',
    items: [...PHOTO_SOURCES, { label: '직접 입력', icon: 'edit', value: 'manual' }],
  });
  if (choice && choice !== 'manual') pickPhoto(choice, { mode: 'new', mine });
  else if (choice === 'manual') {
    draft = newDraft(null, { mine });
    go('#/new');
  }
}

function newDraft(card = null, { mine = false } = {}) {
  const fields = {};
  FIELD_KEYS.forEach(k => (fields[k] = card?.[k] || ''));
  const isMine = card ? !!card.isMine : mine;
  if (!card && mine) fields.email = store.getSyncMeta().email || '';
  const main = card ? store.mainPhotoIndex(card) : 0;
  return {
    forId: card?.id || 'new',
    id: card?.id || store.uid(),
    isMine,
    fields,
    groupIds: isMine ? [] : [...(card?.groupIds || (ui.filter !== 'all' && ui.filter !== 'fav' && ui.filter !== 'none' ? [ui.filter] : []))],
    favorite: card?.favorite || false,
    // 사진: { id, fileId, blob, changed } — 0번 앞면, 1번 뒷면
    photos: store.photosOf(card).map(p => ({ id: p.id, fileId: p.fileId || null, blob: null, changed: false })),
    mainPhoto: main,
    view: main,
    removed: [], // 지운/교체된 사진 { id, fileId }
    touched: new Set(),
    ocr: {}, // 사진 id → { status, progress, message, lines }
    ocrTexts: {}, // 사진 id → 인식 원문
    ocrFilled: {}, // 항목 → 그 값을 채운 사진 id
    runs: {},
    baseOcrText: card?.ocrText || '',
  };
}

// 테두리 맞추기 화면은 '테두리를 확실히 찾았고 아직 잘리지 않은 사진'일 때만 보여 줍니다.
// 이미 잘린 사진(갤럭시 스캔 등)이나 테두리를 못 찾은 사진은 원본 그대로 씁니다. (편집 화면의 [자르기]로 언제든 다시 맞춤)
async function prepareCardImage(file, target) {
  const blob = await normalizeImage(file);
  if (target.scanned || store.getSettings().cropScreen === 'off') return blob;
  const det = await detectCard(blob);
  if (!det.found || det.coverage > 0.85) return blob;
  return cropDialog(blob, det);
}

async function onImagePicked(file) {
  const target = capture || { mode: 'new' };
  capture = null;
  if (!file) return;
  try {
    const blob = await prepareCardImage(file, target);
    if (blob) addPickedPhotos([blob], target);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 고른/찍은 사진을 편집 중인 명함에 넣고 글자 인식을 시작합니다.
function addPickedPhotos(blobs, target) {
  const photos = blobs.slice(0, MAX_PHOTOS).map(blob => ({ id: store.uid(), fileId: null, blob, changed: true }));
  if (target.mode === 'new' || !draft) {
    draft = newDraft(null, { mine: !!target.mine });
    draft.photos = photos;
    go('#/new');
  } else if (target.mode === 'replace' && draft.photos[draft.view]) {
    const old = draft.photos[draft.view];
    draft.removed.push({ id: old.id, fileId: old.fileId });
    draft.photos[draft.view] = photos[0];
    photos.length = 1;
    renderEditorPhoto();
  } else {
    if (draft.photos.length >= MAX_PHOTOS) return toast('사진은 앞면, 뒷면 2장까지 넣을 수 있습니다.', 'error');
    draft.photos.push(photos[0]);
    photos.length = 1;
    draft.view = draft.photos.length - 1;
    renderEditorPhoto();
    renderOcrLines();
  }
  // 앞면을 먼저 인식해야 뒷면이 빈 항목만 채웁니다
  photos.reduce((prev, p) => prev.then(() => runOcr(p.id)), Promise.resolve());
}

// ---------- 편집 ----------
function renderEditor(id) {
  const card = id ? store.getCard(id) : null;
  if (id && !card) return go('#/', { replace: true });
  if (!draft || draft.forId !== (id || 'new')) draft = newDraft(card);
  const d = draft;

  const field = f => {
    const v = esc(d.fields[f.key]);
    const input = f.multiline
      ? `<textarea data-field="${f.key}" placeholder="${esc(f.placeholder)}" rows="3">${v}</textarea>`
      : `<input data-field="${f.key}" type="${f.type || 'text'}" value="${v}" placeholder="${esc(f.placeholder)}" ${f.type === 'tel' ? 'inputmode="tel"' : ''} autocomplete="off">`;
    return `<label class="field"><span>${esc(f.label)}</span>${input}</label>`;
  };
  const byKey = k => FIELDS.find(f => f.key === k);
  const title = d.isMine ? (card ? '내 명함 편집' : '내 명함 등록') : card ? '명함 편집' : '새 명함';

  $app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-action="cancel-edit" aria-label="취소">${icon('x')}</button>
      <h1>${title}</h1>
    </header>
    <main class="editor">
      <section id="editor-photo"></section>
      <section id="ocr-lines" class="ocr-lines"></section>
      <form id="card-form" class="form-section" autocomplete="off" onsubmit="return false">
        ${field(byKey('name'))}
        ${field(byKey('company'))}
        <div class="field-grid">${field(byKey('department'))}${field(byKey('title'))}</div>
        ${field(byKey('mobile'))}
        <div class="field-grid">${field(byKey('phone'))}${field(byKey('fax'))}</div>
        ${field(byKey('email'))}
        ${field(byKey('address'))}
        ${field(byKey('website'))}
        ${d.isMine ? '' : `
          <div class="form-section">
            <h3>그룹</h3>
            <div class="chips wrap" id="draft-groups"></div>
          </div>
          <label class="check-row"><input type="checkbox" id="draft-fav" ${d.favorite ? 'checked' : ''}> ★ 즐겨찾기</label>`}
        ${field(byKey('memo'))}
      </form>
    </main>
    <div class="editor-footer"><div class="inner">
      <button class="btn" data-action="cancel-edit">취소</button>
      <button class="btn primary" data-action="save-card">${icon('check')}저장</button>
    </div></div>`;

  renderEditorPhoto();
  renderDraftGroups();
  renderOcrLines();
  d.photos.forEach(p => {
    if (p.blob) return;
    sync.loadPhoto(p).then(blob => {
      if (blob && draft === d && !p.blob) {
        p.blob = blob;
        renderEditorPhoto();
      }
    }).catch(() => {});
  });
}

function renderEditorPhoto() {
  const box = document.getElementById('editor-photo');
  if (!box || !draft) return;
  const d = draft;
  if (!d.photos.length) {
    box.innerHTML = `
      <div class="photo-empty">
        명함 사진을 추가하면 내용을 자동으로 읽어옵니다.
        <div class="btns">
          ${PHOTO_SOURCES.map((s, i) => `<button class="btn small ${i ? '' : 'primary'}" data-action="photo-add" data-src="${s.value}">${icon(s.icon)}${esc(s.label)}</button>`).join('')}
        </div>
      </div>`;
    return updateOcrStatus();
  }
  d.view = Math.min(d.view, d.photos.length - 1);
  const p = d.photos[d.view];
  const tabs = d.photos.map((ph, i) => `
    <button class="seg ${i === d.view ? 'on' : ''}" data-action="photo-tab" data-i="${i}">
      ${sideLabel(i)}${i === d.mainPhoto ? ' <span class="main-mark">★ 대표</span>' : ''}
    </button>`).join('');
  box.innerHTML = `
    <div class="seg-row">
      ${tabs}
      ${d.photos.length < MAX_PHOTOS ? `<button class="seg add" data-action="photo-add-back">${icon('plus')}뒷면 추가</button>` : ''}
    </div>
    <div class="photo-box" data-action="view-draft-photo">${p.blob ? `<img src="${objectUrl(p.blob)}" alt="명함 ${sideLabel(d.view)}">` : '사진 불러오는 중…'}</div>
    <div class="photo-actions">
      ${d.photos.length > 1 && d.view !== d.mainPhoto ? `<button class="btn small primary" data-action="photo-main">${icon('star')}대표로 설정</button>` : ''}
      <button class="btn small" data-action="crop">${icon('crop')}자르기</button>
      <button class="btn small" data-action="rotate">${icon('rotate')}회전</button>
      <button class="btn small" data-action="photo-replace">${icon('camera')}사진 바꾸기</button>
      <button class="btn small" data-action="rerun-ocr">${icon('scan')}다시 인식</button>
      <button class="btn small ghost" data-action="remove-photo">${icon('trash')}삭제</button>
    </div>
    <div id="ocr-status"></div>`;
  updateOcrStatus();
}

function updateOcrStatus() {
  const el = document.getElementById('ocr-status');
  if (!el || !draft) return;
  const p = draft.photos[draft.view];
  const o = p && draft.ocr[p.id];
  if (!o) return (el.innerHTML = '');
  const cls = o.status === 'error' ? 'error' : o.status === 'done' ? 'done' : '';
  el.innerHTML = `<div class="ocr-status ${cls}">
    ${esc(o.message)}
    ${o.status === 'running' ? `<div class="progress"><div style="width:${Math.round(o.progress * 100)}%"></div></div>` : ''}
  </div>`;
}

function renderOcrLines() {
  const el = document.getElementById('ocr-lines');
  if (!el || !draft) return;
  const p = draft.photos[draft.view];
  const lines = (p && draft.ocr[p.id]?.lines) || [];
  el.innerHTML = lines.length
    ? `<h3>인식된 글자${draft.photos.length > 1 ? ` (${sideLabel(draft.view)})` : ''} <span class="hint">· 눌러서 항목에 넣기</span></h3>${lines.map((t, i) => `<button class="ocr-line" data-action="assign-line" data-i="${i}">${esc(t)}</button>`).join('')}`
    : '';
}

function renderDraftGroups() {
  const el = document.getElementById('draft-groups');
  if (!el || !draft) return;
  el.innerHTML =
    store.groups().map(g => `<button type="button" class="chip ${draft.groupIds.includes(g.id) ? 'on' : ''}" data-action="toggle-draft-group" data-id="${g.id}"><span class="dot" style="--c:${g.color}"></span>${esc(g.name)}</button>`).join('') +
    `<button type="button" class="chip dashed" data-action="new-group-in-draft">${icon('plus')}새 그룹</button>`;
}

function setDraftField(key, value) {
  draft.fields[key] = value;
  const input = document.querySelector(`[data-field="${key}"]`);
  if (input) input.value = value;
}

// 사진 한 장을 인식해서 비어 있는 항목을 채웁니다.
// 뒷면(영문 면 등)은 앞면에서 채운 값을 덮어쓰지 않고, 같은 사진을 다시 인식하면 그 사진이 채운 값은 갱신합니다.
async function runOcr(photoId) {
  const d = draft;
  const photo = d?.photos.find(p => p.id === photoId);
  if (!photo?.blob) return;
  const run = (d.runs[photoId] = (d.runs[photoId] || 0) + 1);
  const settings = store.getSettings();
  let engine = settings.ocrEngine;
  if (engine === 'vision' && !settings.visionApiKey) {
    engine = 'tesseract';
    toast('Vision API 키가 없어 기본 OCR을 사용합니다.');
  }
  const state = (d.ocr[photoId] = { status: 'running', progress: 0, message: '준비 중…', lines: d.ocr[photoId]?.lines || [] });
  const isCurrent = () => draft === d && d.runs[photoId] === run && d.photos.includes(photo);
  const refresh = () => {
    if (draft === d && d.photos[d.view] === photo) updateOcrStatus();
  };
  refresh();
  try {
    const res = await recognize(photo.blob, {
      engine,
      apiKey: settings.visionApiKey,
      onProgress: (p, msg) => {
        if (!isCurrent()) return;
        state.progress = p;
        state.message = msg;
        refresh();
      },
    });
    if (!isCurrent()) return;
    const parsed = parseCard(res);
    let filled = 0;
    for (const k of FIELD_KEYS) {
      if (!parsed[k] || d.touched.has(k)) continue;
      const cur = d.fields[k];
      if (k === 'memo' && cur && d.ocrFilled.memo !== photoId) continue;
      if (cur && d.ocrFilled[k] !== photoId) continue;
      d.fields[k] = parsed[k];
      d.ocrFilled[k] = photoId;
      filled++;
    }
    d.ocrTexts[photoId] = res.text;
    d.ocr[photoId] = {
      status: 'done',
      progress: 1,
      lines: res.lines.map(l => l.text).filter(Boolean),
      message: filled
        ? `${filled}개 항목을 읽었습니다. 틀린 부분은 아래 글자를 눌러 고치세요.`
        : d.photos.indexOf(photo) > 0 ? '뒷면에서 새로 채울 항목은 없었습니다.' : '읽은 항목이 없습니다. 사진을 회전하거나 다시 찍어 보세요.',
    };
    if (['new', 'edit'].includes(route().view)) {
      FIELD_KEYS.forEach(k => setDraftField(k, d.fields[k]));
      refresh();
      if (d.photos[d.view] === photo) renderOcrLines();
    }
  } catch (e) {
    console.error(e);
    if (!isCurrent()) return;
    d.ocr[photoId] = { status: 'error', progress: 0, lines: [], message: '인식 실패: ' + e.message };
    refresh();
  }
}

async function assignLine(i) {
  const p = draft?.photos[draft.view];
  const text = p && draft.ocr[p.id]?.lines[i];
  if (!text) return;
  const key = await sheet({
    title: '어느 항목에 넣을까요?',
    sub: text,
    grid: true,
    items: FIELDS.map(f => ({ label: f.label, icon: f.icon, value: f.key })),
  });
  if (!key) return;
  let value = text;
  if (PHONE_KEYS.includes(key)) {
    const m = text.match(/[\d+(][\d\s().-]{6,}\d/);
    value = formatPhone(m ? m[0] : text);
  } else if (key === 'email') {
    const m = text.replace(/\s*@\s*/g, '@').match(/[^\s@]+@[^\s@]+/);
    if (m) value = m[0];
  }
  const cur = draft.fields[key];
  if ((key === 'address' || key === 'memo') && cur && !cur.includes(value)) value = `${cur}${key === 'memo' ? '\n' : ' '}${value}`;
  setDraftField(key, value);
  draft.touched.add(key);
}

// 회전/자르기한 사진은 새 사진으로 취급 (Drive의 예전 파일은 저장할 때 정리)
function replaceDraftPhoto(p, blob) {
  const old = { id: p.id, fileId: p.fileId };
  if (!p.changed) draft.removed.push(old);
  Object.assign(p, { id: p.changed ? p.id : store.uid(), fileId: null, blob, changed: true });
  if (p.id !== old.id) {
    draft.ocr[p.id] = draft.ocr[old.id];
    for (const k in draft.ocrFilled) if (draft.ocrFilled[k] === old.id) draft.ocrFilled[k] = p.id;
  }
}

function removeDraftPhoto() {
  const d = draft;
  const p = d.photos[d.view];
  if (!p) return;
  d.removed.push({ id: p.id, fileId: p.fileId });
  d.photos.splice(d.view, 1);
  if (d.mainPhoto === d.view) d.mainPhoto = 0;
  else if (d.mainPhoto > d.view) d.mainPhoto--;
  d.view = Math.max(0, d.view - 1);
  renderEditorPhoto();
  renderOcrLines();
}

// 같은 휴대폰 번호나 이메일을 가진 명함 찾기
function findDuplicate(fields, excludeId) {
  const mobile = digits(fields.mobile);
  const email = (fields.email || '').toLowerCase();
  if (!mobile && !email) return null;
  return store.cards().find(c => c.id !== excludeId && (
    (mobile && digits(c.mobile) === mobile) || (email && (c.email || '').toLowerCase() === email)
  )) || null;
}

async function saveDraft() {
  const d = draft;
  if (!d) return;
  document.querySelectorAll('[data-field]').forEach(el => (d.fields[el.dataset.field] = el.value.trim()));
  PHONE_KEYS.forEach(k => (d.fields[k] = formatPhone(d.fields[k])));
  if (!d.isMine) d.favorite = document.getElementById('draft-fav')?.checked || false;
  const f = d.fields;
  if (!FIELD_KEYS.some(k => f[k]) && !d.photos.length) return toast('내용을 입력하거나 사진을 추가해 주세요.', 'error');

  let targetId = d.id;
  let base = store.getCard(d.id);
  const dup = d.forId === 'new' && !d.isMine ? findDuplicate(f, d.id) : null;
  if (dup) {
    const choice = await dialog({
      title: '이미 등록된 명함이 있어요',
      message: `${dup.name || '(이름 없음)'}${dup.company ? ' · ' + dup.company : ''}\n같은 휴대폰 번호 또는 이메일입니다.`,
      buttons: [
        { label: '기존 명함에 덮어쓰기', value: 'overwrite', style: 'primary' },
        { label: '별도로 저장', value: 'new' },
        { label: '취소', value: null, style: 'ghost' },
      ],
    });
    if (!choice) return;
    if (choice === 'overwrite') {
      targetId = dup.id;
      base = dup;
    }
  }
  const merging = targetId !== d.id;

  const data = { id: targetId, isMine: d.isMine, favorite: d.favorite, ocrText: Object.values(d.ocrTexts).join('\n---\n') || d.baseOcrText };
  for (const k of FIELD_KEYS) data[k] = f[k] || (merging ? base[k] || '' : '');
  data.groupIds = merging ? [...new Set([...(base.groupIds || []), ...d.groupIds])] : d.groupIds;
  if (merging) data.favorite = d.favorite || base.favorite;

  // 사진: 바뀐 것만 기기에 저장, 지운 것은 Drive에서 정리
  const removed = [...d.removed];
  if (merging && d.photos.length) removed.push(...store.photosOf(base));
  if (!merging || d.photos.length) {
    for (const p of d.photos) if (p.changed) await idb.putImage(p.id, { blob: p.blob, fileId: null });
    data.photos = d.photos.map(p => ({ id: p.id, fileId: p.changed ? null : p.fileId }));
    data.mainPhoto = Math.min(d.mainPhoto, Math.max(0, d.photos.length - 1));
  }
  for (const r of removed) {
    store.addPendingDelete(r.fileId);
    await idb.deleteImage(r.id).catch(() => {});
  }

  store.saveCard(data);
  draft = null;
  toast('저장했습니다.');
  if (d.forId !== 'new' && !merging) back();
  else go(`#/card/${targetId}`, { replace: true });
}

async function cancelEdit() {
  const d = draft;
  const dirty = d && (d.photos.some(p => p.changed) || d.removed.length || d.touched.size ||
    [...document.querySelectorAll('[data-field]')].some(el => el.value.trim() !== (store.getCard(d.id)?.[el.dataset.field] || d.fields[el.dataset.field] || '')));
  if (dirty && !(await confirmDialog('작성 중인 내용을 버릴까요?', '', '버리기', true))) return;
  draft = null;
  back();
}

// ---------- 상세 ----------
let detailView = { id: null, index: 0 };

function renderDetail(id) {
  const c = store.getCard(id);
  if (!c) return go('#/', { replace: true });
  const photos = store.photosOf(c);
  const main = store.mainPhotoIndex(c);
  if (detailView.id !== id || detailView.index >= photos.length) detailView = { id, index: main };
  const tel = c.mobile || c.phone;
  const role = [c.department, c.title].filter(Boolean).join(' ');
  const row = (ic, label, value, actions = '') =>
    value ? `<div class="info-row">${icon(ic)}<div class="grow"><div class="label">${label}</div><div class="value">${esc(value)}</div></div><div class="row-actions">${actions}</div></div>` : '';
  const copyBtn = key => `<button class="icon-btn" data-action="copy-field" data-key="${key}" aria-label="복사">${icon('copy')}</button>`;
  const web = c.website && (/^https?:\/\//i.test(c.website) ? c.website : 'http://' + c.website);
  const groups = (c.groupIds || []).map(store.getGroup).filter(Boolean);

  $app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-action="back" aria-label="뒤로">${icon('back')}</button>
      <h1>${c.isMine ? '내 명함' : ''}</h1>
      ${c.isMine ? '' : `<button class="icon-btn ${c.favorite ? 'active' : ''}" data-action="toggle-fav" data-id="${c.id}" aria-label="즐겨찾기">${icon('star')}</button>`}
      <button class="icon-btn" data-action="edit" data-id="${c.id}" aria-label="편집">${icon('edit')}</button>
    </header>
    <main class="detail">
      ${photos.length ? `
        <div class="photo-box" id="detail-photo" data-action="view-photo">사진 불러오는 중…</div>
        ${photos.length > 1 ? `
          <div class="seg-row center">
            ${photos.map((_, i) => `<button class="seg ${i === detailView.index ? 'on' : ''}" data-action="detail-photo-tab" data-i="${i}">${sideLabel(i)}${i === main ? ' <span class="main-mark">★ 대표</span>' : ''}</button>`).join('')}
            ${detailView.index !== main ? `<button class="seg add" data-action="detail-photo-main" data-id="${c.id}">${icon('star')}대표로</button>` : ''}
          </div>` : ''}` : ''}
      <section class="detail-head">
        ${avatar(c, 'lg')}
        <h1>${esc(c.name || '(이름 없음)')}</h1>
        ${role ? `<p class="role">${esc(role)}</p>` : ''}
        ${c.company ? `<p class="company">${esc(c.company)}</p>` : ''}
      </section>
      ${c.isMine ? `<button class="btn primary block send-mine" data-action="share" data-id="${c.id}">${icon('share')}내 명함 보내기</button>` : `
      <section class="quick-actions">
        <a href="${tel ? 'tel:' + digits(tel) : '#'}" class="${tel ? '' : 'disabled'}">${icon('phone')}전화</a>
        <a href="${c.mobile ? 'sms:' + digits(c.mobile) : '#'}" class="${c.mobile ? '' : 'disabled'}">${icon('message')}문자</a>
        <a href="${c.email ? 'mailto:' + esc(c.email) : '#'}" class="${c.email ? '' : 'disabled'}">${icon('mail')}메일</a>
        <button data-action="share" data-id="${c.id}">${icon('share')}공유</button>
      </section>`}
      <section class="panel">
        ${row('phone', '휴대폰', c.mobile, `<a class="icon-btn" href="sms:${digits(c.mobile)}" aria-label="문자">${icon('message')}</a><a class="icon-btn" href="tel:${digits(c.mobile)}" aria-label="전화">${icon('phone')}</a>`)}
        ${row('phone', '전화', c.phone, `<a class="icon-btn" href="tel:${digits(c.phone)}" aria-label="전화">${icon('phone')}</a>`)}
        ${row('printer', '팩스', c.fax, copyBtn('fax'))}
        ${row('mail', '이메일', c.email, `<a class="icon-btn" href="mailto:${esc(c.email)}" aria-label="메일">${icon('mail')}</a>`)}
        ${row('mapPin', '주소', c.address, `${copyBtn('address')}<a class="icon-btn" href="https://map.naver.com/p/search/${encodeURIComponent(c.address)}" target="_blank" rel="noopener" aria-label="지도">${icon('mapPin')}</a>`)}
        ${row('globe', '홈페이지', c.website, `<a class="icon-btn" href="${esc(web)}" target="_blank" rel="noopener" aria-label="열기">${icon('globe')}</a>`)}
      </section>
      ${c.isMine ? '' : `
      <section class="panel">
        <p class="panel-title">그룹</p>
        <div class="chips wrap">
          ${groups.map(g => `<span class="chip"><span class="dot" style="--c:${g.color}"></span>${esc(g.name)}</span>`).join('')}
          <button class="chip dashed" data-action="pick-groups" data-id="${c.id}">${icon('edit')}${groups.length ? '변경' : '그룹 지정'}</button>
        </div>
      </section>`}
      ${c.memo ? `<section class="panel"><p class="panel-title">메모</p><p class="memo">${esc(c.memo)}</p></section>` : ''}
      <section class="detail-actions">
        ${isNative ? `<button class="btn primary" data-action="save-contact" data-id="${c.id}" style="grid-column:1/-1">${icon('contact')}휴대폰 주소록에 저장</button>` : ''}
        <button class="btn" data-action="share" data-id="${c.id}">${icon('share')}공유</button>
        <button class="btn" data-action="vcard" data-id="${c.id}">${icon('download')}연락처 파일</button>
        <button class="btn danger" data-action="delete-card" data-id="${c.id}" style="grid-column:1/-1">${icon('trash')}${c.isMine ? '내 명함 삭제' : '삭제'}</button>
      </section>
      <p class="meta">등록 ${fmtDate(c.createdAt)}${c.updatedAt && c.updatedAt !== c.createdAt ? ` · 수정 ${fmtDate(c.updatedAt)}` : ''}</p>
    </main>`;

  if (photos.length) showDetailPhoto(c);
}

function showDetailPhoto(card) {
  const photo = store.photosOf(card)[detailView.index];
  sync.loadPhoto(photo).then(blob => {
    const box = document.getElementById('detail-photo');
    if (!box || detailView.id !== card.id) return;
    if (blob) box.innerHTML = `<img src="${objectUrl(blob)}" alt="명함 ${sideLabel(detailView.index)}">`;
    else box.textContent = isLoggedIn() ? '사진을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.' : 'Google 계정으로 로그인하면 사진을 볼 수 있습니다.';
  }).catch(() => {
    const box = document.getElementById('detail-photo');
    if (box) box.textContent = '사진을 불러오지 못했습니다.';
  });
}

async function cardPhotoBlobs(card) {
  const photos = store.photosOf(card);
  const main = store.mainPhotoIndex(card);
  const ordered = [photos[main], ...photos.filter((_, i) => i !== main)].filter(Boolean);
  const blobs = await Promise.all(ordered.map(p => sync.loadPhoto(p).catch(() => null)));
  return blobs.filter(Boolean);
}

async function shareCard(id) {
  const c = store.getCard(id);
  if (!c) return;
  const photoCount = store.photosOf(c).length;
  const items = [
    { label: '텍스트로 공유', desc: '카카오톡, 문자 등으로 보내기', icon: 'share', value: 'text' },
    ...(photoCount ? [{ label: '명함 사진 + 정보 보내기', desc: photoCount > 1 ? '앞면·뒷면 사진과 텍스트를 함께' : '명함 사진과 텍스트를 함께', icon: 'image', value: 'photo' }] : []),
    { label: '텍스트 복사', icon: 'copy', value: 'copy' },
    { label: '연락처 파일(vCard)로 공유', desc: '받는 사람이 바로 주소록에 저장할 수 있어요', icon: 'contact', value: 'vcard' },
  ];
  const choice = await sheet({ title: c.isMine ? '내 명함 보내기' : '명함 공유', sub: buildShareText(c), items });
  if (choice === 'text') {
    const r = await shareCardText(c);
    if (r === 'copied') toast('공유 기능이 없어 클립보드에 복사했습니다.');
  } else if (choice === 'photo') {
    const blobs = await cardPhotoBlobs(c);
    if (!blobs.length) return toast('사진을 불러오지 못했습니다. Google Drive 연결을 확인해 주세요.', 'error');
    const r = await sharePhotos(c, blobs);
    if (r === 'downloaded') toast('이 기기에서는 사진 공유가 안 되어 사진을 내려받았습니다.');
  } else if (choice === 'copy') {
    await copyText(buildShareText(c));
    toast('복사했습니다.');
  } else if (choice === 'vcard') {
    const r = await shareVCard([c]);
    if (r === 'downloaded') toast('연락처 파일을 내려받았습니다.');
  }
}

// 앱: 휴대폰 주소록에 저장. 같은 번호의 연락처가 있으면 덮어쓸지 묻습니다.
async function saveToContacts(id) {
  const c = store.getCard(id);
  if (!c) return;
  if (!c.name && !c.company) return toast('이름이나 회사명이 있어야 주소록에 저장할 수 있습니다.', 'error');
  try {
    let contactId = null;
    const phones = [c.mobile, c.phone].filter(Boolean);
    if (phones.length) {
      const { matches = [] } = await Native.findContact({ phones });
      if (matches.length) {
        const m = matches[0];
        const more = matches.length > 1 ? `\n(같은 번호 연락처가 ${matches.length}개 있습니다. 첫 번째 연락처를 덮어씁니다.)` : '';
        const photoNote = getUsePhoto() && store.photosOf(c).length ? ' 연락처 사진도 명함 대표 사진으로 바뀝니다.' : '';
        const choice = await dialog({
          title: '주소록에 이미 있는 번호예요',
          message: `${m.name || '(이름 없음)'} · ${m.phone}${more}\n\n덮어쓰면 "${contactDisplayName(c)}"(으)로 저장되고 회사·직책·이메일·주소가 명함 내용으로 바뀝니다.${photoNote} 다른 전화번호는 그대로 남습니다.`,
          buttons: [
            { label: '덮어쓰기', value: 'overwrite', style: 'primary' },
            { label: '새 연락처로 저장', value: 'new' },
            { label: '취소', value: null, style: 'ghost' },
          ],
        });
        if (!choice) return;
        if (choice === 'overwrite') contactId = m.contactId;
      }
    }
    const fields = {};
    FIELD_KEYS.forEach(k => (fields[k] = c[k] || ''));
    const displayName = contactDisplayName(c);
    const photoBase64 = getUsePhoto() ? await contactPhotoBase64(c) : null;
    await Native.saveContact({ ...fields, displayName, contactId, ...(photoBase64 ? { photoBase64 } : {}) });
    toast(`"${displayName}"(으)로 ${contactId ? '주소록 연락처를 덮어썼습니다.' : '주소록에 저장했습니다.'}`);
  } catch (e) {
    toast(e.message || '주소록에 저장하지 못했습니다.', 'error');
  }
}

// 연락처 사진: 명함 대표 사진을 정사각형(여백은 흰색)으로 맞춰 잘리지 않게 합니다.
async function contactPhotoBase64(card) {
  const photo = store.photosOf(card)[store.mainPhotoIndex(card)];
  const blob = photo && (await sync.loadPhoto(photo).catch(() => null));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const size = 720;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pickGroups(id) {
  const c = store.getCard(id);
  if (!c) return;
  const groups = store.groups();
  if (!groups.length) {
    const name = await promptDialog('새 그룹 만들기', '', '예: 거래처, 협력사, 지인');
    if (!name) return;
    const g = store.addGroup(name);
    store.patchCard(id, { groupIds: [g.id] });
    return;
  }
  const selected = new Set(c.groupIds || []);
  const el = openOverlay(`
    <div class="sheet">
      <p class="sheet-title">그룹 지정 (여러 개 선택 가능)</p>
      <div id="pick-list"></div>
      <div style="display:flex;gap:8px;padding:8px 6px 0">
        <button class="btn ghost" data-act="new" style="flex:1">${icon('plus')}새 그룹</button>
        <button class="btn primary" data-act="done" style="flex:1">완료</button>
      </div>
    </div>`);
  const draw = () => {
    el.querySelector('#pick-list').innerHTML = store.groups().map(g => `
      <button class="sheet-item" data-g="${g.id}">
        <span class="dot" style="width:12px;height:12px;border-radius:50%;background:${g.color}"></span>
        <span style="flex:1">${esc(g.name)}</span>${selected.has(g.id) ? icon('check') : ''}
      </button>`).join('');
  };
  draw();
  el.addEventListener('click', async e => {
    const g = e.target.closest('[data-g]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (g) {
      const gid = g.dataset.g;
      selected.has(gid) ? selected.delete(gid) : selected.add(gid);
      draw();
    } else if (act === 'new') {
      const name = await promptDialog('새 그룹 만들기', '', '예: 거래처, 협력사, 지인');
      if (name) {
        selected.add(store.addGroup(name).id);
        draw();
      }
    } else if (act === 'done' || e.target === el) {
      el.remove();
      store.patchCard(id, { groupIds: [...selected] });
    }
  });
}

async function deleteCard(id) {
  const c = store.getCard(id);
  if (!c) return;
  const photos = store.photosOf(c);
  const title = c.isMine ? '내 명함을 삭제할까요?' : '명함을 삭제할까요?';
  if (!(await confirmDialog(title, `${c.name || '(이름 없음)'} 명함이 삭제됩니다.${photos.some(p => p.fileId) ? '\n사진은 Google Drive 휴지통으로 이동합니다.' : ''}`, '삭제', true))) return;
  store.deleteCard(id);
  for (const p of photos) await idb.deleteImage(p.id).catch(() => {});
  toast('삭제했습니다.');
  go('#/', { replace: true });
}

// ---------- 내 명함 ----------
function renderMyCard() {
  const mine = store.getMyCard();
  if (mine) return go(`#/card/${mine.id}`, { replace: true });
  const meta = store.getSyncMeta();
  $app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-action="back" aria-label="뒤로">${icon('back')}</button>
      <h1>내 명함</h1>
    </header>
    <main class="page">
      <div class="empty">
        ${icon('contact')}
        <h2>내 명함을 등록하세요</h2>
        <p>한 번 등록해 두면 카카오톡, 문자로 바로 보낼 수 있어요.<br>앞면과 뒷면을 모두 찍어 둘 수도 있습니다.</p>
        <div class="stack">
          ${PHOTO_SOURCES.map((s, i) => `<button class="btn ${i ? '' : 'primary'} block" data-action="mine-add" data-src="${s.value}">${icon(s.icon)}${esc(s.label)}</button>`).join('')}
          <button class="btn ghost block" data-action="mine-add" data-src="manual">${icon('edit')}직접 입력</button>
        </div>
        <p class="small-note">${meta.email ? `${esc(meta.email)} 계정의 Google Drive에 함께 저장됩니다.` : 'Google 계정으로 로그인하면 다른 기기에서도 내 명함을 쓸 수 있습니다.'}</p>
      </div>
    </main>`;
}

// ---------- 그룹 관리 ----------
function renderGroups() {
  const all = store.cards();
  const groups = store.groups();
  $app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-action="back" aria-label="뒤로">${icon('back')}</button>
      <h1>그룹 관리</h1>
      <button class="text-btn" data-action="add-group">${icon('plus')}</button>
    </header>
    <main class="page">
      ${groups.length ? `
        <section class="panel">
          ${groups.map(g => {
            const n = all.filter(c => c.groupIds?.includes(g.id)).length;
            return `
              <div class="group-row">
                <button class="swatch" style="--c:${g.color}" data-action="group-color" data-id="${g.id}" aria-label="색상 변경"></button>
                <div class="grow" data-action="group-open" data-id="${g.id}" style="cursor:pointer">
                  <div class="name">${esc(g.name)}</div><div class="count">${n}명</div>
                </div>
                <button class="icon-btn" data-action="group-menu" data-id="${g.id}" aria-label="더보기">${icon('settings')}</button>
              </div>`;
          }).join('')}
        </section>
        <p class="small-note" style="padding:0 4px">색상 동그라미를 누르면 색이 바뀝니다. 그룹을 삭제해도 명함은 지워지지 않습니다.</p>` : `
        <div class="empty">${icon('users')}<h2>그룹이 없습니다</h2><p>거래처, 협력사, 지인처럼 명함을 묶어서 관리해 보세요.</p></div>`}
      <button class="btn primary block" data-action="add-group" style="margin-top:12px">${icon('plus')}새 그룹 만들기</button>
    </main>`;
}

async function addGroupFlow() {
  const name = await promptDialog('새 그룹 만들기', '', '예: 거래처, 협력사, 지인');
  if (!name) return null;
  if (store.groups().some(g => g.name === name)) {
    toast('같은 이름의 그룹이 있습니다.', 'error');
    return null;
  }
  return store.addGroup(name);
}

async function groupMenu(id) {
  const g = store.getGroup(id);
  if (!g) return;
  const members = store.cards().filter(c => c.groupIds?.includes(id));
  const choice = await sheet({
    title: g.name,
    items: [
      { label: '이름 변경', icon: 'edit', value: 'rename' },
      { label: `연락처 파일로 내보내기 (${members.length}명)`, icon: 'download', value: 'vcard' },
      { label: '그룹 삭제', icon: 'trash', value: 'delete', danger: true },
    ],
  });
  if (choice === 'rename') {
    const name = await promptDialog('그룹 이름 변경', g.name);
    if (name) store.updateGroup(id, { name });
  } else if (choice === 'vcard') {
    if (!members.length) return toast('그룹에 명함이 없습니다.');
    await shareVCard(members, `명함_${g.name}`);
  } else if (choice === 'delete') {
    if (await confirmDialog(`'${g.name}' 그룹을 삭제할까요?`, '그룹 안의 명함은 삭제되지 않습니다.', '삭제', true)) store.deleteGroup(id);
  }
}

// ---------- 설정 ----------
function driveStatusHtml() {
  const s = store.getSettings();
  const meta = store.getSyncMeta();
  const st = sync.getStatus();
  if (!isNative && !s.googleClientId) {
    return `<p>Google OAuth 클라이언트 ID를 아래 '고급 설정'에 입력해야 로그인할 수 있습니다. 로그인 전까지는 이 기기에만 저장됩니다.</p>`;
  }
  if (!isLoggedIn()) {
    return `<div class="status-line bad">${icon('user')}로그인하지 않음</div>
      <p>Google 계정으로 로그인하면 명함과 사진이 내 Google Drive의 '${esc(s.driveFolderName)}' 폴더에 저장되고, 다른 기기와 자동으로 맞춰집니다.</p>
      <button class="btn google-btn block" data-action="login">${GOOGLE_G}Google 계정으로 로그인</button>`;
  }
  const label = { local: '로그인 필요', auth: '로그인 만료 — 다시 로그인해 주세요', syncing: '동기화 중…', synced: 'Drive와 동기화됨', offline: '오프라인 (연결되면 동기화)', error: '동기화 오류' }[st.state];
  const ok = st.state === 'synced' || st.state === 'syncing';
  return `<div class="account-row">${icon('user')}<div><strong>${esc(meta.displayName || '')}</strong><small>${esc(meta.email)}</small></div></div>
    <div class="status-line ${ok ? 'ok' : 'bad'}">${icon(ok ? 'cloudCheck' : 'alert')}${label}</div>
    <p>마지막 동기화: ${st.lastSync ? timeAgo(st.lastSync) : '-'}</p>
    ${st.state === 'error' ? `<p style="color:var(--danger)">${esc(st.message)}</p>` : ''}
    ${st.state === 'auth' || st.state === 'local'
      ? `<button class="btn primary block" data-action="login">${icon('user')}다시 로그인</button>`
      : `<button class="btn block" data-action="sync-now">${icon('refresh')}지금 동기화</button>`}
    <button class="btn ghost block" data-action="logout">${icon('logout')}로그아웃</button>
    ${isNative ? '' : '<p class="small-note">웹 버전은 보안상 약 1시간마다 로그인 확인이 필요합니다. 계속 로그인된 상태로 쓰려면 안드로이드 앱을 이용하세요.</p>'}`;
}

// ---------- 설정 (탭: 계정 / 주소록 / 인식 / 데이터) ----------
const SETTINGS_TABS = [['account', '계정'], ['contacts', '주소록'], ['ocr', '인식'], ['data', '데이터']];

function renderSettings() {
  let tab = route().id || 'account';
  if (!SETTINGS_TABS.some(([k]) => k === tab)) tab = 'account';
  const s = store.getSettings();
  const body = { account: settingsAccount, contacts: settingsContacts, ocr: settingsOcr, data: settingsData }[tab](s);
  $app.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-action="back" aria-label="뒤로">${icon('back')}</button>
      <h1>설정</h1>
    </header>
    <nav class="settings-tabs">
      ${SETTINGS_TABS.map(([k, label]) => `<button class="seg ${k === tab ? 'on' : ''}" data-action="settings-tab" data-id="${k}">${label}</button>`).join('')}
    </nav>
    <main class="page">
      ${body}
      <p class="meta">카들리 (Cardly) v${APP_VERSION}${isNative ? ' · 앱' : ''}</p>
    </main>`;
}

function settingsAccount(s) {
  return `
      <h2 class="section-title">Google 계정</h2>
      <section class="panel"><div class="panel-body" id="drive-status">${driveStatusHtml()}</div></section>

      <h2 class="section-title">내 명함</h2>
      <section class="panel"><div class="panel-body">
        <p>${store.getMyCard() ? `${esc(store.getMyCard().name || '(이름 없음)')} 명함이 등록되어 있습니다.` : '아직 등록하지 않았습니다.'}</p>
        <button class="btn block" data-action="nav" data-to="#/me">${icon('contact')}${store.getMyCard() ? '내 명함 보기' : '내 명함 등록'}</button>
      </div></section>

      ${isNative ? '' : `<h2 class="section-title">고급 설정</h2>
      <section class="panel">
        <div class="panel-body">
          <label class="field"><span>Google OAuth 클라이언트 ID</span><input id="client-id" value="${esc(s.googleClientId)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off"></label>
          <button class="btn block" data-action="save-advanced">저장</button>
        </div>
        <details class="help">
          <summary>클라이언트 ID 만드는 방법</summary>
          <ol>
            <li><a href="https://console.cloud.google.com/" target="_blank" rel="noopener"><u>Google Cloud Console</u></a>에서 프로젝트를 만듭니다.</li>
            <li>'API 및 서비스 → 라이브러리'에서 <b>Google Drive API</b>를 사용 설정합니다.</li>
            <li>'OAuth 동의 화면'을 외부(External)로 만들고, 테스트 사용자에 본인과 지인 Gmail을 추가합니다.</li>
            <li>'사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션'을 만들고, 승인된 JavaScript 원본에 <code>${esc(location.origin)}</code> 를 추가합니다.</li>
            <li>만들어진 클라이언트 ID를 위 칸에 붙여 넣습니다.</li>
          </ol>
        </details>
      </section>`}`;
}

// 주소록 이름 규칙 미리보기용: 내 명함이 있으면 내 명함, 없으면 예시
const SAMPLE_CARD = { company: '(주)창조이엔지', department: '영업팀', name: '홍길동', title: '부장' };

function settingsContacts() {
  const parts = rules.getNameFormat();
  const sample = store.getMyCard() || SAMPLE_CARD;
  const unused = rules.NAME_PARTS.filter(p => !parts.includes(p.key));
  const same = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
  return `
      <h2 class="section-title">주소록 이름 규칙</h2>
      <section class="panel"><div class="panel-body">
        <p>명함을 휴대폰 주소록(또는 연락처 파일)에 저장할 때 이름을 이렇게 만듭니다.</p>
        <div class="name-preview"><small>미리보기</small><strong>${esc(rules.contactDisplayName(sample, parts))}</strong></div>
        <div class="fmt-list">
          ${parts.map((k, i) => `
            <div class="fmt-row">
              <span class="fmt-no">${i + 1}</span>
              <span class="fmt-label">${rules.partLabel(k)}</span>
              <button class="icon-btn" data-action="fmt-move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="앞으로">${icon('chevronUp')}</button>
              <button class="icon-btn" data-action="fmt-move" data-i="${i}" data-dir="1" ${i === parts.length - 1 ? 'disabled' : ''} aria-label="뒤로">${icon('chevronDown')}</button>
              <button class="icon-btn" data-action="fmt-remove" data-i="${i}" ${parts.length === 1 ? 'disabled' : ''} aria-label="빼기">${icon('x')}</button>
            </div>`).join('')}
        </div>
        ${unused.length ? `<div class="chips wrap">${unused.map(p => `<button class="chip dashed" data-action="fmt-add" data-id="${p.key}">${icon('plus')}${p.label}</button>`).join('')}</div>` : ''}
        <p class="small-note" style="margin-top:14px">빠른 선택</p>
        <div class="chips wrap">
          ${rules.NAME_PRESETS.map((p, i) => `<button class="chip ${same(p, parts) ? 'on' : ''}" data-action="fmt-preset" data-i="${i}">${p.map(rules.partLabel).join(' ')}</button>`).join('')}
        </div>
      </div>
      <label class="radio-row"><input type="checkbox" id="strip-corp" ${rules.getStripCorp() ? 'checked' : ''}>
        <span>회사명에서 (주)·주식회사 빼기<small>예: "(주)창조이엔지" → "창조이엔지"</small></span></label>
      </section>

      <h2 class="section-title">주소록 사진</h2>
      <section class="panel">
        <label class="radio-row"><input type="checkbox" id="contact-photo" ${rules.getUsePhoto() ? 'checked' : ''} ${isNative ? '' : 'disabled'}>
          <span>명함 대표 사진을 연락처 사진으로 넣기<small>${isNative ? '새로 저장할 때와 기존 연락처를 덮어쓸 때 모두 적용됩니다.' : '안드로이드 앱에서 주소록에 저장할 때 적용됩니다.'}</small></span></label>
      </section>
      <p class="small-note" style="padding:0 4px">주소록 설정은 내 Google 계정에 저장되어 다른 기기에도 똑같이 적용됩니다.</p>`;
}

function settingsOcr(s) {
  return `
      ${isNative ? '' : `<h2 class="section-title">명함 테두리 맞추기</h2>
      <section class="panel">
        <label class="radio-row"><input type="radio" name="crop" value="auto" ${s.cropScreen !== 'off' ? 'checked' : ''}>
          <span>자동<small>촬영한 사진에서 테두리를 확실히 찾았을 때만 맞추기 화면을 보여 줍니다. 이미 잘린 사진은 그대로 씁니다.</small></span></label>
        <label class="radio-row"><input type="radio" name="crop" value="off" ${s.cropScreen === 'off' ? 'checked' : ''}>
          <span>끄기<small>항상 원본 그대로 씁니다. 필요할 때 편집 화면의 [자르기]로 맞추세요.</small></span></label>
        <details class="help">
          <summary>갤럭시 카메라로 명함 스캔하는 방법</summary>
          <ol>
            <li>처음 한 번: <b>카메라</b> 앱 → ⚙ 설정 → <b>지능형 기능</b> → <b>문서 및 텍스트 스캔</b>을 켭니다. (이전 버전은 <b>장면별 최적 촬영 → 문서 스캔</b>)</li>
            <li>사진 모드에서 명함을 화면에 크게(10~20cm) 비춥니다. 어두운 바닥 위에 두면 더 잘 잡힙니다.</li>
            <li>노란 테두리와 <b>스캔</b> 버튼이 나타나면 누릅니다. 반듯하게 잘린 이미지가 갤러리에 저장됩니다.</li>
            <li>카들리에서 <b>명함 추가 → 갤럭시 카메라로 스캔한 사진</b>을 고르면 자르기 없이 바로 인식합니다.</li>
          </ol>
        </details>
      </section>`}

      <h2 class="section-title">글자 인식(OCR) 방식</h2>
      <section class="panel">
        ${isNative ? `<label class="radio-row"><input type="radio" name="ocr" value="mlkit" ${s.ocrEngine === 'mlkit' ? 'checked' : ''}>
          <span>휴대폰 내장 인식 (추천)<small>Google ML Kit 한국어 인식. 무료이고 인터넷 없이도 휴대폰 안에서 처리합니다.</small></span></label>` : ''}
        <label class="radio-row"><input type="radio" name="ocr" value="tesseract" ${s.ocrEngine === 'tesseract' ? 'checked' : ''}>
          <span>기본 (무료, 기기 안에서 처리)<small>처음 한 번 한국어 인식 데이터(약 10MB)를 내려받습니다. 정확도는 보통입니다.</small></span></label>
        <label class="radio-row"><input type="radio" name="ocr" value="vision" ${s.ocrEngine === 'vision' ? 'checked' : ''}>
          <span>Google Cloud Vision (정확도 높음)<small>월 1,000건까지 무료. 키를 한 번 입력하면 내 Google Drive에 저장되어 다른 기기에도 자동 적용됩니다.</small></span></label>
        <div class="panel-body" style="padding-top:4px">
          <label class="field"><span>Vision API 키</span><input id="vision-key" type="password" value="${esc(store.getSettings().visionApiKey)}" placeholder="AIza…" autocomplete="off"></label>
        </div>
      </section>`;
}

function settingsData() {
  return `
      <h2 class="section-title">데이터</h2>
      <section class="panel"><div class="panel-body">
        <p>전체 ${store.cards().length}개 명함 · ${store.groups().length}개 그룹</p>
        <button class="btn block" data-action="export-vcard">${icon('contact')}전체 연락처 파일(vCard) 내보내기</button>
        <button class="btn block" data-action="export-json">${icon('download')}백업 파일 내보내기 (JSON)</button>
        <button class="btn block" data-action="import-json">${icon('upload')}백업 파일 불러오기</button>
        ${isLoggedIn() ? '' : `<button class="btn danger block" data-action="reset-local">${icon('trash')}이 기기의 데이터 지우기</button>`}
        <p class="small-note">연락처 파일(.vcf)을 갤럭시에서 열면 주소록에 한꺼번에 저장할 수 있습니다. 이름은 [주소록] 탭의 규칙대로 들어갑니다.</p>
      </div></section>`;
}

async function exportJson() {
  const blob = new Blob([JSON.stringify(store.snapshot(), null, 2)], { type: 'application/json' });
  downloadBlob(blob, `카들리_백업_${new Date().toISOString().slice(0, 10)}.json`);
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.cards)) throw new Error('카들리 백업 파일이 아닙니다.');
    store.merge(data, 'local');
    toast(`백업을 불러왔습니다. (명함 ${data.cards.filter(c => !c.deleted).length}개)`);
    render();
  } catch (e) {
    toast('불러오기 실패: ' + e.message, 'error');
  }
}

// ---------- 이벤트 ----------
document.addEventListener('click', async e => {
  if (e.target.closest('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"], a[target="_blank"]')) return;
  const el = e.target.closest('[data-action]');
  if (!el || el.closest('.overlay')) return;
  const { action, id } = el.dataset;
  switch (action) {
    case 'nav': return go(el.dataset.to);
    case 'back': return back();
    case 'open': return go(`#/card/${id}`);
    case 'add': return addCard();
    case 'capture': return pickPhoto(PHOTO_SOURCES[0].value, { mode: 'new' });
    case 'mine-add':
      if (el.dataset.src === 'manual') {
        draft = newDraft(null, { mine: true });
        return go('#/new');
      }
      return pickPhoto(el.dataset.src, { mode: 'new', mine: true });
    case 'filter':
      ui.filter = id;
      store.setUiPrefs({ filter: id });
      document.querySelectorAll('[data-action="filter"]').forEach(b => b.classList.toggle('on', b.dataset.id === id));
      return renderListItems();
    case 'add-group-quick': {
      const g = await addGroupFlow();
      if (g) {
        ui.filter = g.id;
        renderList();
      }
      return;
    }
    case 'sync-click': return onSyncClick();

    // 편집 — 사진
    case 'cancel-edit': return cancelEdit();
    case 'save-card': return saveDraft();
    case 'photo-add': return pickPhoto(el.dataset.src, { mode: 'add' });
    case 'photo-add-back':
    case 'photo-replace': {
      const src = await sheet({ title: action === 'photo-replace' ? '사진 바꾸기' : '뒷면 사진 추가', items: PHOTO_SOURCES });
      return src && pickPhoto(src, { mode: action === 'photo-replace' ? 'replace' : 'add' });
    }
    case 'photo-tab':
      draft.view = +el.dataset.i;
      renderEditorPhoto();
      return renderOcrLines();
    case 'photo-main':
      draft.mainPhoto = draft.view;
      toast(`${sideLabel(draft.view)}을 대표 사진으로 정했습니다.`);
      return renderEditorPhoto();
    case 'rotate':
    case 'crop': {
      const d = draft;
      const p = d?.photos[d.view];
      if (!p?.blob) return;
      const blob = action === 'rotate' ? await normalizeImage(p.blob, { rotate: 90 }) : await cropDialog(p.blob);
      if (!blob || blob === p.blob || draft !== d) return;
      replaceDraftPhoto(p, blob);
      renderEditorPhoto();
      return runOcr(p.id);
    }
    case 'rerun-ocr': {
      const p = draft?.photos[draft.view];
      return p && runOcr(p.id);
    }
    case 'remove-photo': return removeDraftPhoto();
    case 'view-draft-photo': {
      const p = draft?.photos[draft.view];
      return p?.blob && viewImage(objectUrl(p.blob));
    }
    case 'assign-line': return assignLine(+el.dataset.i);
    case 'toggle-draft-group': {
      const i = draft.groupIds.indexOf(id);
      i >= 0 ? draft.groupIds.splice(i, 1) : draft.groupIds.push(id);
      return renderDraftGroups();
    }
    case 'new-group-in-draft': {
      const g = await addGroupFlow();
      if (g) {
        draft.groupIds.push(g.id);
        renderDraftGroups();
      }
      return;
    }

    // 상세
    case 'edit': return go(`#/edit/${id}`);
    case 'toggle-fav': {
      const c = store.getCard(id);
      return c && store.patchCard(id, { favorite: !c.favorite });
    }
    case 'detail-photo-tab': {
      detailView.index = +el.dataset.i;
      return renderDetail(route().id);
    }
    case 'detail-photo-main':
      store.patchCard(id, { mainPhoto: detailView.index });
      return toast(`${sideLabel(detailView.index)}을 대표 사진으로 정했습니다.`);
    case 'share': return shareCard(id);
    case 'save-contact': return saveToContacts(id);
    case 'vcard': {
      const r = await shareVCard([store.getCard(id)]);
      if (r === 'downloaded') toast('연락처 파일을 내려받았습니다. 열면 주소록에 저장할 수 있어요.');
      return;
    }
    case 'copy-field': {
      const c = store.getCard(route().id);
      await copyText(c?.[el.dataset.key] || '');
      return toast(`${fieldLabel(el.dataset.key)}을(를) 복사했습니다.`);
    }
    case 'view-photo': {
      const img = el.querySelector('img');
      return img && viewImage(img.src);
    }
    case 'pick-groups': return pickGroups(id);
    case 'delete-card': return deleteCard(id);

    // 그룹
    case 'add-group': return addGroupFlow();
    case 'group-open':
      ui.filter = id;
      store.setUiPrefs({ filter: id });
      return go('#/');
    case 'group-color': {
      const g = store.getGroup(id);
      const colors = store.GROUP_COLORS;
      return store.updateGroup(id, { color: colors[(colors.indexOf(g.color) + 1) % colors.length] });
    }
    case 'group-menu': return groupMenu(id);

    // 설정
    case 'settings-tab': return go(`#/settings/${id}`, { replace: true });
    case 'fmt-move':
    case 'fmt-remove':
    case 'fmt-add':
    case 'fmt-preset': {
      let parts = [...rules.getNameFormat()];
      const i = +el.dataset.i;
      if (action === 'fmt-move') {
        const j = i + +el.dataset.dir;
        [parts[i], parts[j]] = [parts[j], parts[i]];
      } else if (action === 'fmt-remove') parts.splice(i, 1);
      else if (action === 'fmt-add') parts.push(id);
      else parts = [...rules.NAME_PRESETS[i]];
      rules.setNameFormat(parts);
      const y = window.scrollY;
      renderSettings();
      return window.scrollTo(0, y);
    }
    case 'login': return loginGoogle();
    case 'sync-now': return sync.syncNow();
    case 'logout': return logout();
    case 'save-advanced': {
      const clientId = document.getElementById('client-id').value.trim();
      store.setSettings({ googleClientId: clientId });
      if (clientId) drive.prepare(clientId).catch(() => {});
      toast('저장했습니다.');
      return renderSettings();
    }
    case 'export-vcard': {
      const list = store.cards();
      if (!list.length) return toast('내보낼 명함이 없습니다.');
      return shareVCard(list, `카들리_전체_${list.length}명`);
    }
    case 'export-json': return exportJson();
    case 'import-json': return document.getElementById('file-import').click();
    case 'reset-local':
      if (await confirmDialog('이 기기의 데이터를 지울까요?', 'Google Drive에 저장된 데이터는 지워지지 않으며, 다시 연결하면 불러옵니다.\nDrive에 연결하지 않았다면 복구할 수 없습니다.', '지우기', true)) {
        store.resetAll();
        store.clearSyncMeta();
        await idb.clearImages();
        sync.disconnect();
        toast('이 기기의 데이터를 지웠습니다.');
        go('#/', { replace: true });
      }
      return;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'search') {
    ui.query = t.value;
    return renderListItems();
  }
  if (t.dataset.field && draft) {
    // 전화번호 칸: 숫자만 받고 하이픈은 규칙에 맞춰 자동으로
    if (PHONE_KEYS.includes(t.dataset.field)) {
      const v = hyphenatePhone(t.value);
      if (v !== t.value) t.value = v;
    }
    draft.fields[t.dataset.field] = t.value;
    draft.touched.add(t.dataset.field);
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'sort') {
    ui.sort = t.value;
    store.setUiPrefs({ sort: t.value });
    renderListItems();
  } else if (t.id === 'strip-corp') {
    rules.setStripCorp(t.checked);
    const y = window.scrollY;
    renderSettings();
    window.scrollTo(0, y);
  } else if (t.id === 'contact-photo') {
    rules.setUsePhoto(t.checked);
    toast(t.checked ? '주소록에 저장할 때 명함 사진을 넣습니다.' : '주소록에 저장할 때 사진은 넣지 않습니다.');
  } else if (t.name === 'crop') {
    store.setSettings({ cropScreen: t.value });
  } else if (t.name === 'ocr') {
    store.setSettings({ ocrEngine: t.value });
    if (t.value === 'vision' && !store.getSettings().visionApiKey) toast('Vision API 키를 입력해 주세요.');
  } else if (t.id === 'vision-key') {
    store.setSettings({ visionApiKey: '' });
    store.setPref('visionApiKey', t.value.trim());
    toast(t.value.trim() ? 'API 키를 저장했습니다. Drive에 연결된 다른 기기에도 적용됩니다.' : 'API 키를 지웠습니다.');
  } else if (t.id === 'draft-fav' && draft) {
    draft.favorite = t.checked;
  }
});

for (const id of ['file-camera', 'file-gallery']) {
  document.getElementById(id).addEventListener('change', e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    onImagePicked(file);
  });
}
document.getElementById('file-import').addEventListener('change', e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) importJson(file);
});

// ---------- 시작 ----------
window.addEventListener('hashchange', onHashChange);
window.addEventListener('online', () => sync.scheduleSync(500));

store.subscribe(source => {
  if (source !== 'sync') sync.scheduleSync();
  if (needsLogin()) return;
  const { view } = route();
  if (view === 'list') {
    const y = window.scrollY;
    renderList();
    window.scrollTo(0, y);
  } else if (view === 'card' || view === 'groups') {
    const y = window.scrollY;
    if (view === 'card') renderDetail(route().id);
    else renderGroups();
    window.scrollTo(0, y);
  } else if (view === 'edit' || view === 'new') renderDraftGroups();
});
sync.onStatus(updateSyncBadge);

// 업데이트로 로그인 방식이 바뀐 경우에만 자동 로그아웃 (명함 데이터는 남김 → 다시 로그인하면 Drive와 합쳐짐)
const bootMeta = store.getSyncMeta();
if (bootMeta.email && (bootMeta.authVersion ?? 1) !== AUTH_VERSION) {
  sync.disconnect();
  setTimeout(() => toast('앱이 업데이트되어 다시 로그인이 필요합니다.'), 300);
}

// ---------- 안드로이드 뒤로가기 ----------
// 열린 창 닫기 → 편집 중이면 취소 확인 → 이전 화면 → 첫 화면에서는 종료 확인
async function onBackButton() {
  const top = $overlay.lastElementChild;
  if (top) {
    const cancel = top.querySelector('[data-c="cancel"]');
    if (cancel) cancel.click();
    else top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return;
  }
  if (needsLogin()) return confirmExit();
  const { view } = route();
  if (view === 'new' || view === 'edit') return cancelEdit();
  if (view !== 'list') return back();
  if (ui.query) {
    ui.query = '';
    return renderList();
  }
  if (ui.filter !== 'all') {
    ui.filter = 'all';
    store.setUiPrefs({ filter: 'all' });
    return renderList();
  }
  return confirmExit();
}

async function confirmExit() {
  if (await confirmDialog('카들리를 종료할까요?', '', '종료')) App.exitApp();
}

if (isNative) App.addListener('backButton', onBackButton);

render();
sync.refreshStatus();
const startSettings = store.getSettings();
if (startSettings.googleClientId) drive.prepare(startSettings.googleClientId).catch(() => {});
if (drive.hasValidToken() || (isNative && store.getSyncMeta().email)) sync.syncNow();
// 앱은 다시 열 때마다(백그라운드 → 앞) 동기화
if (isNative) document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync.scheduleSync(300));

if (!isNative && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

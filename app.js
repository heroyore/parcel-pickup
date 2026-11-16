'use strict';

/* ============================ constants ============================ */

const DATA_KEY = 'parcel-pickup-items-v1';
const CONFIG_KEY = 'parcel-pickup-config-v1';
const BASE = new URL('.', location.href).href;

const DEFAULT_LOCATION_KEYS = [
  '菜鸟驿站', '驿站', '丰巢', '快递柜', '取件点', '自提点', '代收点', '智能柜',
  '门口', '前台', '保安室', '门卫', '货架', '货位', '柜', '号楼', '栋', '单元',
  '校区', '宿舍', '小区', '便利店', '超市', '取件', '快递'
].join('\n');

const CARRIERS = [
  '菜鸟驿站', '丰巢', '中通', '圆通', '韵达', '申通', '极兔', '京东',
  '顺丰', '邮政', 'EMS', '德邦', '百世', '丹鸟', '菜鸟', '闪送'
];

const DEFAULT_CONFIG = {
  locationKeys: DEFAULT_LOCATION_KEYS,
  codeRegex: '',
  scale: '1.5',
  saveThumb: true
};

/* ============================ dom ============================ */

const $ = (id) => document.getElementById(id);
const el = {
  tabImport: $('tab-import'), tabList: $('tab-list'),
  panelImport: $('panel-import'), panelList: $('panel-list'),
  dropZone: $('drop-zone'), fileInput: $('file-input'), btnChoose: $('btn-choose'),
  btnRecognize: $('btn-recognize'), btnAddAll: $('btn-add-all'), btnManual: $('btn-manual'),
  btnEmptyAdd: $('btn-empty-add'),
  progressWrap: $('progress-wrap'), progressBar: $('progress-bar'), progressText: $('progress-text'),
  queueHead: $('queue-head'), queueCount: $('queue-count'), queue: $('queue'), importEmpty: $('import-empty'),
  groupList: $('group-list'), listEmpty: $('list-empty'),
  pickedWrap: $('picked-wrap'), pickedCount: $('picked-count'), pickedList: $('picked-list'),
  statPending: $('stat-pending'), statPicked: $('stat-picked'), tabCount: $('tab-count'),
  btnCopyAll: $('btn-copy-all'), btnExport: $('btn-export'), btnClearPicked: $('btn-clear-picked'),
  manualDialog: $('manual-dialog'), manualForm: $('manual-form'), manualTitle: $('manual-title'),
  fieldId: $('field-id'), fieldLocation: $('field-location'), fieldCabinet: $('field-cabinet'),
  fieldCode: $('field-code'), fieldCarrier: $('field-carrier'), fieldNote: $('field-note'),
  settingsDialog: $('settings-dialog'), cfgLocationKeys: $('cfg-location-keys'),
  cfgCodeRegex: $('cfg-code-regex'), cfgScale: $('cfg-scale'), cfgThumb: $('cfg-thumb'),
  btnSettings: $('btn-settings'), btnSaveSettings: $('btn-save-settings'),
  btnExportJson: $('btn-export-json'), btnImportJson: $('btn-import-json'), jsonFile: $('json-file'),
  btnClearAll: $('btn-clear-all'),
  exportDialog: $('export-dialog'), btnExportText: $('btn-export-text'),
  btnExportCsv: $('btn-export-csv'), btnDownloadJson: $('btn-download-json'),
  toast: $('toast')
};

/* ============================ state ============================ */

const state = { items: [], queue: [] };
let cfg = loadConfig();
let editingId = null;
let toastTimer = null;
let workerPromise = null;

/* ============================ utils ============================ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2800);
}

function loadConfig() {
  try {
    return Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'));
  } catch (e) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function save() {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify({ items: state.items }));
  } catch (e) {
    toast('本地存储已满。请导出备份后清理旧数据。');
  }
}

function loadData() {
  try {
    const raw = JSON.parse(localStorage.getItem(DATA_KEY) || '{}');
    if (Array.isArray(raw.items)) state.items = raw.items;
  } catch (e) {
    state.items = [];
  }
}

function normalizeText(s) {
  return String(s || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, ' ').trim();
}

function groupKey(s) {
  return normalizeText(s)
    .replace(/[（）()\[\]【】·,，。.:：\-—_\/\\]/g, '')
    .toLowerCase();
}

function fixDigits(s) {
  return String(s || '')
    .replace(/[Oo]/g, '0')
    .replace(/[IlL|]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Gg]/g, '6')
    .replace(/[Qq]/g, '9');
}

function splitCodes(raw) {
  return fixDigits(raw).split(/[\s,，、\/；;]+/).filter(Boolean);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ============================ ocr ============================ */

function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('chi_sim', 1, {
      workerPath: BASE + 'vendor/tesseract/worker.min.js',
      corePath: BASE + 'vendor/core',
      langPath: BASE + 'tessdata',
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          const pct = Math.round(m.progress * 100);
          el.progressText.textContent = '正在识别文字… ' + pct + '%';
        }
      },
      errorHandler: (err) => console.error('[ocr]', err)
    }).then(async (w) => {
      try { await w.setParameters({ preserve_interword_spaces: '1' }); } catch (e) { /* ignore */ }
      return w;
    }).catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
    img.src = url;
  });
}

async function prepareImage(file) {
  const { img, url } = await loadImage(file);
  const scale = Number(cfg.scale) || 1.5;
  const targetW = Math.min(2400, Math.max(1000, Math.round(img.naturalWidth * scale)));
  const targetH = Math.max(1, Math.round(img.naturalHeight * targetW / img.naturalWidth));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // 灰度 + 轻度对比拉伸，提升手机截图上的小字识别率
  const imageData = ctx.getImageData(0, 0, targetW, targetH);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    const v = g < 205 ? Math.max(0, Math.round((g - 205) * 1.3 + 205)) : g;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  const ocrDataUrl = canvas.toDataURL('image/jpeg', 0.9);

  let thumb = '';
  if (cfg.saveThumb) {
    const tw = 220;
    const th = Math.max(1, Math.round(img.naturalHeight * tw / img.naturalWidth));
    const tc = document.createElement('canvas');
    tc.width = tw;
    tc.height = th;
    tc.getContext('2d').drawImage(img, 0, 0, tw, th);
    thumb = tc.toDataURL('image/jpeg', 0.55);
  }
  URL.revokeObjectURL(url);
  return { ocrDataUrl, thumb };
}

/* ============================ extraction ============================ */

function extractCode(lines, full) {
  const customs = String(cfg.codeRegex || '').split('\n').map((s) => s.trim()).filter(Boolean);
  for (const pattern of customs) {
    try {
      const m = full.match(new RegExp(pattern, 'i'));
      if (m) {
        const got = splitCodes(m[1] || m[0]).join(' ');
        if (got) return got;
      }
    } catch (e) { /* 无效正则直接跳过 */ }
  }

  const labeled = [
    /(?:取件码|取货码|提取码|取件密码|取件验证码|验证码|密码)\s*[:：是为]?\s*([0-9OoIlZzSsBbGgQq]{4,10}(?:[\s\-－—~]+[0-9OoIlZzSsBbGgQq]{2,10})*)/i,
    /(?:请?凭(?:取件码|取货码|码)?)\s*[:：]?\s*([0-9OoIlZzSsBbGgQq]{4,10})/i
  ];
  for (const re of labeled) {
    const m = full.match(re);
    if (m) {
      const got = splitCodes(m[1]).join(' ');
      if (got) return got;
    }
  }

  const shelf = full.match(/(?:^|[^\d])(\d{1,2})\s*[-－]\s*(\d{1,2})\s*[-－]\s*(\d{3,6})(?!\d)/);
  if (shelf) return shelf[1] + '-' + shelf[2] + '-' + shelf[3];

  for (const line of lines) {
    const t = normalizeText(line).replace(/[\s\-－—]/g, '');
    if (/^[0-9OoIlZzSsBbGgQq]{4,10}$/.test(t) && /\d/.test(t)) return fixDigits(t);
  }

  const loose = full.match(/(?:^|[^\d])([0-9OoIlZzSsBbGgQq]{6,8})(?:[^\d]|$)/);
  if (loose) return fixDigits(loose[1]);
  return '';
}

function extractLocation(lines) {
  const configured = String(cfg.locationKeys || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const keys = configured.length ? configured : DEFAULT_LOCATION_KEYS.split('\n');
  let best = null;

  const strong = /^(菜鸟驿站|驿站|丰巢|快递柜|取件点|自提点|代收点|智能柜|货架|货位|柜)$/;

  for (const raw of lines) {
    const t = normalizeText(raw);
    if (!t || t.length > 80) continue;
    let score = 0;
    for (const k of keys) {
      if (!t.includes(k)) continue;
      score += strong.test(k) ? 5 : (k.length >= 3 ? 3 : 1);
    }
    // 标题行、验证码行、时间行都不是地点
    if (/通知|提醒|短信|【|】|取件码|密码|验证码|单号|手机号|电话|过期|时效/.test(t)) score -= 8;
    if (/^\d/.test(t)) score -= 3;
    if (/^[^a-zA-Z\u4e00-\u9fa5]*$/.test(t)) score -= 8;
    // 带"到达/放至/地址"的通常是真正的地点描述
    if (/到达|已到|放至|放于|送达|地址|位于/.test(t)) score += 2;
    if (score > 0 && (!best || score > best.score || (score === best.score && t.length < best.t.length))) {
      best = { t, score };
    }
  }
  if (!best) return '';

  const s = best.t
    .replace(/^[【\[][^】\]]*[】\]]\s*/, '')
    .replace(/^.*?(?:取件地址|取件地点|地点)\s*[:：]\s*/, '')
    .replace(/^.*?(?:您的?快件|您的?包裹|包裹|快件|您)\s*/, '')
    .replace(/^(?:已到达?|已放至|已放|到达|放至|放在|放于|送达)\s*/, '')
    .replace(/[。！!~～]+$/, '')
    .slice(0, 50)
    .trim();
  return s;
}

function extractCabinet(full) {
  const patterns = [
    /(?:柜号|柜子|储物柜|货架|格口|货位)\s*[:：#]?\s*([A-Za-z0-9\-]{1,8})/i,
    /([A-Za-z]?\d{1,3})\s*号?柜/,
    /([A-Za-z])\s*柜/,
    /第?\s*(\d{1,3})\s*格/
  ];
  for (const re of patterns) {
    const m = full.match(re);
    if (m) return m[1].toUpperCase();
  }
  return '';
}

function extractCarrier(full) {
  for (const c of CARRIERS) if (full.includes(c)) return c;
  return '';
}

function extractFields(text) {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const full = lines.join(' ');
  return {
    location: extractLocation(lines),
    cabinet: extractCabinet(full),
    code: extractCode(lines, full),
    carrier: extractCarrier(full)
  };
}

/* ============================ queue ============================ */

function addFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && f.type.startsWith('image/'));
  if (!files.length) return;
  files.forEach((f) => state.queue.push({
    id: uid(), file: f, name: f.name || '粘贴的图片', status: '待识别',
    thumb: '', rawText: '', location: '', cabinet: '', code: '', carrier: ''
  }));
  renderQueue();
  toast('已加入 ' + files.length + ' 张图片');
}

function setProgress(ratio, text) {
  el.progressBar.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
  if (text) el.progressText.textContent = text;
}

async function recognizeAll() {
  if (!state.queue.some((q) => q.status !== '已识别')) {
    toast('没有需要识别的图片');
    return;
  }
  el.btnRecognize.disabled = true;
  el.btnAddAll.disabled = true;
  el.progressWrap.classList.remove('hidden');
  setProgress(0, '加载识别引擎（首次约 23MB）…');

  try {
    const worker = await getWorker();
    const total = state.queue.length;
    for (let i = 0; i < total; i++) {
      const q = state.queue[i];
      if (q.status === '已识别') continue;
      q.status = '处理中';
      renderQueue();
      setProgress(i / total, '处理第 ' + (i + 1) + '/' + total + ' 张：' + q.name);
      try {
        const prepared = await prepareImage(q.file);
        const { data } = await worker.recognize(prepared.ocrDataUrl);
        q.rawText = (data && data.text) || '';
        Object.assign(q, extractFields(q.rawText));
        q.thumb = prepared.thumb;
        q.status = '已识别';
      } catch (e) {
        q.status = '识别失败';
        q.rawText = String(e && e.message || e);
      }
      renderQueue();
    }
    setProgress(1, '识别完成');
    toast('识别完成。核对字段后加入清单。');
    setTimeout(() => el.progressWrap.classList.add('hidden'), 1500);
  } catch (e) {
    el.progressWrap.classList.add('hidden');
    toast('识别引擎加载失败：' + (e && e.message || e));
  } finally {
    el.btnRecognize.disabled = false;
    el.btnAddAll.disabled = false;
    renderQueue();
  }
}

function renderQueue() {
  const list = state.queue;
  el.importEmpty.classList.toggle('hidden', list.length > 0);
  el.queueHead.classList.toggle('hidden', list.length === 0);
  el.btnRecognize.disabled = list.length === 0;
  el.btnAddAll.disabled = list.length === 0;
  el.queueCount.textContent = list.length ? '· ' + list.length + ' 张' : '';

  el.queue.innerHTML = list.map((q) => {
    const ready = q.location && q.code;
    return '<div class="qcard ' + (ready ? 'ready' : '') + '" data-qid="' + q.id + '">' +
      (q.thumb
        ? '<img class="qthumb" src="' + q.thumb + '" alt="截图缩略图">'
        : '<div class="qthumb placeholder">暂未生成<br>缩略图</div>') +
      '<div class="qbody">' +
        '<div class="qfile">' + esc(q.name) + '<span class="qstatus">' + esc(q.status) + '</span></div>' +
        '<div class="qgrid">' +
          '<div><label>地点 / 驿站</label><input data-field="location" value="' + esc(q.location) + '" placeholder="未识别"></div>' +
          '<div><label>柜号 / 货架</label><input data-field="cabinet" value="' + esc(q.cabinet) + '" placeholder="可留空"></div>' +
          '<div><label>取件码</label><input data-field="code" value="' + esc(q.code) + '" placeholder="未识别"></div>' +
          '<div><label>来源</label><input data-field="carrier" value="' + esc(q.carrier) + '" placeholder="可留空"></div>' +
        '</div>' +
        '<details class="qraw"><summary>查看 OCR 原文</summary><pre>' + esc(q.rawText || '（暂无）') + '</pre></details>' +
        '<div class="qactions">' +
          '<button class="btn primary" data-qact="add">加入清单</button>' +
          '<button class="btn ghost danger" data-qact="remove">移除</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function queueAdd(id) {
  const q = state.queue.find((x) => x.id === id);
  if (!q) return;
  const location = q.location.trim() || '未标地点';
  const code = q.code.trim();
  if (!code) { toast('这张还没有取件码，先补上'); return; }
  state.items.unshift({
    id: uid(), location, cabinet: q.cabinet.trim(), code,
    carrier: q.carrier.trim(), note: '', picked: false,
    thumb: q.thumb, source: q.name, createdAt: Date.now()
  });
  state.queue = state.queue.filter((x) => x.id !== id);
  save(); renderQueue(); renderList();
  toast('已加入清单');
}

function queueAddAll() {
  const valid = state.queue.filter((q) => q.code.trim());
  if (!valid.length) { toast('没有识别到取件码，先手动补一下'); return; }
  valid.forEach((q) => {
    state.items.unshift({
      id: uid(), location: q.location.trim() || '未标地点', cabinet: q.cabinet.trim(),
      code: q.code.trim(), carrier: q.carrier.trim(), note: '', picked: false,
      thumb: q.thumb, source: q.name, createdAt: Date.now()
    });
  });
  const skipped = state.queue.length - valid.length;
  state.queue = [];
  save(); renderQueue(); renderList();
  toast('已加入 ' + valid.length + ' 条' + (skipped ? '，跳过 ' + skipped + ' 张无取件码的' : ''));
}

/* ============================ list ============================ */

function getGroups(items) {
  const map = new Map();
  items.forEach((it) => {
    const k = groupKey(it.location) + '||' + (groupKey(it.cabinet) || '未标柜');
    if (!map.has(k)) {
      map.set(k, { location: it.location || '未标地点', cabinet: it.cabinet || '', items: [] });
    }
    map.get(k).items.push(it);
  });
  return Array.from(map.values()).sort((a, b) =>
    a.location.localeCompare(b.location, 'zh-CN') || a.cabinet.localeCompare(b.cabinet, 'zh-CN')
  );
}

function groupCodes(g) {
  const seen = new Set();
  const out = [];
  g.items.forEach((it) => splitCodes(it.code).forEach((c) => {
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }));
  return out;
}

function groupText(g) {
  const head = g.location + (g.cabinet ? ' · ' + g.cabinet : '');
  return head + '\n取件码：' + groupCodes(g).join(' / ');
}

function renderList() {
  const pending = state.items.filter((i) => !i.picked);
  const picked = state.items.filter((i) => i.picked);
  el.statPending.textContent = pending.length;
  el.statPicked.textContent = picked.length;
  el.tabCount.textContent = pending.length;
  el.listEmpty.classList.toggle('hidden', state.items.length > 0);
  el.groupList.classList.toggle('hidden', pending.length === 0);

  const groups = getGroups(pending);
  el.groupList.innerHTML = groups.map((g, gi) => {
    const codes = groupCodes(g);
    const itemsHtml = g.items.map((it) =>
      '<div class="item">' +
        '<button class="check" data-act="pick" data-id="' + it.id + '" title="标为已取" aria-label="标为已取">✓</button>' +
        '<span class="item-code">' + esc(it.code) + '</span>' +
        '<span class="item-meta">' + esc([it.carrier, it.note, it.source].filter(Boolean).join(' · ') || (it.thumb ? '有原图' : '')) + '</span>' +
        '<button data-act="edit" data-id="' + it.id + '">改</button>' +
        '<button data-act="del" data-id="' + it.id + '">删</button>' +
      '</div>'
    ).join('');

    return '<article class="group" data-group="' + gi + '">' +
      '<div class="group-head">' +
        '<div class="group-title">' +
          '<span class="pin" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg></span>' +
          '<div><h3>' + esc(g.location) + '</h3>' + (g.cabinet ? '<span class="tag">' + esc(g.cabinet) + '</span>' : '') + '</div>' +
        '</div>' +
        '<div class="codes">' + codes.map((c) =>
          '<button class="code" data-act="copy-code" data-code="' + esc(c) + '" title="点击复制">' + esc(c) + '</button>'
        ).join('') + '</div>' +
      '</div>' +
      '<div class="group-actions">' +
        '<button class="btn primary" data-act="copy-group" data-group="' + gi + '">复制这一组</button>' +
        '<button class="btn" data-act="pick-group" data-group="' + gi + '">整组已取</button>' +
      '</div>' +
      '<div class="group-items">' + itemsHtml + '</div>' +
    '</article>';
  }).join('');

  el.pickedWrap.classList.toggle('hidden', picked.length === 0);
  el.pickedCount.textContent = '· ' + picked.length;
  el.pickedList.innerHTML = picked.map((it) =>
    '<div class="picked-item">' +
      '<button class="check done" data-act="unpick" data-id="' + it.id + '" title="恢复为待取" aria-label="恢复为待取">✓</button>' +
      '<span class="item-code">' + esc(it.code) + '</span>' +
      '<span class="item-meta">' + esc(it.location + (it.cabinet ? ' · ' + it.cabinet : '')) + '</span>' +
      '<button data-act="del" data-id="' + it.id + '">删除</button>' +
    '</div>'
  ).join('');

  el.btnCopyAll.disabled = pending.length === 0;
  el.btnClearPicked.disabled = picked.length === 0;
}

function allPendingText() {
  const groups = getGroups(state.items.filter((i) => !i.picked));
  if (!groups.length) return '';
  const lines = ['取件清单 ' + new Date().toLocaleString('zh-CN'), '————————————'];
  groups.forEach((g, i) => {
    lines.push('[' + (i + 1) + '] ' + g.location + (g.cabinet ? ' · ' + g.cabinet : ''));
    lines.push('    取件码：' + groupCodes(g).join(' / '));
  });
  return lines.join('\n');
}

function copyText(text) {
  if (!text) { toast('没有可复制的内容'); return; }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('已复制')).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); toast('已复制'); }
  catch (e) { toast('复制失败，请手动选择文本'); }
  ta.remove();
}

function mutate(id, fn) {
  const it = state.items.find((x) => x.id === id);
  if (!it) return;
  fn(it);
  save(); renderList();
}

/* ============================ dialogs ============================ */

function openManual(item) {
  editingId = item ? item.id : null;
  el.manualTitle.textContent = item ? '编辑取件信息' : '添加取件信息';
  el.fieldId.value = item ? item.id : '';
  el.fieldLocation.value = item ? item.location : '';
  el.fieldCabinet.value = item ? item.cabinet || '' : '';
  el.fieldCode.value = item ? item.code : '';
  el.fieldCarrier.value = item ? item.carrier || '' : '';
  el.fieldNote.value = item ? item.note || '' : '';
  el.manualDialog.showModal();
  el.fieldLocation.focus();
}

function openSettings() {
  el.cfgLocationKeys.value = cfg.locationKeys || '';
  el.cfgCodeRegex.value = cfg.codeRegex || '';
  el.cfgScale.value = String(cfg.scale || '1.5');
  el.cfgThumb.checked = !!cfg.saveThumb;
  el.settingsDialog.showModal();
}

function exportJson() {
  download('取件清单备份-' + new Date().toISOString().slice(0, 10) + '.json',
    JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), config: cfg, items: state.items }, null, 2),
    'application/json;charset=utf-8');
  toast('备份已下载');
}

function exportCsv() {
  const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['地点', '柜号', '取件码', '来源', '备注', '状态', '添加时间']];
  state.items.forEach((i) => rows.push([
    i.location, i.cabinet, i.code, i.carrier, i.note,
    i.picked ? '已取' : '待取', new Date(i.createdAt || 0).toLocaleString('zh-CN')
  ]));
  download('取件清单-' + new Date().toISOString().slice(0, 10) + '.csv',
    '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n'),
    'text/csv;charset=utf-8');
  toast('CSV 已下载');
}

function switchTab(which) {
  const isImport = which === 'import';
  el.tabImport.classList.toggle('active', isImport);
  el.tabList.classList.toggle('active', !isImport);
  el.tabImport.setAttribute('aria-selected', String(isImport));
  el.tabList.setAttribute('aria-selected', String(!isImport));
  el.panelImport.classList.toggle('active', isImport);
  el.panelList.classList.toggle('active', !isImport);
}

/* ============================ events ============================ */

el.btnChoose.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach((ev) => el.dropZone.addEventListener(ev, (e) => {
  e.preventDefault();
  el.dropZone.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => el.dropZone.addEventListener(ev, (e) => {
  e.preventDefault();
  el.dropZone.classList.remove('over');
}));
el.dropZone.addEventListener('drop', (e) => {
  addFiles(e.dataTransfer ? e.dataTransfer.files : []);
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.type && it.type.indexOf('image/') === 0) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    addFiles(files);
    switchTab('import');
  }
});

el.btnRecognize.addEventListener('click', recognizeAll);
el.btnAddAll.addEventListener('click', queueAddAll);
el.btnManual.addEventListener('click', () => openManual(null));
el.btnEmptyAdd.addEventListener('click', () => openManual(null));

el.queue.addEventListener('input', (e) => {
  const input = e.target.closest('[data-field]');
  if (!input) return;
  const card = input.closest('[data-qid]');
  const q = state.queue.find((x) => x.id === card.dataset.qid);
  if (q) q[input.dataset.field] = input.value;
});

el.queue.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-qact]');
  if (!btn) return;
  const card = btn.closest('[data-qid]');
  const id = card.dataset.qid;
  if (btn.dataset.qact === 'add') queueAdd(id);
  if (btn.dataset.qact === 'remove') {
    state.queue = state.queue.filter((x) => x.id !== id);
    renderQueue();
  }
});

el.groupList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === 'pick') mutate(btn.dataset.id, (it) => { it.picked = true; });
  if (act === 'unpick') mutate(btn.dataset.id, (it) => { it.picked = false; });
  if (act === 'del') mutate(btn.dataset.id, () => {
    state.items = state.items.filter((x) => x.id !== btn.dataset.id);
  });
  if (act === 'edit') {
    const item = state.items.find((x) => x.id === btn.dataset.id);
    if (item) openManual(item);
  }
  if (act === 'copy-code') copyText(btn.dataset.code);
  if (act === 'copy-group') {
    const g = getGroups(state.items.filter((i) => !i.picked))[Number(btn.dataset.group)];
    if (g) copyText(groupText(g));
  }
  if (act === 'pick-group') {
    const g = getGroups(state.items.filter((i) => !i.picked))[Number(btn.dataset.group)];
    if (!g) return;
    const ids = new Set(g.items.map((i) => i.id));
    state.items.forEach((it) => { if (ids.has(it.id)) it.picked = true; });
    save(); renderList();
    toast('这一组已标为已取');
  }
});

el.pickedList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'unpick') mutate(btn.dataset.id, (it) => { it.picked = false; });
  if (btn.dataset.act === 'del') {
    state.items = state.items.filter((x) => x.id !== btn.dataset.id);
    save(); renderList();
  }
});

el.manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const location = el.fieldLocation.value.trim();
  const code = el.fieldCode.value.trim();
  if (!location || !code) { toast('地点和取件码必填'); return; }
  const data = {
    location, code,
    cabinet: el.fieldCabinet.value.trim(),
    carrier: el.fieldCarrier.value.trim(),
    note: el.fieldNote.value.trim()
  };
  if (editingId) mutate(editingId, (it) => Object.assign(it, data));
  else {
    state.items.unshift(Object.assign({
      id: uid(), picked: false, thumb: '', source: '手动添加', createdAt: Date.now()
    }, data));
    save(); renderList();
  }
  el.manualDialog.close();
  toast('已保存');
});

document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => document.getElementById(b.dataset.close).close());
});

el.tabImport.addEventListener('click', () => switchTab('import'));
el.tabList.addEventListener('click', () => switchTab('list'));

el.btnCopyAll.addEventListener('click', () => copyText(allPendingText()));
el.btnExport.addEventListener('click', () => el.exportDialog.showModal());
el.btnExportText.addEventListener('click', () => copyText(allPendingText()));
el.btnExportCsv.addEventListener('click', exportCsv);
el.btnDownloadJson.addEventListener('click', exportJson);

el.btnClearPicked.addEventListener('click', () => {
  const n = state.items.filter((i) => i.picked).length;
  if (!n) return;
  if (!confirm('删除 ' + n + ' 条已取记录？此操作不可撤销。')) return;
  state.items = state.items.filter((i) => !i.picked);
  save(); renderList();
  toast('已清除 ' + n + ' 条');
});

el.btnSettings.addEventListener('click', openSettings);
el.btnSaveSettings.addEventListener('click', () => {
  cfg = Object.assign({}, cfg, {
    locationKeys: el.cfgLocationKeys.value,
    codeRegex: el.cfgCodeRegex.value,
    scale: el.cfgScale.value,
    saveThumb: el.cfgThumb.checked
  });
  saveConfig();
  toast('设置已保存');
});
el.btnExportJson.addEventListener('click', exportJson);
el.btnImportJson.addEventListener('click', () => el.jsonFile.click());
el.jsonFile.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items)) throw new Error('文件里没有清单数据');
    const existing = new Set(state.items.map((i) => i.id));
    let added = 0;
    data.items.forEach((it) => {
      if (!it || !it.id || existing.has(it.id)) return;
      state.items.push(it);
      existing.add(it.id);
      added++;
    });
    if (data.config) {
      cfg = Object.assign({}, cfg, data.config);
      saveConfig();
    }
    save(); renderList();
    toast('已恢复 ' + added + ' 条');
  } catch (err) {
    toast('恢复失败：' + (err && err.message || err));
  }
});
el.btnClearAll.addEventListener('click', () => {
  if (!confirm('清空所有取件数据和设置？此操作不可撤销，建议先下载备份。')) return;
  state.items = [];
  state.queue = [];
  localStorage.removeItem(DATA_KEY);
  localStorage.removeItem(CONFIG_KEY);
  renderQueue(); renderList();
  el.settingsDialog.close();
  toast('已清空');
});

/* ============================ init ============================ */

loadData();
renderQueue();
renderList();
switchTab('import');

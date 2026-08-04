/* ============================================================
 *  Sector Radar — 板块跟踪前端
 *  数据源:东方财富 push2delay(板块行情,CORS 开放)
 *        东方财富 search-api-web(新闻,JSONP)
 *        同花顺 stockpage(个股详情)
 *        本地 sectors.json(用户自建板块)
 * ============================================================ */

const STATE = {
  sectors: {},
  newsCache: {},
  marketSectors: [],   // 东方财富全市场板块
  marketFetched: false,
  filter: 'all',
  keyword: '',
  hmFilter: 'all',
  hmSize: 'abs',
  ddPeriod: 5,
  activeTab: 'overview',
};

// === Tab 切换 ===
function bindTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });
}
function switchTab(name) {
  STATE.activeTab = name;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  // 进入热力图/回撤 tab 时按需拉数据
  if ((name === 'heatmap' || name === 'overview' || name === 'drawdown') && !STATE.marketFetched) {
    fetchMarketSectors();
  }
}

// === 本地板块数据 ===
async function loadSectors() {
  try {
    const res = await fetch('./sectors.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    STATE.sectors = await res.json();
  } catch (e) {
    console.warn('加载 sectors.json 失败', e);
    STATE.sectors = window.__FALLBACK_SECTORS || {};
  }
}

// === 拉全市场板块 ===
async function fetchMarketSectors() {
  if (STATE.marketFetched && Date.now() - STATE.marketFetched < 60_000) {
    return;   // 1 分钟内不重复拉
  }
  // 一次拉够所有行业板块(用 fs=m:90+t:2),分页拿 200 条
  const fields = 'f1,f2,f3,f4,f6,f8,f9,f10,f12,f14,f20,f62,f66,f72,f81,f100,f128,f184,f185';
  const url = `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=200&po=1&np=1&fltt=2&invt=2&fs=m:90+t:2&fields=${fields}&fid=f3`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    const diff = j?.data?.diff || {};
    const list = Object.values(diff).map(x => ({
      code: x.f12,
      name: x.f14,
      pct: (x.f3 || 0),                 // 涨跌幅(%) 已是百分点
      change: (x.f4 || 0) / 100,        // 涨跌额
      price: x.f2 / 100,                 // 最新点位
      mcap: x.f20 || 0,                  // 总市值
      turnover: (x.f8 || 0) / 100,       // 换手率(%)
      pe: (x.f9 || 0) / 100,             // 动 PE
      volumeRatio: (x.f10 || 0) / 100,   // 量比
      mainNet: x.f62 || 0,               // 主力净流入(元)
      superNet: x.f66 || 0,              // 特大单净流入(元)
      bigNet: x.f72 || 0,                // 大单净流入(元)
      mainNetPct: (x.f184 || 0),         // 主力净流入占比(%) 已是百分点
      changePctRank: x.f81 || 0,         // 涨跌幅排名
      pct5d: (x.f100 || 0),              // 5日涨跌(%) 已是百分点
      high5d: (x.f128 || 0) / 100,       // 5日最高点位
    })).filter(x => x.code && x.name);
    STATE.marketSectors = list;
    STATE.marketFetched = Date.now();
    onMarketLoaded();
  } catch (e) {
    console.error('拉板块行情失败', e);
    document.getElementById('treemap').innerHTML = '<div class="loading">板块数据拉取失败,可能是网络问题。请检查后刷新。</div>';
  }
}

function onMarketLoaded() {
  renderOverview();
  if (STATE.activeTab === 'heatmap') renderTreemap();
  if (STATE.activeTab === 'drawdown') renderDrawdown();
  if (STATE.activeTab === 'flow') renderFlow();
}

// === 概览 ===
function renderOverview() {
  const list = STATE.marketSectors;
  if (!list.length) return;

  document.getElementById('ov-sectors').textContent = list.length;
  const up = list.filter(x => x.pct > 0).length;
  const down = list.filter(x => x.pct < 0).length;
  document.getElementById('ov-up').textContent = up;
  document.getElementById('ov-down').textContent = down;

  const sorted = [...list].sort((a, b) => b.pct - a.pct);
  const top = sorted[0], bottom = sorted[sorted.length - 1];
  document.getElementById('ov-top').innerHTML =
    `${escapeHtml(top.name)} <span style="color:var(--red); font-size:14px;">+${top.pct.toFixed(2)}%</span>`;
  document.getElementById('ov-bottom').innerHTML =
    `${escapeHtml(bottom.name)} <span style="color:var(--green); font-size:14px;">${bottom.pct.toFixed(2)}%</span>`;

  // Top 10 / Bottom 10
  renderRankList('top10-list', sorted.slice(0, 10));
  renderRankList('bottom10-list', sorted.slice(-10).reverse());
}

function renderRankList(elId, items) {
  const max = Math.max(...items.map(x => Math.abs(x.pct)), 1);
  const el = document.getElementById(elId);
  el.innerHTML = items.map((x, i) => {
    const isUp = x.pct >= 0;
    const widthPct = Math.min(100, Math.abs(x.pct) / max * 100);
    const color = isUp ? 'var(--red)' : 'var(--green)';
    return `
      <a class="rank-row ${i < 3 ? 'top3' : ''}" href="https://quote.eastmoney.com/bkzh/${x.code}.html" target="_blank" rel="noopener">
        <span class="rank-no">${i + 1}</span>
        <span class="name">${escapeHtml(x.name)}<small>${x.code}</small></span>
        <span class="pct" style="color:${color}">${isUp ? '+' : ''}${x.pct.toFixed(2)}%</span>
        <span class="bar-wrap"><span class="bar" style="width:${widthPct}%; background:${color};"></span></span>
        <span class="extra">换手 ${x.turnover.toFixed(1)}%</span>
      </a>
    `;
  }).join('');
}

// === 板块热力图 (Treemap) ===
function renderTreemap() {
  const wrap = document.getElementById('treemap');
  if (!wrap) return;
  let list = STATE.marketSectors.slice();
  if (!list.length) {
    wrap.innerHTML = '<div class="loading">暂无数据,稍候…</div>';
    return;
  }
  if (STATE.hmFilter === 'up') list = list.filter(x => x.pct > 0);
  if (STATE.hmFilter === 'down') list = list.filter(x => x.pct < 0);
  if (!list.length) {
    wrap.innerHTML = '<div class="loading">没有匹配的板块</div>';
    return;
  }

  // 面积权重
  const sizeKey = STATE.hmSize === 'vol' ? 'turnover' : 'pct';
  const sized = list.map(x => {
    let s = Math.abs(x[sizeKey]);
    if (s < 0.05) s = 0.05;   // 防止 0 面积
    return { ...x, _size: s };
  });

  // 简易 squarified treemap
  const rect = wrap.getBoundingClientRect();
  const W = rect.width, H = Math.max(500, rect.height || 540);
  const items = squarify(sized, W, H);
  wrap.innerHTML = items.map(it => {
    const isUp = it.pct >= 0;
    const intensity = Math.min(1, Math.abs(it.pct) / 8);
    const bg = isUp
      ? `rgba(248, 81, 73, ${0.25 + intensity * 0.55})`
      : `rgba(63, 185, 80, ${0.25 + intensity * 0.55})`;
    const textColor = intensity > 0.5 ? '#fff' : 'var(--text)';
    const sizeCls = it.w < 70 || it.h < 50 ? 'tiny' : (it.w < 130 ? 'small' : '');
    return `
      <div class="tm-node ${sizeCls}"
           style="left:${it.x}px; top:${it.y}px; width:${it.w}px; height:${it.h}px; background:${bg}; color:${textColor};"
           title="${escapeHtml(it.name)} (${it.code})\n涨跌幅: ${it.pct.toFixed(2)}%\n换手率: ${it.turnover.toFixed(2)}%"
           onclick="window.open('https://quote.eastmoney.com/bkzh/${it.code}.html', '_blank')">
        <div class="nm">${escapeHtml(it.name)}</div>
        <div class="pc">${isUp ? '+' : ''}${it.pct.toFixed(2)}%</div>
      </div>
    `;
  }).join('');
}

// 简易 squarified treemap(不追求完美,但要看起来像图二)
function squarify(items, w, h) {
  const total = items.reduce((s, x) => s + x._size, 0);
  const scale = (w * h) / total;
  const scaled = items.map(x => ({ ...x, area: x._size * scale }))
                      .sort((a, b) => b.area - a.area);

  const out = [];
  let x = 0, y = 0, rw = w, rh = h;
  let row = [];
  let rowArea = 0;

  function worst(arr, side) {
    const s = arr.reduce((sum, x) => sum + x.area, 0);
    const max = Math.max(...arr.map(x => x.area));
    const min = Math.min(...arr.map(x => x.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  }
  function layoutRow(row, side, ox, oy, vertical) {
    const s = row.reduce((sum, x) => sum + x.area, 0);
    const thickness = s / side;
    let cursor = vertical ? oy : ox;
    for (const it of row) {
      const length = it.area / thickness;
      if (vertical) {
        out.push({ ...it, x: ox, y: cursor, w: thickness, h: length });
        cursor += length;
      } else {
        out.push({ ...it, x: cursor, y: oy, w: length, h: thickness });
        cursor += length;
      }
    }
    return thickness;
  }

  for (let i = 0; i < scaled.length; i++) {
    const it = scaled[i];
    const shortSide = Math.min(rw, rh);
    row.push(it);
    rowArea += it.area;
    if (row.length > 1 && worst(row, shortSide) > worst([row[0]], shortSide)) {
      // 把上一个吐出来
      const last = row.pop();
      rowArea -= last.area;
      const thickness = layoutRow(row, shortSide, x, y, rh < rw);
      if (rh < rw) {
        x += thickness; rw -= thickness;
      } else {
        y += thickness; rh -= thickness;
      }
      row = [last];
      rowArea = last.area;
    }
  }
  if (row.length) {
    const shortSide = Math.min(rw, rh);
    layoutRow(row, shortSide, x, y, rh < rw);
  }
  return out;
}

// === 回撤排行 ===
function renderDrawdown() {
  const wrap = document.getElementById('dd-list');
  if (!wrap) return;
  const list = STATE.marketSectors;
  if (!list.length) {
    wrap.innerHTML = '<div class="loading">加载中…</div>';
    return;
  }

  // 用字段推断:
  // f100 = 5日涨跌幅(%),f128 = 5日最高点位(?)
  // 简化的回撤计算:回撤% = pct - pct5d
  // (即"如果 5 日前是高点,现在的回撤")
  // 实际接口里 f100 字段语义可能有变化,先做合理 fallback

  const computed = list.map(x => {
    // 5日高点回撤:(5日最高 - 当前) / 5日最高
    // 数据字段 f128 可能是"5日最高",但单位不明;如果不可用,用 pct - pct5d 估算
    let dd;
    if (x.high5d && x.high5d > 0 && x.price > 0) {
      dd = (x.price - x.high5d) / x.high5d * 100;
    } else {
      // 退而求其次:5 日内最大累计涨幅 - 当前
      dd = Math.min(0, x.pct - x.pct5d);
    }
    return { ...x, dd };
  }).sort((a, b) => a.dd - b.dd);   // 跌最多的在前

  // 只取"非新高"的板块
  const bottom = computed.filter(x => x.dd < 0).slice(0, 30);
  if (!bottom.length) {
    wrap.innerHTML = '<div class="loading">没有回撤的板块(可能全在涨)</div>';
    return;
  }
  const minDd = bottom[bottom.length - 1].dd || -1;
  const maxDd = bottom[0].dd || -1;
  wrap.innerHTML = bottom.map((x, i) => {
    const widthPct = Math.abs(x.dd) / Math.abs(minDd) * 100;
    return `
      <a class="rank-row ${i < 3 ? 'top3' : ''}" href="https://quote.eastmoney.com/bkzh/${x.code}.html" target="_blank" rel="noopener">
        <span class="rank-no">${i + 1}</span>
        <span class="name">${escapeHtml(x.name)}<small>${x.code}</small></span>
        <span class="pct" style="color:var(--green)">${x.dd.toFixed(2)}%</span>
        <span class="bar-wrap"><span class="bar" style="width:${widthPct}%; background:var(--green);"></span></span>
        <span class="extra">今 ${x.pct >= 0 ? '+' : ''}${x.pct.toFixed(2)}% · 5日 ${x.pct5d >= 0 ? '+' : ''}${x.pct5d.toFixed(2)}%</span>
      </a>
    `;
  }).join('');
}

// === 资金流向 ===
function formatYi(yuan) {
  // yuan -> 亿元
  const yi = yuan / 1e8;
  if (Math.abs(yi) >= 100) return (yi / 1).toFixed(1) + '亿';
  if (Math.abs(yi) >= 1) return yi.toFixed(2) + '亿';
  return (yi * 10000).toFixed(0) + '万';
}

function renderFlow() {
  const list = STATE.marketSectors;
  if (!list.length) return;

  // 统计
  const totalIn = list.filter(x => x.mainNet > 0).reduce((s, x) => s + x.mainNet, 0);
  const totalOut = Math.abs(list.filter(x => x.mainNet < 0).reduce((s, x) => s + x.mainNet, 0));
  document.getElementById('fl-main-in').textContent = '+' + formatYi(totalIn);
  document.getElementById('fl-main-out').textContent = '-' + formatYi(totalOut);

  const sorted = [...list].sort((a, b) => b.mainNet - a.mainNet);
  const top = sorted[0], bottom = sorted[sorted.length - 1];
  document.getElementById('fl-top').innerHTML =
    `${escapeHtml(top.name)} <span style="color:var(--green); font-size:14px;">+${formatYi(top.mainNet)}</span>`;
  document.getElementById('fl-bottom').innerHTML =
    `${escapeHtml(bottom.name)} <span style="color:var(--red); font-size:14px;">${formatYi(bottom.mainNet)}</span>`;

  // Top 15 流入
  const inflow = sorted.filter(x => x.mainNet > 0).slice(0, 15);
  const maxIn = Math.max(...inflow.map(x => x.mainNet), 1);
  document.getElementById('flow-in-list').innerHTML = inflow.map((x, i) => {
    const widthPct = x.mainNet / maxIn * 100;
    return `
      <a class="rank-row ${i < 3 ? 'top3' : ''}" href="https://quote.eastmoney.com/bkzh/${x.code}.html" target="_blank" rel="noopener">
        <span class="rank-no">${i + 1}</span>
        <span class="name">${escapeHtml(x.name)}<small>${x.code}</small></span>
        <span class="pct" style="color:var(--green)">+${formatYi(x.mainNet)}</span>
        <span class="bar-wrap"><span class="bar" style="width:${widthPct}%; background:var(--green);"></span></span>
        <span class="extra">占 ${x.mainNetPct.toFixed(2)}% · 涨 ${x.pct >= 0 ? '+' : ''}${x.pct.toFixed(2)}%</span>
      </a>
    `;
  }).join('');

  // Top 15 流出
  const outflow = sorted.filter(x => x.mainNet < 0).reverse().slice(0, 15);
  const maxOut = Math.min(...outflow.map(x => x.mainNet), -1);
  document.getElementById('flow-out-list').innerHTML = outflow.map((x, i) => {
    const widthPct = Math.abs(x.mainNet) / Math.abs(maxOut) * 100;
    return `
      <a class="rank-row ${i < 3 ? 'top3' : ''}" href="https://quote.eastmoney.com/bkzh/${x.code}.html" target="_blank" rel="noopener">
        <span class="rank-no">${i + 1}</span>
        <span class="name">${escapeHtml(x.name)}<small>${x.code}</small></span>
        <span class="pct" style="color:var(--red)">${formatYi(x.mainNet)}</span>
        <span class="bar-wrap"><span class="bar" style="width:${widthPct}%; background:var(--red);"></span></span>
        <span class="extra">占 ${x.mainNetPct.toFixed(2)}% · 跌 ${x.pct.toFixed(2)}%</span>
      </a>
    `;
  }).join('');
}

// === 我的板块渲染 ===
function renderSectors() {
  const grid = document.getElementById('sectors-grid');
  const names = Object.keys(STATE.sectors);
  if (!names.length) {
    grid.innerHTML = '<div class="loading">没有板块数据。请先用 sector_watch.py add 创建板块。</div>';
    return;
  }
  const kw = STATE.keyword.trim().toLowerCase();
  const filtered = names.filter(name => {
    if (STATE.filter === 'with-news') {
      const c = STATE.newsCache[name];
      if (!c || !c.items || !c.items.length) return false;
    }
    if (STATE.filter === 'hot' && !isHotSector(name)) return false;
    if (kw) {
      const inName = name.toLowerCase().includes(kw);
      const inStocks = (STATE.sectors[name].stocks || []).some(
        s => s.name.toLowerCase().includes(kw) || s.code.includes(kw)
      );
      if (!inName && !inStocks) return false;
    }
    return true;
  });
  if (!filtered.length) {
    grid.innerHTML = '<div class="loading">没有匹配的板块。</div>';
    return;
  }
  grid.innerHTML = filtered.map(name => {
    const info = STATE.sectors[name];
    const stocks = info.stocks || [];
    const newsCached = STATE.newsCache[name];
    const newsCount = newsCached?.items?.length || 0;
    return `
      <article class="sector-card" data-name="${escapeAttr(name)}">
        <div class="sector-head">
          <div>
            <h3>${escapeHtml(name)}${isHotSector(name) ? '<span class="tag-hot">轮动</span>' : ''}</h3>
            <div class="desc">${escapeHtml(info.description || '')}</div>
          </div>
          <span class="count">${stocks.length} 只</span>
        </div>
        <div class="stock-list">
          ${stocks.map(s => `
            <div class="stock-pill">
              <span class="name">${escapeHtml(s.name)}</span>
              <span>
                <span class="code">${s.code}</span>
                <a class="tonghuashun" href="${tonghuashunUrl(s.code)}" target="_blank" rel="noopener">同花顺 ↗</a>
              </span>
            </div>
          `).join('')}
        </div>
        <div class="sector-foot">
          <span class="news-count">
            ${newsCount > 0
              ? `<span class="dot-green">●</span> ${newsCount} 条要闻`
              : `<span class="dot-green" style="color: var(--text-mute)">●</span> 暂无要闻`}
          </span>
          <button class="btn-news" data-action="load-news" data-sector="${escapeAttr(name)}">
            ${newsCount > 0 ? '刷新要闻' : '拉取要闻'}
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function tonghuashunUrl(code) {
  const prefix = code.startsWith('6') || code.startsWith('5') ? 'sh'
              : code.startsWith('8') || code.startsWith('4') || code.startsWith('9') ? 'bj'
              : 'sz';
  return `https://stockpage.10jqka.com.cn/${prefix}${code}/`;
}
function isHotSector(name) {
  return /非银|银行|周期|出海|CXO|创新|低位|轮动|超跌|国家|队|央|国资/.test(name);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// === 新闻(东方财富 JSONP) ===
async function fetchNews(sectorName, force = false) {
  const cache = STATE.newsCache[sectorName];
  if (!force && cache && Date.now() - cache.ts < 5 * 60 * 1000) {
    return cache.items;
  }
  const sampleNames = (STATE.sectors[sectorName]?.stocks || []).slice(0, 3).map(s => s.name);
  const query = `${sectorName} ${sampleNames.join(' ')} 最新`;
  const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=__cb'
    + '&param=' + encodeURIComponent(JSON.stringify({
      uid: '',
      keyword: query,
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 8, preTag: '<em>', postTag: '</em>' } }
    }));
  return new Promise((resolve) => {
    const cbName = '__cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    window[cbName] = function (data) {
      try { delete window[cbName]; document.head.removeChild(script); } catch (e) {}
      const hits = data?.result?.cmsArticleWebOld || [];
      const items = hits.map(h => ({
        title: (h.title || '').replace(/<em>|<\/em>/g, ''),
        url: h.url || '',
      })).filter(x => x.title && x.url);
      STATE.newsCache[sectorName] = { ts: Date.now(), items };
      resolve(items);
    };
    const script = document.createElement('script');
    script.src = url.replace('__cb', cbName);
    script.onerror = () => {
      try { delete window[cbName]; document.head.removeChild(script); } catch (e) {}
      resolve([]);
    };
    document.head.appendChild(script);
    setTimeout(() => {
      if (window[cbName]) {
        try { delete window[cbName]; document.head.removeChild(script); } catch (e) {}
        resolve(STATE.newsCache[sectorName]?.items || []);
      }
    }, 8000);
  });
}

async function showNewsModal(sectorName) {
  const modal = document.getElementById('news-modal');
  const titleEl = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  titleEl.textContent = `${sectorName} · 板块要闻`;
  body.innerHTML = '<div class="news-empty">加载中…</div>';
  modal.classList.remove('hidden');
  const items = await fetchNews(sectorName, true);
  if (!items.length) {
    body.innerHTML = `<div class="news-empty"><p>😅 当前环境拉不到新闻</p></div>`;
  } else {
    body.innerHTML = items.map(n => `
      <div class="news-item">
        <a href="${escapeAttr(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>
        <div class="url">${escapeHtml(n.url)}</div>
      </div>
    `).join('');
  }
  renderSectors();
}

// === 事件绑定 ===
function bindEvents() {
  document.getElementById('refresh-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('loading');
    btn.disabled = true;
    STATE.newsCache = {};
    STATE.marketFetched = 0;
    await loadSectors();
    await fetchMarketSectors();
    renderSectors();
    btn.classList.remove('loading');
    btn.disabled = false;
    updateLastUpdate();
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    STATE.keyword = e.target.value;
    renderSectors();
  });

  // 筛选 pill(我的板块)
  document.querySelectorAll('#panel-mine .filter-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      const filter = p.dataset.filter;
      if (!filter) return;
      document.querySelectorAll('#panel-mine .filter-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      STATE.filter = filter;
      renderSectors();
    });
  });

  // 热力图筛选
  document.querySelectorAll('#panel-heatmap [data-hm]').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#panel-heatmap [data-hm]').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      STATE.hmFilter = p.dataset.hm;
      renderTreemap();
    });
  });
  document.querySelectorAll('#panel-heatmap [data-size]').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#panel-heatmap [data-size]').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      STATE.hmSize = p.dataset.size;
      renderTreemap();
    });
  });

  // 回撤周期
  document.querySelectorAll('#dd-period-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('#dd-period-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      STATE.ddPeriod = parseInt(p.dataset.period, 10);
      renderDrawdown();   // 当前实现是 5 日为主,后续可拓展
    });
  });

  document.getElementById('sectors-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="load-news"]');
    if (btn) showNewsModal(btn.dataset.sector);
  });

  document.getElementById('modal-close').addEventListener('click', () => {
    document.getElementById('news-modal').classList.add('hidden');
  });
  document.getElementById('news-modal').addEventListener('click', (e) => {
    if (e.target.id === 'news-modal') e.currentTarget.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.getElementById('news-modal').classList.add('hidden');
  });

  // 窗口大小变化时重绘 treemap
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (STATE.activeTab === 'heatmap') renderTreemap();
    }, 200);
  });
}

function updateLastUpdate() {
  const now = new Date();
  document.getElementById('last-update').textContent =
    '更新于 ' + now.toLocaleTimeString('zh-CN', { hour12: false });
}

// === 入口 ===
async function main() {
  bindTabs();
  bindEvents();
  await loadSectors();
  renderSectors();
  updateLastUpdate();
  // 默认进入就拉板块行情(概览页要用)
  fetchMarketSectors();
  // 预热新闻
  Object.keys(STATE.sectors).forEach(n => fetchNews(n).then(() => renderSectors()));
}

document.addEventListener('DOMContentLoaded', main);

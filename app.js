/* ============================================================
 *  Sector Radar — 板块跟踪前端
 *  数据源:本地 sectors.json(由 stock-watcher 生成)
 *        东方财富 JSONP(新闻)
 *        同花顺 stockpage(个股详情)
 * ============================================================ */

const STATE = {
  sectors: {},
  filter: 'all',
  keyword: '',
  newsCache: {},   // {sectorName: {ts, items}}
};

// === 数据加载 ===
async function loadSectors() {
  // 优先 fetch,失败则回落到内嵌示例(打开 file:// 时)
  try {
    const res = await fetch('./sectors.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    STATE.sectors = await res.json();
  } catch (e) {
    console.warn('加载 sectors.json 失败,使用内嵌示例', e);
    STATE.sectors = window.__FALLBACK_SECTORS || {};
  }
}

// === 渲染 ===
function renderSummary() {
  const sectorNames = Object.keys(STATE.sectors);
  const totalStocks = sectorNames.reduce(
    (n, k) => n + (STATE.sectors[k].stocks?.length || 0), 0
  );
  const hotKeywords = ['非银', '银行', '周期', '出海', 'CXO', '创新'];
  const hotCount = sectorNames.filter(n => hotKeywords.some(k => n.includes(k))).length;

  document.getElementById('summary').innerHTML = `
    <div class="stat-card">
      <div class="label">板块</div>
      <div class="value accent">${sectorNames.length}</div>
    </div>
    <div class="stat-card">
      <div class="label">成分股</div>
      <div class="value">${totalStocks}</div>
    </div>
    <div class="stat-card">
      <div class="label">热门轮动</div>
      <div class="value" style="color: var(--orange)">${hotCount}</div>
    </div>
    <div class="stat-card">
      <div class="label">运行状态</div>
      <div class="value" style="color: var(--green); font-size: 18px;">● 在线</div>
    </div>
  `;
}

function tonghuashunUrl(code) {
  const prefix = code.startsWith('6') || code.startsWith('5') ? 'sh'
              : code.startsWith('8') || code.startsWith('4') || code.startsWith('9') ? 'bj'
              : 'sz';
  return `https://stockpage.10jqka.com.cn/${prefix}${code}/`;
}

function isHotSector(name) {
  return /非银|银行|周期|出海|CXO|创新/.test(name);
}

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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// === 新闻拉取(东方财富 JSONP) ===
async function fetchNews(sectorName, force = false) {
  const cache = STATE.newsCache[sectorName];
  if (!force && cache && Date.now() - cache.ts < 5 * 60 * 1000) {
    return cache.items;
  }

  const sampleNames = (STATE.sectors[sectorName]?.stocks || [])
    .slice(0, 3).map(s => s.name);
  const query = `${sectorName} ${sampleNames.join(' ')} 最新`;

  // 东方财富的搜索 API,前端直拉通常能通
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
      try {
        delete window[cbName];
        document.head.removeChild(script);
      } catch (e) {}
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

// === Modal ===
async function showNewsModal(sectorName) {
  const modal = document.getElementById('news-modal');
  const titleEl = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  titleEl.textContent = `${sectorName} · 板块要闻`;
  body.innerHTML = '<div class="news-empty">加载中…</div>';
  modal.classList.remove('hidden');

  const items = await fetchNews(sectorName, true);
  if (!items.length) {
    body.innerHTML = `
      <div class="news-empty">
        <p>😅 当前环境拉不到新闻</p>
        <p style="margin-top: 8px; font-size: 12px;">浏览器直接打开网页时通常可以,沙箱可能屏蔽了外网。</p>
      </div>`;
  } else {
    body.innerHTML = items.map(n => `
      <div class="news-item">
        <a href="${escapeAttr(n.url)}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a>
        <div class="url">${escapeHtml(n.url)}</div>
      </div>
    `).join('');
  }
  renderSectors();   // 更新计数
}

// === 事件绑定 ===
function bindEvents() {
  document.getElementById('refresh-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('loading');
    btn.disabled = true;
    STATE.newsCache = {};   // 清缓存,全量重拉
    renderSectors();
    const names = Object.keys(STATE.sectors);
    await Promise.all(names.map(n => fetchNews(n, true)));
    btn.classList.remove('loading');
    btn.disabled = false;
    renderSectors();
    updateLastUpdate();
  });

  document.getElementById('search-input').addEventListener('input', (e) => {
    STATE.keyword = e.target.value;
    renderSectors();
  });

  document.querySelectorAll('.filter-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('.filter-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      STATE.filter = p.dataset.filter;
      renderSectors();
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
}

function updateLastUpdate() {
  const now = new Date();
  document.getElementById('last-update').textContent =
    '更新于 ' + now.toLocaleTimeString('zh-CN', { hour12: false });
}

// === 入口 ===
async function main() {
  bindEvents();
  await loadSectors();
  renderSummary();
  renderSectors();
  updateLastUpdate();
  // 后台预热所有板块的新闻(不阻塞 UI)
  Object.keys(STATE.sectors).forEach(n => fetchNews(n).then(() => renderSectors()));
}

document.addEventListener('DOMContentLoaded', main);

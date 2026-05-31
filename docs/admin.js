(function() {
  var STORAGE_KEY = 'signal-site-content-overrides';
  var PUBLIC_SITE_ORIGIN = 'https://ai-product-daily-35b.pages.dev';
  var SECTIONS = [
    { id: 'today', label: '今日' },
    { id: 'trends', label: '趋势' },
    { id: 'history', label: '历史' }
  ];

  var state = {
    client: null,
    user: null,
    isAdmin: false,
    data: null,
    sourceDoc: null,
    sourceHtml: '',
    fields: [],
    remoteRows: {},
    draftRows: {},
    mergedRows: {},
    visibleMap: {},
    activeSection: 'today',
    activeKey: '',
    hoveredKey: '',
    search: '',
    previewReady: false,
    editMode: false,
    previewMode: 'desktop',
    overlayTimer: null,
    loadTimer: null,
    demoMode: false,
    currentUserId: '',
    adminCheckPromise: null,
    adminCheckUserId: '',
    appBootstrapped: false,
    bootstrapPromise: null,
    lastSyncStatus: '',
    previewScale: 1,
    previewWidth: 1440,
    previewHeight: 900
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function parseJson(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeRow(row) {
    if (!row) return null;
    var key = row.content_key || row.key || '';
    if (!key) return null;
    return {
      content_key: key,
      target_type: row.target_type || 'text',
      label: row.label || key,
      value: row.value == null ? '' : String(row.value),
      selector: row.selector || '',
      attribute: row.attribute || '',
      is_active: row.is_active !== false,
      updated_at: row.updated_at || ''
    };
  }

  function rowsToMap(rows) {
    var map = {};
    (rows || []).map(normalizeRow).filter(Boolean).forEach(function(row) {
      map[row.content_key] = row;
    });
    return map;
  }

  function mapToRows(map) {
    return Object.keys(map || {}).map(function(key) { return map[key]; }).filter(Boolean);
  }

  function getDraftRows() {
    var parsed = parseJson(localStorage.getItem(STORAGE_KEY) || '[]', []);
    if (Array.isArray(parsed)) return parsed.map(normalizeRow).filter(Boolean);
    return Object.keys(parsed || {}).map(function(key) {
      var row = parsed[key] || {};
      row.content_key = row.content_key || key;
      return normalizeRow(row);
    }).filter(Boolean);
  }

  function saveDraftRows() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mapToRows(state.draftRows)));
  }

  function mergeRows() {
    state.mergedRows = {};
    Object.keys(state.remoteRows).forEach(function(key) {
      state.mergedRows[key] = state.remoteRows[key];
    });
    Object.keys(state.draftRows).forEach(function(key) {
      state.mergedRows[key] = state.draftRows[key];
    });
  }

  function getMergedRow(key) {
    return state.mergedRows[key] || null;
  }

  function setStatus(id, text, type) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status-line' + (type ? ' ' + type : '');
  }

  function setSyncStatus(text, type) {
    var el = $('syncStatus');
    if (!el) return;
    var nextStatus = (text || '') + '|' + (type || '');
    if (state.lastSyncStatus === nextStatus) return;
    state.lastSyncStatus = nextStatus;
    el.textContent = text || '';
    el.className = 'status-pill' + (type ? ' ' + type : '');
  }

  function isLocalDemoMode() {
    var local = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
    return local && new URLSearchParams(location.search).has('demo');
  }

  function getSupabaseConfig() {
    return window.SIGNAL_SUPABASE_CONFIG || null;
  }

  function initClient() {
    state.draftRows = rowsToMap(getDraftRows());
    mergeRows();
    state.demoMode = isLocalDemoMode();

    var config = getSupabaseConfig();
    if (!window.supabase || !window.supabase.createClient || !config) {
      setSyncStatus('配置异常', 'error');
      setStatus('authStatus', 'Supabase SDK 或配置未加载。', 'error');
      return;
    }
    state.client = window.supabase.createClient(config.url, config.anonKey);
    if (state.demoMode) {
      state.user = { id: 'local-demo', email: 'local-demo' };
      state.isAdmin = true;
      $('adminUserLabel').textContent = '本地演示';
      $('authWrap').classList.add('hidden');
      $('adminApp').classList.remove('hidden');
      bootstrapApp();
      return;
    }
    state.client.auth.onAuthStateChange(function(event, session) {
      setUser(session && session.user ? session.user : null);
    });
    state.client.auth.getSession().then(function(res) {
      setUser(res.data && res.data.session ? res.data.session.user : null);
    });
  }

  function setUser(user) {
    var nextUserId = user && user.id ? user.id : '';
    if (nextUserId && nextUserId === state.currentUserId && state.isAdmin && state.appBootstrapped) {
      state.user = user;
      $('adminUserLabel').textContent = user && user.email ? user.email : '未登录';
      $('logoutBtn').classList.toggle('hidden', !user);
      return;
    }
    state.user = user || null;
    state.currentUserId = nextUserId;
    $('adminUserLabel').textContent = user && user.email ? user.email : '未登录';
    $('logoutBtn').classList.toggle('hidden', !user);
    if (!user) {
      state.isAdmin = false;
      state.currentUserId = '';
      state.adminCheckPromise = null;
      state.adminCheckUserId = '';
      state.bootstrapPromise = null;
      state.appBootstrapped = false;
      $('authWrap').classList.remove('hidden');
      $('adminApp').classList.add('hidden');
      setSyncStatus('未登录', 'error');
      return;
    }
    checkAdmin();
  }

  function checkAdmin() {
    if (!state.client || !state.user) return;
    var userId = state.user.id;
    if (state.isAdmin && state.adminCheckUserId === userId) {
      $('authWrap').classList.add('hidden');
      $('adminApp').classList.remove('hidden');
      return bootstrapApp();
    }
    if (state.adminCheckPromise && state.adminCheckUserId === userId) return state.adminCheckPromise;
    state.adminCheckUserId = userId;
    if (!state.appBootstrapped) setSyncStatus('校验权限');
    state.adminCheckPromise = state.client
      .from('site_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(function(res) {
        if (res.error) throw res.error;
        if (!state.user || state.user.id !== userId) return;
        state.isAdmin = !!res.data;
        if (!state.isAdmin) {
          showSetupError('当前账号不在 site_admins 白名单中。');
          return;
        }
        $('authWrap').classList.add('hidden');
        $('adminApp').classList.remove('hidden');
        return bootstrapApp();
      })
      .catch(function(err) {
        if (!state.user || state.user.id !== userId) return;
        showSetupError(err.message || String(err));
      })
      .then(function() {
        if (state.adminCheckUserId === userId) state.adminCheckPromise = null;
      });
    return state.adminCheckPromise;
  }

  function showSetupError(message) {
    $('authWrap').classList.remove('hidden');
    $('adminApp').classList.add('hidden');
    setSyncStatus('无权限', 'error');
    setStatus('authStatus', message, 'error');
    var id = state.user && state.user.id ? state.user.id : '把你的 auth.users.id 填到这里';
    var panel = document.querySelector('.auth-panel');
    var old = $('setupHint');
    if (old) old.remove();
    var div = document.createElement('div');
    div.id = 'setupHint';
    div.innerHTML = ''
      + '<div class="auth-desc">把当前账号加入站长白名单：</div>'
      + '<pre class="setup-code">insert into public.site_admins (user_id) values (&#39;' + escapeHtml(id) + '&#39;) on conflict do nothing;</pre>';
    panel.appendChild(div);
  }

  function bootstrapApp() {
    if (state.appBootstrapped) return Promise.resolve();
    if (state.bootstrapPromise) return state.bootstrapPromise;
    setSyncStatus('同步中');
    state.bootstrapPromise = Promise.all([loadRemoteRows(), loadSiteData()])
      .then(function() {
        mergeRows();
        buildCatalog();
        renderAll();
        return loadPreview();
      })
      .then(function() {
        state.appBootstrapped = true;
        setSyncStatus(Object.keys(state.draftRows).length ? '有草稿' : '已同步', Object.keys(state.draftRows).length ? 'draft' : '');
      })
      .catch(function(err) {
        setSyncStatus('加载失败', 'error');
        setStatus('editorStatus', err.message || String(err), 'error');
        state.bootstrapPromise = null;
      });
    return state.bootstrapPromise;
  }

  function loadRemoteRows() {
    return state.client
      .from('site_content_overrides')
      .select('content_key,target_type,label,value,selector,attribute,is_active,updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .then(function(res) {
        if (res.error) throw res.error;
        state.remoteRows = rowsToMap(res.data || []);
      });
  }

  function loadSiteData() {
    return fetch(PUBLIC_SITE_ORIGIN.replace(/\/$/, '') + '/?admin-data=' + Date.now())
      .then(function(res) {
        if (!res.ok) throw new Error('主站读取失败：' + res.status);
        return res.text();
      })
      .then(function(html) {
        state.sourceHtml = html;
        var match = html.match(/var DATA = (.*?);\nvar DIM_COLORS =/s);
        if (!match) throw new Error('无法从主站读取 DATA');
        state.data = JSON.parse(match[1]);
        state.sourceDoc = new DOMParser().parseFromString(html, 'text/html');
      });
  }

  function addField(list, section, key, label, targetType, fallback, extra) {
    extra = extra || {};
    list.push({
      section: section,
      content_key: key,
      label: label,
      target_type: targetType || 'text',
      fallback: fallback == null ? '' : String(fallback),
      selector: extra.selector || '',
      attribute: extra.attribute || '',
      owner: extra.owner || '',
      page: extra.page || section,
      hint: extra.hint || ''
    });
  }

  function buildCatalog() {
    var data = state.data || {};
    var products = data.products || {};
    var assets = data.assets || {};
    var list = [];

    addCorePageFields(list);

    Object.keys(products).sort(function(a, b) {
      var pa = products[a] || {};
      var pb = products[b] || {};
      return (((pb.featured || {}).date || '') + pb.name).localeCompare(((pa.featured || {}).date || '') + pa.name);
    }).forEach(function(id) {
      var p = products[id] || {};
      var sections = getProductSections(p);
      sections.forEach(function(section) {
        addProductFields(list, section, id, p, assets[id] || {});
      });
    });

    Object.keys(state.mergedRows).forEach(function(key) {
      if (list.some(function(field) { return field.content_key === key; })) return;
      var row = state.mergedRows[key];
      addField(list, 'today', key, row.label || key, row.target_type || 'text', row.value || '', {
        selector: row.selector || '',
        attribute: row.attribute || '',
        page: '已发布覆盖',
        hint: row.selector || ''
      });
    });

    state.fields = list;
  }

  function addCorePageFields(list) {
    addField(list, 'today', 'ui.logo.name', '侧边栏 / 站名', 'text', 'Signal', { selector: '.logo-name', page: '全站' });
    addField(list, 'today', 'ui.logo.slogan', '侧边栏 / 副标题', 'text', 'AI产品信号', { selector: '.logo-slogan', page: '全站' });
    addField(list, 'today', 'ui.today.section_title', '今日 / 列表标题', 'text', '今日 5 个 Signal', { selector: '#todayContent .section-title', page: '今日' });

    addField(list, 'trends', 'ui.trends.title', '趋势 / 标题', 'text', '趋势', { selector: '#page-trends .page-title', page: '趋势' });
    addField(list, 'trends', 'ui.trends.subtitle', '趋势 / 副标题', 'text', '跨日期观察哪些内容正在形成兴趣、行动和能力信号', { selector: '#page-trends .page-subtitle', page: '趋势' });
    addField(list, 'trends', 'ui.trends.heat', '趋势 / 热度榜', 'text', '热度榜', { selector: '.trend-tab[data-type="heat"]', page: '趋势' });
    addField(list, 'trends', 'ui.trends.try', '趋势 / 想试榜', 'text', '想试榜', { selector: '.trend-tab[data-type="try"]', page: '趋势' });
    addField(list, 'trends', 'ui.trends.ability', '趋势 / 能力榜', 'text', '能力榜', { selector: '.trend-tab[data-type="ability"]', page: '趋势' });

    addField(list, 'history', 'ui.history.title', '历史 / 标题', 'text', '历史', { selector: '#page-history .page-title', page: '历史' });
    addField(list, 'history', 'ui.history.subtitle', '历史 / 副标题', 'text', '按日期浏览往期速递', { selector: '#page-history .page-subtitle', page: '历史' });
    addField(list, 'history', 'ui.history.picker', '历史 / 日期按钮', 'text', '选择日期 / 月份 ▼', { selector: '.date-picker-btn', page: '历史' });
  }

  function getProductSections(product) {
    var sections = { history: true, trends: true };
    var latest = getLatestFeaturedDate();
    if ((product.featured || {}).date === latest) sections.today = true;
    return Object.keys(sections);
  }

  function getLatestFeaturedDate() {
    var products = (state.data || {}).products || {};
    return Object.keys(products).map(function(id) {
      return ((products[id] || {}).featured || {}).date || '';
    }).filter(Boolean).sort().reverse()[0] || '';
  }

  function addProductFields(list, section, id, product, asset) {
    var owner = product.name || id;
    var page = getSectionLabel(section);
    addField(list, section, 'product.' + id + '.name', owner + ' / 名称', 'text', product.name, { owner: owner, page: page });
    addField(list, section, 'product.' + id + '.tagline', owner + ' / 标语', 'text', product.tagline, { owner: owner, page: page });
    addField(list, section, 'product.' + id + '.description', owner + ' / 描述', 'text', product.description, { owner: owner, page: page });
    addField(list, section, 'product.' + id + '.topics', owner + ' / 标签', 'text', (product.topics || []).join('，'), { owner: owner, page: page, hint: '用逗号或换行分隔' });
    addField(list, section, 'product.' + id + '.website', owner + ' / 官网链接', 'link', product.website, { owner: owner, page: page });
    addField(list, section, 'product.' + id + '.ph_url', owner + ' / 原帖链接', 'link', product.ph_url, { owner: owner, page: page });
    if (product.featured) {
      addField(list, section, 'product.' + id + '.featured.dimension', owner + ' / 推荐维度', 'text', product.featured.dimension || '', { owner: owner, page: page });
    }
    addField(list, section, 'asset.' + id + '.icon', owner + ' / 图标', 'image', asset.icon || '', { owner: owner, page: page });
    addField(list, section, 'asset.' + id + '.screenshot', owner + ' / 头图', 'image', asset.screenshot || '', { owner: owner, page: page });
  }

  function getSectionLabel(section) {
    var found = SECTIONS.filter(function(item) { return item.id === section; })[0];
    return found ? found.label : section;
  }

  function addStaticDomFields(list) {
    var doc = state.sourceDoc;
    if (!doc || !doc.body) return;
    var seen = {};
    Array.prototype.slice.call(doc.body.querySelectorAll('*')).forEach(function(el) {
      var tag = el.tagName.toLowerCase();
      if (/^(script|style|template|noscript|svg|path|meta|link)$/.test(tag)) return;
      var selector = getUniqueSelector(el, doc);
      if (!selector) return;
      if (tag === 'img' && el.getAttribute('src')) {
        var src = el.getAttribute('src') || '';
        var imgKey = 'dom.image.' + hashString(selector + '|' + src);
        if (!seen[imgKey]) {
          seen[imgKey] = true;
          addField(list, 'static', imgKey, '静态图片 / ' + (el.getAttribute('alt') || src.split('/').pop() || selector), 'image', src, {
            selector: selector,
            attribute: 'src',
            page: '静态页面'
          });
        }
      }
      if (el.children.length > 0) return;
      var text = normalizeText(el.textContent || '');
      if (!text || text.length > 120) return;
      if (/^[{}()[\].,;:+\\/\-_*'"`<>]+$/.test(text)) return;
      var key = 'dom.text.' + hashString(selector + '|' + text);
      if (seen[key]) return;
      seen[key] = true;
      addField(list, 'static', key, '静态文案 / ' + text.slice(0, 28), 'text', text, {
        selector: selector,
        page: '静态页面'
      });
    });
  }

  function hashString(value) {
    var hash = 0;
    value = String(value || '');
    for (var i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, function(ch) { return '\\' + ch; });
  }

  function getUniqueSelector(el, doc) {
    if (!el || !doc) return '';
    if (el.id) return '#' + cssEscape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== doc.body) {
      var part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        part += '.' + Array.prototype.slice.call(node.classList).slice(0, 2).map(cssEscape).join('.');
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function(item) { return item.tagName === node.tagName; });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      var selector = parts.join(' > ');
      try {
        if (doc.querySelectorAll(selector).length === 1) return selector;
      } catch (e) {}
      node = parent;
    }
    return parts.join(' > ');
  }

  function renderAll() {
    renderNav();
    renderList();
    renderEditor();
    $('catalogSummary').textContent = state.fields.length + ' 个可编辑内容';
  }

  function renderNav() {
    $('adminNav').innerHTML = SECTIONS.map(function(section) {
      var fields = getFieldsForSection(section.id, true);
      var active = state.activeSection === section.id ? ' active' : '';
      return '<button class="nav-btn' + active + '" onclick="setAdminSection(\'' + section.id + '\')">'
        + '<span>' + escapeHtml(section.label) + '</span><span class="nav-count">' + fields.length + '</span>'
        + '</button>';
    }).join('');
  }

  function getFieldsForSection(section, ignoreSearch) {
    return state.fields.filter(function(field) {
      if (field.section !== section) return false;
      if (ignoreSearch || !state.search) return true;
      var haystack = [field.label, field.content_key, field.owner, field.fallback, field.page].join(' ').toLowerCase();
      return haystack.indexOf(state.search.toLowerCase()) !== -1;
    });
  }

  function renderList() {
    var fields = getFieldsForSection(state.activeSection);
    if (state.activeSection === 'custom') {
      fields = [{
        section: 'custom',
        content_key: '__new_custom__',
        label: '新建自定义覆盖',
        target_type: 'text',
        fallback: '',
        selector: '',
        attribute: '',
        owner: '',
        page: '自定义',
        hint: '为没有自动识别到的元素添加 CSS selector'
      }].concat(fields);
    }
    $('fieldList').innerHTML = fields.map(function(field) {
      var row = getMergedRow(field.content_key);
      var active = state.activeKey === field.content_key ? ' active' : '';
      var visible = state.visibleMap[field.content_key] || 0;
      var badges = '';
      if (visible) badges += '<span class="badge visible">' + visible + '</span>';
      if (state.draftRows[field.content_key]) badges += '<span class="badge changed">草稿</span>';
      else if (state.remoteRows[field.content_key]) badges += '<span class="badge changed">已发</span>';
      if (!badges) badges = '<span class="badge">' + escapeHtml(field.target_type) + '</span>';
      return '<button class="field-row' + active + '" onclick="selectAdminField(\'' + escapeAttr(field.content_key) + '\',true)">'
        + '<span><span class="field-name">' + escapeHtml(field.label) + '</span>'
        + '<span class="field-meta">' + escapeHtml((field.page || '') + ' · ' + (row ? '已覆盖' : field.content_key)) + '</span></span>'
        + '<span class="field-badges">' + badges + '</span>'
        + '</button>';
    }).join('') || '<div class="empty-editor">没有匹配内容</div>';
  }

  function findField(key) {
    var matches = state.fields.filter(function(field) { return field.content_key === key; });
    return matches.filter(function(field) { return field.section === state.activeSection; })[0] || matches[0] || null;
  }

  function renderEditor() {
    var field = findField(state.activeKey);
    $('draftBtn').disabled = !field;
    $('restoreBtn').disabled = !field;
    $('publishBtn').disabled = !field || state.demoMode;
    if (!field) {
      $('editorTitle').textContent = '选择一个页面元素';
      $('editorSubtitle').textContent = state.editMode ? '点击中间预览里的标题、图片或按钮' : '先点击上方“编辑”进入选择模式';
      $('editorBody').innerHTML = '<div class="empty-editor">' + (state.editMode ? '在预览中点选蓝色描边元素' : '当前是正常浏览模式，主站交互保持可用') + '</div>';
      setStatus('editorStatus', '');
      return;
    }

    var row = getMergedRow(field.content_key) || {};
    var value = row.value != null ? row.value : field.fallback;
    var targetType = row.target_type || field.target_type || 'text';
    var selectorValue = row.selector != null ? row.selector : field.selector;
    var attributeValue = row.attribute != null ? row.attribute : field.attribute;
    var keyReadonly = state.activeKey === '__new_custom__' ? '' : ' readonly';

    $('editorTitle').textContent = field.label || '编辑内容';
    $('editorSubtitle').textContent = field.page || field.content_key || '自定义';

    var valueInput = targetType === 'image' || field.target_type === 'image'
      ? '<input class="admin-input" id="editValue" value="' + escapeAttr(value) + '" placeholder="图片 URL" oninput="editorValueChanged()">'
        + '<div class="preview-box" id="imagePreview">' + (value ? '<img src="' + escapeAttr(absolutizeUrl(value)) + '" alt="">' : '暂无图片') + '</div>'
        + '<input class="admin-input" id="imageFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onchange="adminUploadImage()">'
      : '<textarea class="admin-textarea" id="editValue" oninput="editorValueChanged()">' + escapeHtml(value) + '</textarea>';

    $('editorBody').innerHTML = ''
      + '<div class="selected-summary">'
      + '<div class="summary-kicker">' + escapeHtml(field.page || field.section || '') + '</div>'
      + '<div class="summary-title">' + escapeHtml(field.label || field.content_key || '') + '</div>'
      + '<div class="summary-meta">' + escapeHtml(field.content_key || '自定义字段') + '</div>'
      + '</div>'
      + '<div class="form-field"><label class="form-label">覆盖值</label>' + valueInput + '</div>'
      + '<div class="form-field"><label class="form-label">类型</label><select class="admin-select" id="editType" onchange="editorValueChanged()">'
      + optionHtml('text', '文字', targetType)
      + optionHtml('image', '图片', targetType)
      + optionHtml('link', '链接', targetType)
      + '</select></div>'
      + '<details class="selected-summary"><summary class="summary-kicker">高级定位</summary>'
      + '<div class="form-field" style="margin-top:10px"><label class="form-label">字段 key</label><input class="admin-input" id="editKey" value="' + escapeAttr(field.content_key) + '"' + keyReadonly + '></div>'
      + '<div class="form-field"><label class="form-label">后台显示名</label><input class="admin-input" id="editLabel" value="' + escapeAttr(row.label || field.label || '') + '"></div>'
      + '<div class="form-field"><label class="form-label">CSS selector</label><input class="admin-input" id="editSelector" value="' + escapeAttr(selectorValue) + '" placeholder=".card-name"></div>'
      + '<div class="form-field"><label class="form-label">属性名</label><input class="admin-input" id="editAttribute" value="' + escapeAttr(attributeValue) + '" placeholder="src / href / 留空"></div>'
      + '</details>';
  }

  function optionHtml(value, label, current) {
    return '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + label + '</option>';
  }

  function getEditorRow() {
    var field = findField(state.activeKey);
    if (!field) throw new Error('请先选择内容');
    var key = ($('editKey') && $('editKey').value || field.content_key || '').trim();
    var label = ($('editLabel') && $('editLabel').value || field.label || key).trim();
    var type = ($('editType') && $('editType').value || field.target_type || 'text').trim();
    var value = $('editValue') ? $('editValue').value : '';
    var selector = ($('editSelector') && $('editSelector').value || field.selector || '').trim();
    var attribute = ($('editAttribute') && $('editAttribute').value || field.attribute || '').trim();
    if (!key) throw new Error('字段 key 不能为空');
    return {
      content_key: key,
      target_type: type,
      label: label,
      value: value,
      selector: selector,
      attribute: attribute,
      is_active: true
    };
  }

  function updateImagePreview() {
    var box = $('imagePreview');
    var value = $('editValue') ? $('editValue').value.trim() : '';
    if (!box) return;
    box.innerHTML = value ? '<img src="' + escapeAttr(absolutizeUrl(value)) + '" alt="">' : '暂无图片';
  }

  function preparePreviewHtml(html) {
    var rows = mapToRows(state.mergedRows);
    var rowsJson = JSON.stringify(JSON.stringify(rows));
    var base = PUBLIC_SITE_ORIGIN.replace(/\/$/, '') + '/';
    var injectedHead = '<head><base href="' + escapeAttr(base) + '">'
      + '<script>window.__SIGNAL_ADMIN_PREVIEW__=true;try{localStorage.setItem("' + STORAGE_KEY + '",' + rowsJson + ')}catch(e){}<\/script>'
      + '<style id="signal-admin-preview-style">.signal-admin-edit-target{outline:1px solid rgba(0,122,255,.22);outline-offset:2px;cursor:crosshair!important}.signal-admin-edit-target.signal-admin-active{outline:2px solid #FF9500!important}.signal-admin-edit-target.signal-admin-hover{outline:2px solid #30B0C7!important}<\/style>';
    return html.replace(/<head>/i, injectedHead);
  }

  function loadPreview() {
    var frame = $('sitePreview');
    state.previewReady = false;
    clearInterval(state.loadTimer);
    updatePreviewViewport();
    $('previewLoading').classList.remove('hidden');
    $('previewLoading').textContent = '加载主站中...';
    $('previewNote').textContent = '正在准备可编辑画布';
    return new Promise(function(resolve) {
      var settled = false;
      var attempts = 0;
      function finishWhenDomReady() {
        if (settled) return;
        attempts += 1;
        var doc = null;
        try {
          doc = frame.contentDocument;
        } catch (e) {}
        if (doc && doc.body && doc.body.children.length) {
          settled = true;
          clearInterval(state.loadTimer);
          setTimeout(function() {
            initPreviewFrame();
            resolve();
          }, 180);
          return;
        }
        if (attempts > 60) {
          settled = true;
          clearInterval(state.loadTimer);
          $('previewLoading').textContent = '预览加载超时，请点左上角刷新';
          $('previewNote').textContent = '主站预览暂时没有完成加载';
          resolve();
        }
      }
      frame.onload = function() {
        setTimeout(finishWhenDomReady, 120);
      };
      frame.srcdoc = preparePreviewHtml(state.sourceHtml);
      state.loadTimer = setInterval(finishWhenDomReady, 250);
      setTimeout(finishWhenDomReady, 60);
    });
  }

  function initPreviewFrame() {
    var frame = $('sitePreview');
    var doc = frame.contentDocument;
    var win = frame.contentWindow;
    if (!doc || !doc.body) return;
    state.previewReady = true;
    updatePreviewViewport();
    $('previewLoading').classList.add('hidden');
    updateEditModeUi();
    doc.addEventListener('click', onPreviewClick, true);
    doc.addEventListener('mouseover', onPreviewHover, true);
    doc.addEventListener('mouseout', onPreviewOut, true);
    doc.addEventListener('scroll', scheduleOverlay, true);
    win.addEventListener('resize', scheduleOverlay);
    navigatePreviewToSection(state.activeSection);
    setTimeout(markPreviewTargets, 900);
    setTimeout(markPreviewTargets, 1800);
  }

  function markPreviewTargets() {
    var doc = getPreviewDoc();
    if (!doc || !doc.body) return;
    clearPreviewTargets();
    state.visibleMap = {};
    if (!state.editMode) {
      renderNav();
      renderList();
      return;
    }
    state.fields.forEach(function(field) {
      var nodes = locateFieldElements(field, doc).slice(0, 24);
      state.visibleMap[field.content_key] = nodes.length;
      nodes.forEach(function(node) {
        var keys = (node.getAttribute('data-signal-admin-keys') || '').split('|').filter(Boolean);
        if (keys.indexOf(field.content_key) === -1) keys.push(field.content_key);
        node.setAttribute('data-signal-admin-keys', keys.join('|'));
        node.classList.add('signal-admin-edit-target');
      });
    });
    renderNav();
    renderList();
    updatePreviewClasses();
    scheduleOverlay();
  }

  function clearPreviewTargets() {
    var doc = getPreviewDoc();
    var layer = $('overlayLayer');
    if (layer) layer.innerHTML = '';
    if (!doc || !doc.body) return;
    Array.prototype.slice.call(doc.querySelectorAll('[data-signal-admin-keys]')).forEach(function(el) {
      el.removeAttribute('data-signal-admin-keys');
      el.classList.remove('signal-admin-edit-target', 'signal-admin-active', 'signal-admin-hover');
    });
  }

  function getPreviewDoc() {
    var frame = $('sitePreview');
    return frame && frame.contentDocument ? frame.contentDocument : null;
  }

  function locateFieldElements(field, doc) {
    var row = getMergedRow(field.content_key);
    var value = row && row.value !== '' ? row.value : field.fallback;
    var nodes = [];
    if (field.selector || (row && row.selector)) {
      try {
        nodes = nodes.concat(Array.prototype.slice.call(doc.querySelectorAll((row && row.selector) || field.selector)));
      } catch (e) {}
      if (nodes.length) return uniqueNodes(nodes).filter(isElementVisible);
    }
    if (field.target_type === 'image' || (row && row.target_type === 'image')) {
      nodes = nodes.concat(locateImageElements(doc, value || field.fallback));
    } else if (field.target_type === 'link' || (row && row.target_type === 'link')) {
      nodes = nodes.concat(locateLinkElements(doc, value || field.fallback));
    } else {
      nodes = nodes.concat(locateTextElements(doc, value || field.fallback));
      if (field.fallback && field.fallback !== value) nodes = nodes.concat(locateTextElements(doc, field.fallback));
    }
    return uniqueNodes(nodes).filter(isElementVisible);
  }

  function uniqueNodes(nodes) {
    var seen = [];
    return (nodes || []).filter(function(node) {
      if (!node || node.nodeType !== 1) return false;
      if (seen.indexOf(node) !== -1) return false;
      seen.push(node);
      return true;
    });
  }

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 3 || rect.height < 3) return false;
    var view = el.ownerDocument.defaultView;
    var style = view.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
  }

  function locateTextElements(doc, value) {
    value = normalizeText(value);
    if (!value) return [];
    var all = Array.prototype.slice.call(doc.body.querySelectorAll('a,button,h1,h2,h3,h4,p,span,div,summary,label,strong,em'));
    return all.filter(function(el) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) return false;
      var text = normalizeText(el.textContent || '');
      if (text !== value) return false;
      return !Array.prototype.slice.call(el.children || []).some(function(child) {
        return normalizeText(child.textContent || '') === value;
      });
    }).slice(0, 30);
  }

  function locateLinkElements(doc, value) {
    value = String(value || '').trim();
    if (!value) return [];
    return Array.prototype.slice.call(doc.querySelectorAll('a[href]')).filter(function(a) {
      return urlMatches(a.getAttribute('href') || a.href || '', value);
    });
  }

  function locateImageElements(doc, value) {
    value = String(value || '').trim();
    if (!value) return [];
    var mediaNodes = Array.prototype.slice.call(doc.querySelectorAll('img,video,source')).filter(function(el) {
      var src = el.getAttribute('src') || el.currentSrc || '';
      return urlMatches(src, value);
    });
    var backgroundNodes = Array.prototype.slice.call(doc.body.querySelectorAll('*')).filter(function(el) {
      var style = doc.defaultView.getComputedStyle(el);
      var urls = extractCssUrls(style.backgroundImage || '');
      return urls.some(function(url) { return urlMatches(url, value); });
    });
    return uniqueNodes(mediaNodes.concat(backgroundNodes));
  }

  function extractCssUrls(value) {
    var urls = [];
    String(value || '').replace(/url\((['"]?)(.*?)\1\)/g, function(_, quote, url) {
      if (url) urls.push(url);
      return '';
    });
    return urls;
  }

  function urlMatches(actual, expected) {
    if (!actual || !expected) return false;
    var a = absolutizeUrl(actual).split('#')[0].split('?')[0];
    var e = absolutizeUrl(expected).split('#')[0].split('?')[0];
    return a === e || a.endsWith('/' + expected.replace(/^\//, '')) || a.indexOf(expected.replace(/^\//, '')) !== -1;
  }

  function absolutizeUrl(url) {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    return PUBLIC_SITE_ORIGIN.replace(/\/$/, '') + '/' + String(url).replace(/^\//, '');
  }

  function onPreviewClick(event) {
    if (!state.editMode) return;
    var el = getEditableElement(event.target);
    event.preventDefault();
    event.stopPropagation();
    if (!el) return;
    var key = pickBestKey(el.getAttribute('data-signal-admin-keys') || '');
    if (key) selectAdminField(key, false);
  }

  function onPreviewHover(event) {
    if (!state.editMode) return;
    var el = getEditableElement(event.target);
    var key = el ? pickBestKey(el.getAttribute('data-signal-admin-keys') || '') : '';
    if (key !== state.hoveredKey) {
      state.hoveredKey = key;
      updatePreviewClasses();
      scheduleOverlay();
    }
  }

  function onPreviewOut() {
    if (!state.editMode) return;
    state.hoveredKey = '';
    updatePreviewClasses();
    scheduleOverlay();
  }

  function getEditableElement(target) {
    var doc = getPreviewDoc();
    var node = target;
    while (node && node !== doc.body) {
      if (node.getAttribute && node.getAttribute('data-signal-admin-keys')) return node;
      node = node.parentElement;
    }
    return null;
  }

  function pickBestKey(keys) {
    var list = String(keys || '').split('|').filter(Boolean);
    if (!list.length) return '';
    if (state.activeKey && list.indexOf(state.activeKey) !== -1) return state.activeKey;
    var sectionMatch = list.filter(function(key) {
      var field = findField(key);
      return field && field.section === state.activeSection;
    })[0];
    return sectionMatch || list[0];
  }

  function updatePreviewClasses() {
    var doc = getPreviewDoc();
    if (!doc || !doc.body) return;
    Array.prototype.slice.call(doc.querySelectorAll('.signal-admin-active,.signal-admin-hover')).forEach(function(el) {
      el.classList.remove('signal-admin-active', 'signal-admin-hover');
    });
    Array.prototype.slice.call(doc.querySelectorAll('[data-signal-admin-keys]')).forEach(function(el) {
      var keys = (el.getAttribute('data-signal-admin-keys') || '').split('|');
      if (state.activeKey && keys.indexOf(state.activeKey) !== -1) el.classList.add('signal-admin-active');
      if (state.hoveredKey && keys.indexOf(state.hoveredKey) !== -1) el.classList.add('signal-admin-hover');
    });
  }

  function scheduleOverlay() {
    clearTimeout(state.overlayTimer);
    state.overlayTimer = setTimeout(renderOverlay, 30);
  }

  function getPreviewSize() {
    return { width: 1440, height: 900 };
  }

  function updatePreviewViewport() {
    var stage = $('previewStage');
    var viewport = $('previewViewport');
    if (!stage || !viewport) return;
    var size = getPreviewSize();
    var stageRect = stage.getBoundingClientRect();
    var scale = Math.min(stageRect.width / size.width, stageRect.height / size.height, 1);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var visualWidth = size.width * scale;
    var visualHeight = size.height * scale;
    state.previewScale = scale;
    state.previewWidth = size.width;
    state.previewHeight = size.height;
    viewport.style.width = size.width + 'px';
    viewport.style.height = size.height + 'px';
    viewport.style.left = Math.max(0, (stageRect.width - visualWidth) / 2) + 'px';
    viewport.style.top = Math.max(0, (stageRect.height - visualHeight) / 2) + 'px';
    viewport.style.transform = 'scale(' + scale + ')';
  }

  function renderOverlay() {
    updatePreviewViewport();
    var layer = $('overlayLayer');
    var doc = getPreviewDoc();
    if (!layer || !doc || !state.editMode) {
      if (layer) layer.innerHTML = '';
      return;
    }
    var boxes = [];
    var nodes = Array.prototype.slice.call(doc.querySelectorAll('[data-signal-admin-keys]')).filter(isElementVisible).slice(0, 90);
    nodes.forEach(function(node) {
      var keys = (node.getAttribute('data-signal-admin-keys') || '').split('|').filter(Boolean);
      var key = pickBestKey(keys.join('|'));
      var field = findField(key);
      if (!field) return;
      var rect = node.getBoundingClientRect();
      var active = keys.indexOf(state.activeKey) !== -1;
      var hover = keys.indexOf(state.hoveredKey) !== -1;
      var label = active || hover ? '<span class="target-label">' + escapeHtml(field.label) + '</span>' : '';
      boxes.push('<div class="target-box' + (active ? ' active' : '') + (hover ? ' hover' : '') + '" data-admin-keys="' + escapeAttr(keys.join('|')) + '" style="left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px">' + label + '</div>');
    });
    layer.innerHTML = boxes.join('');
  }

  function bindOverlayInteractions() {
    var layer = $('overlayLayer');
    if (!layer) return;
    layer.addEventListener('click', function(event) {
      if (!state.editMode) return;
      var box = event.target.closest && event.target.closest('.target-box');
      event.preventDefault();
      event.stopPropagation();
      if (!box) return;
      var key = pickBestKey(box.getAttribute('data-admin-keys') || '');
      if (key) selectAdminField(key, false);
    });
    layer.addEventListener('mousemove', function(event) {
      if (!state.editMode) return;
      var box = event.target.closest && event.target.closest('.target-box');
      var key = box ? pickBestKey(box.getAttribute('data-admin-keys') || '') : '';
      if (key !== state.hoveredKey) {
        state.hoveredKey = key;
        updatePreviewClasses();
        scheduleOverlay();
      }
    });
    layer.addEventListener('mouseleave', function() {
      if (!state.editMode) return;
      state.hoveredKey = '';
      updatePreviewClasses();
      scheduleOverlay();
    });
  }

  function applyPreviewRows(extraRow) {
    var frame = $('sitePreview');
    var win = frame.contentWindow;
    if (!win) return;
    var rowsMap = {};
    Object.keys(state.remoteRows).forEach(function(key) { rowsMap[key] = state.remoteRows[key]; });
    Object.keys(state.draftRows).forEach(function(key) { rowsMap[key] = state.draftRows[key]; });
    if (extraRow) rowsMap[extraRow.content_key] = extraRow;
    var rows = mapToRows(rowsMap);
    try {
      win.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
      if (win.SignalSiteContent && typeof win.SignalSiteContent.applyRows === 'function') {
        win.SignalSiteContent.applyRows(rows);
        win.dispatchEvent(new win.CustomEvent('signal:content-overrides-updated', { detail: { rows: rows } }));
      }
    } catch (e) {}
    setTimeout(markPreviewTargets, 120);
    setTimeout(markPreviewTargets, 520);
  }

  function scrollSelectedIntoView() {
    var doc = getPreviewDoc();
    var field = findField(state.activeKey);
    if (!doc || !field) return;
    var node = locateFieldElements(field, doc)[0];
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      setTimeout(scheduleOverlay, 260);
    }
  }

  window.adminLogin = function() {
    if (!state.client) return;
    var email = ($('adminEmail').value || '').trim();
    var password = ($('adminPassword').value || '').trim();
    setStatus('authStatus', '登录中...');
    state.client.auth.signInWithPassword({ email: email, password: password }).then(function(res) {
      if (res.error) throw res.error;
      setStatus('authStatus', '');
    }).catch(function(err) {
      setStatus('authStatus', err.message || String(err), 'error');
    });
  };

  window.adminSendMagicLink = function() {
    if (!state.client) return;
    var email = ($('adminEmail').value || '').trim();
    setStatus('authStatus', '发送中...');
    state.client.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.href }
    }).then(function(res) {
      if (res.error) throw res.error;
      setStatus('authStatus', '登录链接已发送。', 'success');
    }).catch(function(err) {
      setStatus('authStatus', err.message || String(err), 'error');
    });
  };

  window.adminLogout = function() {
    if (state.client) state.client.auth.signOut();
  };

  window.setAdminSection = function(section) {
    state.activeSection = section;
    state.activeKey = '';
    state.hoveredKey = '';
    state.search = '';
    if ($('fieldSearch')) $('fieldSearch').value = '';
    renderAll();
    navigatePreviewToSection(section);
  };

  window.setAdminSearch = function(value) {
    state.search = value || '';
    renderList();
  };

  window.selectAdminField = function(key, shouldScroll) {
    if (!state.editMode) {
      state.editMode = true;
      updateEditModeUi();
    }
    state.activeKey = key;
    var field = findField(key);
    if (field) state.activeSection = field.section || state.activeSection;
    renderAll();
    updatePreviewClasses();
    scheduleOverlay();
    if (shouldScroll) scrollSelectedIntoView();
  };

  window.editorValueChanged = function() {
    try {
      var row = getEditorRow();
      updateImagePreview();
      applyPreviewRows(row);
      setStatus('editorStatus', '预览已更新，尚未保存。', 'warning');
      setSyncStatus('有未保存修改', 'draft');
    } catch (err) {
      setStatus('editorStatus', err.message || String(err), 'error');
    }
  };

  window.saveDraftOverride = function() {
    try {
      var row = getEditorRow();
      state.draftRows[row.content_key] = row;
      saveDraftRows();
      mergeRows();
      applyPreviewRows();
      renderAll();
      setStatus('editorStatus', '草稿已保存。', 'success');
      setSyncStatus('有草稿', 'draft');
    } catch (err) {
      setStatus('editorStatus', err.message || String(err), 'error');
    }
  };

  window.publishAdminOverride = function() {
    if (state.demoMode) {
      setStatus('editorStatus', '本地演示模式不发布线上内容。', 'warning');
      return;
    }
    var row;
    try {
      row = getEditorRow();
    } catch (err) {
      setStatus('editorStatus', err.message || String(err), 'error');
      return;
    }
    setStatus('editorStatus', '发布中...');
    state.client
      .from('site_content_overrides')
      .upsert({
        content_key: row.content_key,
        target_type: row.target_type,
        label: row.label,
        value: row.value,
        selector: row.selector,
        attribute: row.attribute,
        is_active: true,
        updated_by: state.user.id
      }, { onConflict: 'content_key' })
      .select('content_key,target_type,label,value,selector,attribute,is_active,updated_at')
      .single()
      .then(function(res) {
        if (res.error) throw res.error;
        var saved = normalizeRow(res.data);
        state.remoteRows[saved.content_key] = saved;
        delete state.draftRows[saved.content_key];
        saveDraftRows();
        mergeRows();
        applyPreviewRows();
        renderAll();
        setStatus('editorStatus', '已发布到主站。', 'success');
        setSyncStatus(Object.keys(state.draftRows).length ? '有草稿' : '已同步', Object.keys(state.draftRows).length ? 'draft' : '');
      })
      .catch(function(err) {
        setStatus('editorStatus', err.message || String(err), 'error');
        setSyncStatus('发布失败', 'error');
      });
  };

  window.deleteAdminOverride = function() {
    var field = findField(state.activeKey);
    var key = ($('editKey') && $('editKey').value || (field && field.content_key) || '').trim();
    if (!key) return;
    delete state.draftRows[key];
    saveDraftRows();
    setStatus('editorStatus', '恢复中...');
    var remote = state.remoteRows[key];
    var done = function() {
      delete state.remoteRows[key];
      mergeRows();
      applyPreviewRows();
      renderAll();
      setStatus('editorStatus', '已恢复默认。', 'success');
      setSyncStatus(Object.keys(state.draftRows).length ? '有草稿' : '已同步', Object.keys(state.draftRows).length ? 'draft' : '');
    };
    if (!remote) {
      done();
      return;
    }
    state.client
      .from('site_content_overrides')
      .delete()
      .eq('content_key', key)
      .then(function(res) {
        if (res.error) throw res.error;
        done();
      })
      .catch(function(err) {
        setStatus('editorStatus', err.message || String(err), 'error');
      });
  };

  window.adminUploadImage = function() {
    if (state.demoMode) {
      setStatus('editorStatus', '本地演示模式不上传图片。', 'warning');
      return;
    }
    var input = $('imageFile');
    var file = input && input.files && input.files[0];
    if (!file || !state.client || !state.user) return;
    var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var path = 'admin/' + state.user.id + '/' + Date.now() + '-' + safeName;
    setStatus('editorStatus', '上传图片中...');
    state.client.storage.from('uploads').upload(path, file, {
      cacheControl: '31536000',
      upsert: true,
      contentType: file.type || 'image/png'
    }).then(function(res) {
      if (res.error) throw res.error;
      var publicRes = state.client.storage.from('uploads').getPublicUrl(path);
      var url = publicRes.data && publicRes.data.publicUrl ? publicRes.data.publicUrl : '';
      $('editValue').value = url;
      updateImagePreview();
      editorValueChanged();
      setStatus('editorStatus', '图片已上传，预览已更新。', 'success');
    }).catch(function(err) {
      setStatus('editorStatus', err.message || String(err), 'error');
    });
  };

  window.reloadAdminPreview = function() {
    loadSiteData().then(function() {
      buildCatalog();
      renderAll();
      return loadPreview();
    }).catch(function(err) {
      setStatus('editorStatus', err.message || String(err), 'error');
    });
  };

  function navigatePreviewToSection(section) {
    var frame = $('sitePreview');
    var win = frame && frame.contentWindow;
    if (!win || typeof win.switchPage !== 'function') {
      markPreviewTargets();
      return;
    }
    var page = section === 'history' ? 'history' : section === 'trends' ? 'trends' : 'today';
    try {
      win.switchPage(page);
    } catch (e) {}
    setTimeout(markPreviewTargets, 160);
    setTimeout(markPreviewTargets, 650);
  }

  function updateEditModeUi() {
    var stage = $('previewStage');
    var btn = $('editModeToggle');
    if (stage) stage.classList.toggle('editing', state.editMode);
    if (btn) {
      btn.classList.toggle('primary', state.editMode);
      btn.textContent = state.editMode ? '退出编辑' : '编辑';
    }
    $('previewNote').textContent = state.editMode
      ? '编辑模式：点击蓝色描边元素修改内容'
      : '正常预览：可点击主站导航和按钮';
    if (state.editMode) {
      markPreviewTargets();
    } else {
      clearPreviewTargets();
      state.hoveredKey = '';
      state.activeKey = '';
      state.visibleMap = {};
      renderAll();
    }
  }

  window.toggleAdminEditMode = function() {
    state.editMode = !state.editMode;
    updateEditModeUi();
  };

  window.toggleAdminOutlines = function() {
    window.toggleAdminEditMode();
  };

  window.setPreviewMode = function(mode) {
    state.previewMode = 'desktop';
    updatePreviewViewport();
    setTimeout(function() {
      updatePreviewViewport();
      scheduleOverlay();
    }, 80);
  };

  window.addEventListener('resize', function() {
    updatePreviewViewport();
    scheduleOverlay();
  });

  document.addEventListener('DOMContentLoaded', function() {
    updatePreviewViewport();
    bindOverlayInteractions();
    initClient();
  });
})();

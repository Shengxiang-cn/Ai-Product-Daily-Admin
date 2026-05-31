(function() {
  var STORAGE_KEY = 'signal-site-content-overrides';
  var PUBLIC_SITE_ORIGIN = 'https://ai-product-daily-35b.pages.dev';
  var SECTIONS = [
    { id: 'today', label: '首页' },
    { id: 'products', label: '产品卡片' },
    { id: 'assets', label: '图片素材' },
    { id: 'skills', label: 'Skill 库' },
    { id: 'profile', label: '个人中心' },
    { id: 'static', label: '静态文案' },
    { id: 'custom', label: '自定义' }
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
    showOutlines: true,
    previewMode: 'desktop',
    overlayTimer: null,
    loadTimer: null,
    demoMode: false,
    currentUserId: '',
    adminCheckPromise: null,
    adminCheckUserId: '',
    appBootstrapped: false,
    bootstrapPromise: null,
    lastSyncStatus: ''
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
    var skills = data.skills || [];
    var list = [];

    addField(list, 'today', 'ui.logo.name', '侧边栏 / 站名', 'text', 'Signal', { selector: '.logo-name', page: '全站' });
    addField(list, 'today', 'ui.logo.slogan', '侧边栏 / 副标题', 'text', 'AI产品信号', { selector: '.logo-slogan', page: '全站' });
    addField(list, 'profile', 'ui.profile.bio', '个人中心 / 简介', 'text', '这里会汇总你发布过的图文、视频、许愿，以及你点赞过的帖子与应用。', { selector: '#profileBio', page: '个人中心' });
    addField(list, 'profile', 'ui.settings.title', '设置页 / 标题', 'text', '设置', { selector: '#page-settings .page-title', page: '设置页' });
    addField(list, 'profile', 'ui.settings.subtitle', '设置页 / 说明', 'text', '管理账号、创作入口和显示模式', { selector: '#page-settings .page-subtitle', page: '设置页' });

    Object.keys(products).sort(function(a, b) {
      var pa = products[a] || {};
      var pb = products[b] || {};
      return (((pb.featured || {}).date || '') + pb.name).localeCompare(((pa.featured || {}).date || '') + pa.name);
    }).forEach(function(id) {
      var p = products[id] || {};
      var owner = p.name || id;
      addField(list, 'products', 'product.' + id + '.name', owner + ' / 名称', 'text', p.name, { owner: owner, page: '产品卡片' });
      addField(list, 'products', 'product.' + id + '.tagline', owner + ' / 标语', 'text', p.tagline, { owner: owner, page: '产品卡片' });
      addField(list, 'products', 'product.' + id + '.description', owner + ' / 描述', 'text', p.description, { owner: owner, page: '产品详情' });
      addField(list, 'products', 'product.' + id + '.topics', owner + ' / 标签', 'text', (p.topics || []).join('，'), { owner: owner, page: '产品卡片', hint: '用逗号或换行分隔' });
      addField(list, 'products', 'product.' + id + '.website', owner + ' / 官网链接', 'link', p.website, { owner: owner, page: '产品卡片' });
      addField(list, 'products', 'product.' + id + '.ph_url', owner + ' / 原帖链接', 'link', p.ph_url, { owner: owner, page: '产品卡片' });
      if (p.featured) {
        addField(list, 'today', 'product.' + id + '.featured.dimension', owner + ' / 推荐维度', 'text', p.featured.dimension || '', { owner: owner, page: '首页' });
        var a = p.featured.analysis || {};
        addField(list, 'products', 'product.' + id + '.featured.analysis.ai_changed', owner + ' / 能力变化', 'text', a.ai_changed || '', { owner: owner, page: '分析' });
        addField(list, 'products', 'product.' + id + '.featured.analysis.product_decision', owner + ' / 关注理由', 'text', a.product_decision || '', { owner: owner, page: '分析' });
        addField(list, 'products', 'product.' + id + '.featured.analysis.learnable', owner + ' / 可借鉴点', 'text', a.learnable || '', { owner: owner, page: '分析' });
      }
      addField(list, 'assets', 'asset.' + id + '.icon', owner + ' / 图标', 'image', (assets[id] || {}).icon || '', { owner: owner, page: '产品卡片' });
      addField(list, 'assets', 'asset.' + id + '.screenshot', owner + ' / 头图', 'image', (assets[id] || {}).screenshot || '', { owner: owner, page: '产品详情' });
    });

    skills.forEach(function(skill) {
      var id = skill.id;
      var owner = skill.name || id;
      addField(list, 'skills', 'skill.' + id + '.name', owner + ' / 名称', 'text', skill.name, { owner: owner, page: 'Skill 库' });
      addField(list, 'skills', 'skill.' + id + '.description', owner + ' / 描述', 'text', skill.description, { owner: owner, page: 'Skill 库' });
      addField(list, 'skills', 'skill.' + id + '.summary', owner + ' / 摘要', 'text', skill.summary, { owner: owner, page: 'Skill 详情' });
      addField(list, 'skills', 'skill.' + id + '.category', owner + ' / 分类', 'text', skill.category, { owner: owner, page: 'Skill 库' });
      addField(list, 'skills', 'skill.' + id + '.tags', owner + ' / 标签', 'text', (skill.tags || []).join('，'), { owner: owner, page: 'Skill 详情', hint: '用逗号或换行分隔' });
      addField(list, 'skills', 'skill.' + id + '.source_url', owner + ' / 源仓库', 'link', skill.source_url, { owner: owner, page: 'Skill 详情' });
      addField(list, 'skills', 'skill.' + id + '.install_command', owner + ' / 安装命令', 'text', skill.install_command, { owner: owner, page: 'Skill 详情' });
    });

    addStaticDomFields(list);

    Object.keys(state.mergedRows).forEach(function(key) {
      if (list.some(function(field) { return field.content_key === key; })) return;
      var row = state.mergedRows[key];
      addField(list, 'custom', key, row.label || key, row.target_type || 'text', row.value || '', {
        selector: row.selector || '',
        attribute: row.attribute || '',
        page: '自定义',
        hint: row.selector || ''
      });
    });

    state.fields = list;
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
    if (key === '__new_custom__') {
      return {
        section: 'custom',
        content_key: '',
        label: '新建自定义覆盖',
        target_type: 'text',
        fallback: '',
        selector: '',
        attribute: '',
        owner: '',
        page: '自定义',
        hint: ''
      };
    }
    return state.fields.filter(function(field) { return field.content_key === key; })[0] || null;
  }

  function renderEditor() {
    var field = findField(state.activeKey);
    $('draftBtn').disabled = !field;
    $('restoreBtn').disabled = !field;
    $('publishBtn').disabled = !field || state.demoMode;
    if (!field) {
      $('editorTitle').textContent = '选择一个页面元素';
      $('editorSubtitle').textContent = '点击中间预览里的标题、图片或按钮';
      $('editorBody').innerHTML = '<div class="empty-editor">在预览中点选蓝色描边元素</div>';
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
    if (state.activeSection === 'custom' && !selector) throw new Error('自定义覆盖必须填写 CSS selector');
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
    var prepared = html.replace(/<head>/i, injectedHead);
    prepared = prepared.replace(/<\/body>/i, '<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a){e.preventDefault()}},true);<\/script></body>');
    return prepared;
  }

  function loadPreview() {
    var frame = $('sitePreview');
    state.previewReady = false;
    clearInterval(state.loadTimer);
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
    $('previewLoading').classList.add('hidden');
    $('previewNote').textContent = '点击蓝色描边内容开始编辑';
    doc.addEventListener('click', onPreviewClick, true);
    doc.addEventListener('mouseover', onPreviewHover, true);
    doc.addEventListener('mouseout', onPreviewOut, true);
    doc.addEventListener('scroll', scheduleOverlay, true);
    win.addEventListener('resize', scheduleOverlay);
    markPreviewTargets();
    setTimeout(markPreviewTargets, 900);
    setTimeout(markPreviewTargets, 1800);
  }

  function markPreviewTargets() {
    var doc = getPreviewDoc();
    if (!doc || !doc.body) return;
    Array.prototype.slice.call(doc.querySelectorAll('[data-signal-admin-keys]')).forEach(function(el) {
      el.removeAttribute('data-signal-admin-keys');
      el.classList.remove('signal-admin-edit-target', 'signal-admin-active', 'signal-admin-hover');
    });
    state.visibleMap = {};
    state.fields.forEach(function(field) {
      if (field.content_key === '__new_custom__') return;
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
    var el = getEditableElement(event.target);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    var key = pickBestKey(el.getAttribute('data-signal-admin-keys') || '');
    if (key) selectAdminField(key, false);
  }

  function onPreviewHover(event) {
    var el = getEditableElement(event.target);
    var key = el ? pickBestKey(el.getAttribute('data-signal-admin-keys') || '') : '';
    if (key !== state.hoveredKey) {
      state.hoveredKey = key;
      updatePreviewClasses();
      scheduleOverlay();
    }
  }

  function onPreviewOut() {
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

  function renderOverlay() {
    var layer = $('overlayLayer');
    var doc = getPreviewDoc();
    if (!layer || !doc || !state.showOutlines) {
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
      boxes.push('<div class="target-box' + (active ? ' active' : '') + (hover ? ' hover' : '') + '" style="left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px">' + label + '</div>');
    });
    layer.innerHTML = boxes.join('');
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
    state.search = '';
    if ($('fieldSearch')) $('fieldSearch').value = '';
    renderNav();
    renderList();
    scheduleOverlay();
  };

  window.setAdminSearch = function(value) {
    state.search = value || '';
    renderList();
  };

  window.selectAdminField = function(key, shouldScroll) {
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

  window.toggleAdminOutlines = function() {
    state.showOutlines = !state.showOutlines;
    $('outlineToggle').classList.toggle('primary', state.showOutlines);
    scheduleOverlay();
  };

  window.setPreviewMode = function(mode) {
    state.previewMode = mode;
    $('previewStage').classList.toggle('mobile', mode === 'mobile');
    $('desktopModeBtn').classList.toggle('active', mode === 'desktop');
    $('mobileModeBtn').classList.toggle('active', mode === 'mobile');
    setTimeout(scheduleOverlay, 80);
  };

  document.addEventListener('DOMContentLoaded', initClient);
})();

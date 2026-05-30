(function() {
  var STORAGE_KEY = 'signal-site-content-overrides';
  var PUBLIC_SITE_ORIGIN = 'https://ai-product-daily-35b.pages.dev';
  var SECTIONS = [
    { id: 'ui', label: '全站文字' },
    { id: 'static', label: '页面静态文案' },
    { id: 'products', label: '产品文字' },
    { id: 'assets', label: '图片素材' },
    { id: 'skills', label: 'Skill 文案' },
    { id: 'custom', label: '自定义覆盖' }
  ];

  var state = {
    client: null,
    user: null,
    isAdmin: false,
    data: null,
    sourceDoc: null,
    catalog: [],
    overrides: {},
    activeSection: 'ui',
    activeKey: '',
    search: ''
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
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, function(ch) {
      return '\\' + ch;
    });
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
        var siblings = Array.prototype.filter.call(parent.children, function(item) {
          return item.tagName === node.tagName;
        });
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

  function getLocalRows() {
    try {
      var rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(rows) ? rows.map(normalizeRow).filter(Boolean) : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalRows(rows) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows || []));
  }

  function mergeLocalRow(row) {
    var rows = getLocalRows().filter(function(item) { return item.content_key !== row.content_key; });
    rows.push(row);
    saveLocalRows(rows);
  }

  function removeLocalRow(key) {
    saveLocalRows(getLocalRows().filter(function(item) { return item.content_key !== key; }));
  }

  function setStatus(id, text, type) {
    var el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status-line' + (type ? ' ' + type : '');
  }

  function getSupabaseConfig() {
    return window.SIGNAL_SUPABASE_CONFIG || null;
  }

  function initClient() {
    var config = getSupabaseConfig();
    if (!window.supabase || !window.supabase.createClient || !config) {
      setStatus('authStatus', 'Supabase SDK 或配置未加载，无法使用远程后台。', 'error');
      return;
    }
    state.client = window.supabase.createClient(config.url, config.anonKey);
    state.client.auth.onAuthStateChange(function(event, session) {
      setUser(session && session.user ? session.user : null);
    });
    state.client.auth.getSession().then(function(res) {
      setUser(res.data && res.data.session ? res.data.session.user : null);
    });
  }

  function setUser(user) {
    state.user = user || null;
    $('adminUserLabel').textContent = user && user.email ? user.email : '未登录';
    $('logoutBtn').classList.toggle('hidden', !user);
    if (!user) {
      state.isAdmin = false;
      $('authWrap').classList.remove('hidden');
      $('adminApp').classList.add('hidden');
      return;
    }
    checkAdmin();
  }

  function checkAdmin() {
    if (!state.client || !state.user) return;
    state.client
      .from('site_admins')
      .select('user_id')
      .eq('user_id', state.user.id)
      .maybeSingle()
      .then(function(res) {
        if (res.error) {
          state.isAdmin = false;
          showSetupError(res.error.message || String(res.error));
          return;
        }
        state.isAdmin = !!res.data;
        if (!state.isAdmin) {
          showSetupError('当前账号不在 site_admins 白名单中。');
          return;
        }
        $('authWrap').classList.add('hidden');
        $('adminApp').classList.remove('hidden');
        bootstrapApp();
      });
  }

  function showSetupError(message) {
    $('authWrap').classList.remove('hidden');
    $('adminApp').classList.add('hidden');
    setStatus('authStatus', message, 'error');
    var id = state.user && state.user.id ? state.user.id : '把你的 auth.users.id 填到这里';
    var panel = document.querySelector('.auth-panel');
    var old = $('setupHint');
    if (old) old.remove();
    var div = document.createElement('div');
    div.id = 'setupHint';
    div.innerHTML = ''
      + '<div class="auth-desc">先在 Supabase SQL Editor 执行 `supabase-setup.sql` 里的站点后台部分，然后把当前账号加入白名单：</div>'
      + '<pre class="setup-code">insert into public.site_admins (user_id) values (&#39;' + escapeHtml(id) + '&#39;) on conflict do nothing;</pre>';
    panel.appendChild(div);
  }

  function loadSiteData() {
    return fetch(PUBLIC_SITE_ORIGIN.replace(/\/$/, '') + '/index.html?admin-data=' + Date.now())
      .then(function(res) { return res.text(); })
      .then(function(html) {
        var match = html.match(/var DATA = (.*?);\nvar DIM_COLORS =/s);
        if (!match) throw new Error('无法从 index.html 读取 DATA');
        state.data = JSON.parse(match[1]);
        state.sourceDoc = new DOMParser().parseFromString(html, 'text/html');
      });
  }

  function loadOverrides() {
    return state.client
      .from('site_content_overrides')
      .select('content_key,target_type,label,value,selector,attribute,is_active,updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .then(function(res) {
        if (res.error) throw res.error;
        state.overrides = {};
        (res.data || []).map(normalizeRow).filter(Boolean).forEach(function(row) {
          state.overrides[row.content_key] = row;
        });
        saveLocalRows(Object.keys(state.overrides).map(function(key) { return state.overrides[key]; }));
      });
  }

  function bootstrapApp() {
    Promise.all([loadSiteData(), loadOverrides()])
      .then(function() {
        buildCatalog();
        renderNav();
        renderList();
        renderEditor();
      })
      .catch(function(err) {
        setStatus('authStatus', err.message || String(err), 'error');
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
      hint: extra.hint || ''
    });
  }

  function buildCatalog() {
    var data = state.data || {};
    var products = data.products || {};
    var assets = data.assets || {};
    var skills = data.skills || [];
    var list = [];

    addField(list, 'ui', 'ui.logo.name', '侧边栏站名', 'text', 'Signal', { selector: '.logo-name' });
    addField(list, 'ui', 'ui.logo.slogan', '侧边栏副标题', 'text', 'AI产品信号', { selector: '.logo-slogan' });
    addField(list, 'ui', 'ui.settings.title', '设置页标题', 'text', '设置', { selector: '#page-settings .page-title' });
    addField(list, 'ui', 'ui.settings.subtitle', '设置页说明', 'text', '管理账号、创作入口和显示模式', { selector: '#page-settings .page-subtitle' });
    addField(list, 'ui', 'ui.profile.bio', '个人中心默认说明', 'text', '这里会汇总你发布过的图文、视频、许愿，以及你点赞过的帖子与应用。', { selector: '#profileBio' });
    addStaticDomFields(list);

    Object.keys(products).sort().forEach(function(id) {
      var p = products[id] || {};
      var owner = p.name || id;
      addField(list, 'products', 'product.' + id + '.name', owner + ' / 名称', 'text', p.name, { owner: owner });
      addField(list, 'products', 'product.' + id + '.tagline', owner + ' / 标语', 'text', p.tagline, { owner: owner });
      addField(list, 'products', 'product.' + id + '.description', owner + ' / 描述', 'text', p.description, { owner: owner });
      addField(list, 'products', 'product.' + id + '.topics', owner + ' / 标签', 'text', (p.topics || []).join('，'), { owner: owner, hint: '用逗号或换行分隔' });
      addField(list, 'products', 'product.' + id + '.website', owner + ' / 官网链接', 'link', p.website, { owner: owner });
      addField(list, 'products', 'product.' + id + '.ph_url', owner + ' / 来源链接', 'link', p.ph_url, { owner: owner });
      if (p.featured) {
        addField(list, 'products', 'product.' + id + '.featured.dimension', owner + ' / 推荐维度', 'text', p.featured.dimension || '', { owner: owner });
        var a = p.featured.analysis || {};
        addField(list, 'products', 'product.' + id + '.featured.analysis.ai_changed', owner + ' / 能力变化', 'text', a.ai_changed || '', { owner: owner });
        addField(list, 'products', 'product.' + id + '.featured.analysis.product_decision', owner + ' / 关注理由', 'text', a.product_decision || '', { owner: owner });
        addField(list, 'products', 'product.' + id + '.featured.analysis.learnable', owner + ' / 可借鉴点', 'text', a.learnable || '', { owner: owner });
      }
      addField(list, 'assets', 'asset.' + id + '.icon', owner + ' / 图标', 'image', (assets[id] || {}).icon || '', { owner: owner });
      addField(list, 'assets', 'asset.' + id + '.screenshot', owner + ' / 头图或截图', 'image', (assets[id] || {}).screenshot || '', { owner: owner });
    });

    skills.forEach(function(skill) {
      var id = skill.id;
      var owner = skill.name || id;
      addField(list, 'skills', 'skill.' + id + '.name', owner + ' / 名称', 'text', skill.name, { owner: owner });
      addField(list, 'skills', 'skill.' + id + '.description', owner + ' / 描述', 'text', skill.description, { owner: owner });
      addField(list, 'skills', 'skill.' + id + '.summary', owner + ' / 摘要', 'text', skill.summary, { owner: owner });
      addField(list, 'skills', 'skill.' + id + '.category', owner + ' / 分类', 'text', skill.category, { owner: owner });
      addField(list, 'skills', 'skill.' + id + '.tags', owner + ' / 标签', 'text', (skill.tags || []).join('，'), { owner: owner, hint: '用逗号或换行分隔' });
      addField(list, 'skills', 'skill.' + id + '.source_url', owner + ' / 源码链接', 'link', skill.source_url, { owner: owner });
      addField(list, 'skills', 'skill.' + id + '.install_command', owner + ' / 安装命令', 'text', skill.install_command, { owner: owner });
    });

    Object.keys(state.overrides).forEach(function(key) {
      var exists = list.some(function(field) { return field.content_key === key; });
      if (!exists) {
        var row = state.overrides[key];
        addField(list, 'custom', key, row.label || key, row.target_type || 'text', '', {
          selector: row.selector || '',
          attribute: row.attribute || '',
          hint: '自定义 CSS selector 覆盖'
        });
      }
    });

    state.catalog = list;
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
            hint: selector
          });
        }
      }

      if (el.children.length > 0) return;
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) return;
      if (/^[{}()[\].,;:+\\/\-_*'"`<>]+$/.test(text)) return;
      var key = 'dom.text.' + hashString(selector + '|' + text);
      if (seen[key]) return;
      seen[key] = true;
      addField(list, 'static', key, '静态文案 / ' + text.slice(0, 28), 'text', text, {
        selector: selector,
        hint: selector
      });
    });
  }

  function renderNav() {
    $('adminNav').innerHTML = SECTIONS.map(function(section) {
      var count = getFieldsForSection(section.id).length;
      return '<button class="nav-btn' + (state.activeSection === section.id ? ' active' : '') + '" onclick="setAdminSection(\'' + section.id + '\')">'
        + escapeHtml(section.label) + ' · ' + count
        + '</button>';
    }).join('');
  }

  function getFieldsForSection(section) {
    return state.catalog.filter(function(field) {
      if (field.section !== section) return false;
      if (!state.search) return true;
      var haystack = [field.label, field.content_key, field.owner, field.fallback].join(' ').toLowerCase();
      return haystack.indexOf(state.search.toLowerCase()) !== -1;
    });
  }

  function renderList() {
    var section = SECTIONS.filter(function(item) { return item.id === state.activeSection; })[0] || SECTIONS[0];
    $('listTitle').textContent = section.label;
    $('listSubtitle').textContent = state.activeSection === 'custom'
      ? '用 CSS selector 覆盖任意文字、链接或图片'
      : '选择字段后保存覆盖值，原始数据不会被删除';

    var rows = getFieldsForSection(state.activeSection);
    if (state.activeSection === 'custom') {
      rows = [{
        section: 'custom',
        content_key: '__new_custom__',
        label: '新建自定义覆盖',
        target_type: 'text',
        fallback: '',
        selector: '',
        attribute: '',
        hint: '适合临时替换未收录字段'
      }].concat(rows);
    }

    $('fieldList').innerHTML = rows.map(function(field) {
      var override = state.overrides[field.content_key];
      var active = state.activeKey === field.content_key ? ' active' : '';
      var badge = override ? '<span class="field-badge">已覆盖</span>' : '<span class="field-badge empty">' + escapeHtml(field.target_type) + '</span>';
      return '<button class="field-row' + active + '" onclick="selectAdminField(\'' + escapeHtml(field.content_key) + '\')">'
        + '<span><span class="field-label">' + escapeHtml(field.label) + '</span>'
        + '<span class="field-meta">' + escapeHtml(field.content_key) + '</span></span>'
        + badge
        + '</button>';
    }).join('') || '<div class="status-line">没有匹配字段。</div>';
  }

  function findField(key) {
    if (key === '__new_custom__') {
      return {
        section: 'custom',
        content_key: '',
        label: '',
        target_type: 'text',
        fallback: '',
        selector: '',
        attribute: ''
      };
    }
    return state.catalog.filter(function(field) { return field.content_key === key; })[0] || null;
  }

  function renderEditor() {
    var field = findField(state.activeKey);
    if (!field) {
      $('editorTitle').textContent = '选择一个字段';
      $('editorSubtitle').textContent = '保存后主站会通过覆盖配置显示新内容';
      $('editorBody').innerHTML = '<div class="status-line">左侧选择字段开始编辑。</div>';
      return;
    }

    var override = state.overrides[field.content_key] || {};
    var isCustomNew = state.activeKey === '__new_custom__';
    var value = override.value != null ? override.value : field.fallback;
    var keyReadonly = isCustomNew ? '' : ' readonly';
    var selectorValue = override.selector != null ? override.selector : field.selector;
    var attributeValue = override.attribute != null ? override.attribute : field.attribute;
    var targetType = override.target_type || field.target_type || 'text';

    $('editorTitle').textContent = isCustomNew ? '新建自定义覆盖' : field.label;
    $('editorSubtitle').textContent = isCustomNew ? '使用 CSS selector 指向要替换的页面元素' : field.content_key;

    var inputHtml = targetType === 'image' || field.target_type === 'image'
      ? '<input class="admin-input" id="editValue" value="' + escapeHtml(value) + '" placeholder="图片 URL">'
        + '<div class="preview-box" id="imagePreview">' + (value ? '<img src="' + escapeHtml(value) + '" alt="">' : '暂无图片') + '</div>'
        + '<input class="admin-input" id="imageFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onchange="adminUploadImage()">'
      : '<textarea class="admin-textarea" id="editValue">' + escapeHtml(value) + '</textarea>';

    $('editorBody').innerHTML = ''
      + '<div class="form-field"><label class="form-label">字段 key</label><input class="admin-input" id="editKey" value="' + escapeHtml(field.content_key) + '"' + keyReadonly + '></div>'
      + '<div class="form-field"><label class="form-label">后台显示名</label><input class="admin-input" id="editLabel" value="' + escapeHtml(override.label || field.label) + '"></div>'
      + '<div class="form-field"><label class="form-label">类型</label><select class="admin-select" id="editType">'
      + optionHtml('text', '文字', targetType)
      + optionHtml('image', '图片', targetType)
      + optionHtml('link', '链接', targetType)
      + '</select></div>'
      + '<div class="form-field"><label class="form-label">覆盖值</label>' + inputHtml + '</div>'
      + '<div class="form-field"><label class="form-label">CSS selector</label><input class="admin-input" id="editSelector" value="' + escapeHtml(selectorValue) + '" placeholder=".logo-name 或 #hero img"></div>'
      + '<div class="form-field"><label class="form-label">属性名</label><input class="admin-input" id="editAttribute" value="' + escapeHtml(attributeValue) + '" placeholder="留空表示替换文字；图片默认替换 src 或背景图"></div>'
      + (field.hint ? '<div class="status-line">' + escapeHtml(field.hint) + '</div>' : '')
      + '<div class="editor-actions">'
      + '<button class="admin-btn" onclick="previewAdminOverride()">本地预览</button>'
      + '<button class="admin-btn danger" onclick="deleteAdminOverride()">恢复默认</button>'
      + '<button class="admin-btn primary" onclick="saveAdminOverride()">保存到后台</button>'
      + '</div>'
      + '<div class="status-line" id="editorStatus"></div>';

    var editValue = $('editValue');
    if (editValue && (targetType === 'image' || field.target_type === 'image')) {
      editValue.addEventListener('input', updateImagePreview);
    }
  }

  function optionHtml(value, label, current) {
    return '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + label + '</option>';
  }

  function getEditorRow() {
    var key = ($('editKey') && $('editKey').value || '').trim();
    var label = ($('editLabel') && $('editLabel').value || key).trim();
    var type = ($('editType') && $('editType').value || 'text').trim();
    var value = $('editValue') ? $('editValue').value : '';
    var selector = ($('editSelector') && $('editSelector').value || '').trim();
    var attribute = ($('editAttribute') && $('editAttribute').value || '').trim();
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
    box.innerHTML = value ? '<img src="' + escapeHtml(value) + '" alt="">' : '暂无图片';
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
    renderNav();
    renderList();
    renderEditor();
  };

  window.setAdminSearch = function(value) {
    state.search = value || '';
    renderList();
  };

  window.selectAdminField = function(key) {
    state.activeKey = key;
    renderList();
    renderEditor();
  };

  window.previewAdminOverride = function() {
    try {
      var row = getEditorRow();
      mergeLocalRow(row);
      state.overrides[row.content_key] = row;
      window.dispatchEvent(new CustomEvent('signal:content-overrides-updated', { detail: { rows: getLocalRows() } }));
      setStatus('editorStatus', '已写入本地预览。打开主站可看到本机效果。', 'success');
      buildCatalog();
      renderNav();
      renderList();
    } catch (err) {
      setStatus('editorStatus', err.message || String(err), 'error');
    }
  };

  window.saveAdminOverride = function() {
    var row;
    try {
      row = getEditorRow();
    } catch (err) {
      setStatus('editorStatus', err.message || String(err), 'error');
      return;
    }
    setStatus('editorStatus', '保存中...');
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
        state.overrides[saved.content_key] = saved;
        mergeLocalRow(saved);
        buildCatalog();
        renderNav();
        renderList();
        state.activeKey = saved.content_key;
        renderEditor();
        setStatus('editorStatus', '已保存。刷新主站后会读取这条覆盖。', 'success');
      })
      .catch(function(err) {
        setStatus('editorStatus', err.message || String(err), 'error');
      });
  };

  window.deleteAdminOverride = function() {
    var key = ($('editKey') && $('editKey').value || '').trim();
    if (!key) return;
    setStatus('editorStatus', '恢复中...');
    state.client
      .from('site_content_overrides')
      .delete()
      .eq('content_key', key)
      .then(function(res) {
        if (res.error) throw res.error;
        delete state.overrides[key];
        removeLocalRow(key);
        buildCatalog();
        renderNav();
        renderList();
        renderEditor();
        setStatus('editorStatus', '已恢复默认。', 'success');
      })
      .catch(function(err) {
        setStatus('editorStatus', err.message || String(err), 'error');
      });
  };

  window.adminUploadImage = function() {
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
      setStatus('editorStatus', '图片已上传，点击保存到后台生效。', 'success');
    }).catch(function(err) {
      setStatus('editorStatus', err.message || String(err), 'error');
    });
  };

  document.addEventListener('DOMContentLoaded', initClient);
})();

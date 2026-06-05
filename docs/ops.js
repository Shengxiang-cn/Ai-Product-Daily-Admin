(function() {
  var RANGE_LABELS = {
    today: '今天',
    yesterday: '昨天',
    '7d': '最近 7 天',
    '30d': '最近 30 天'
  };

  var TREND_LABELS = {
    watchList: '观察榜',
    tryList: '想试榜',
    newWorksList: '新作榜',
    capabilityList: '能力榜',
    opportunityList: '机会榜'
  };

  var PAGE_OPTIONS = ['', 'today', 'history', 'trends', 'skills', 'skill-demo', 'discover', 'wish', 'creator', 'settings', 'profile'];
  var TREND_OPTIONS = ['', 'watchList', 'tryList', 'newWorksList', 'capabilityList', 'opportunityList'];
  var TYPE_OPTIONS = ['', 'product', 'demo', 'skill', 'opportunity', 'wish', 'post'];

  var ACTION_LABELS = {
    exposure: '曝光',
    contentClick: '点击',
    expand: '展开',
    detailClick: '详情',
    save: '收藏',
    officialClick: '官网点击',
    demoClick: 'Demo 点击',
    productHuntClick: 'Product Hunt 点击',
    githubClick: 'GitHub 点击',
    copyInstall: '复制安装命令',
    skillTrial: 'Skill 试用',
    wantTry: '我想试',
    wantToo: '我也想要',
    comment: '评论',
    wishSubmit: '许愿',
    canBuild: '我能做一个'
  };

  var ACTION_BREAKDOWN_KEYS = [
    'officialClick',
    'demoClick',
    'productHuntClick',
    'githubClick',
    'copyInstall',
    'skillTrial',
    'wantTry',
    'wantToo',
    'comment',
    'wishSubmit',
    'canBuild'
  ];

  var SIGNAL_DEFINITIONS = [
    {
      key: 'interest',
      title: '兴趣',
      desc: '由点击、展开、详情、收藏、原帖点击等有效兴趣行为构成；曝光不计入兴趣，只作为转化分母。',
      sourceKeys: ['contentClick', 'expand', 'detailClick', 'save', 'productHuntClick']
    },
    {
      key: 'try',
      title: '想试',
      desc: '由我想试、Demo 点击、官网点击等试用意图构成。',
      sourceKeys: ['wantTry', 'demoClick', 'officialClick']
    },
    {
      key: 'reuse',
      title: '复用',
      desc: '由 GitHub 点击、复制安装命令、Skill 试用等可复用行为构成。',
      sourceKeys: ['githubClick', 'copyInstall', 'skillTrial']
    },
    {
      key: 'resonance',
      title: '共鸣',
      desc: '由我也想要、评论、许愿、我能做一个等需求共鸣行为构成。',
      sourceKeys: ['wantToo', 'comment', 'wishSubmit', 'canBuild']
    }
  ];

  var EVENT_NAME_COMPAT = {
    try: ['trend_want_try_click'],
    reuse: ['trend_command_copy', 'skill_install_copy', 'skill_source_click', 'skill_trial_start', 'skill_trial_complete'],
    resonance: ['trend_want_too_click', 'wish_comment_submit', 'wish_submit_success', 'wish_like_click'],
    outbound: ['trend_link_click', 'skill_source_click', 'today_outbound_click'],
    interest: ['trend_item_expand', 'today_card_click', 'today_hero_detail_click', 'discover_card_click', 'wish_card_click', 'skill_card_click']
  };

  var state = {
    client: null,
    user: null,
    range: 'today',
    page: '',
    trend: '',
    type: '',
    tag: '',
    sort: 'chain',
    view: 'dashboard',
    events: [],
    filteredEvents: [],
    expandedContentKey: '',
    initialized: false,
    mounted: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function fmt(n) {
    n = Number(n || 0);
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + 'w';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(n);
  }

  function pct(part, total) {
    if (!total) return '--';
    return Math.round(part / total * 100) + '%';
  }

  function pctNumber(part, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round(part / total * 100)));
  }

  function parsePayload(event) {
    var payload = event && event.payload;
    if (!payload) return {};
    if (typeof payload === 'object') return payload;
    try {
      return JSON.parse(payload);
    } catch (e) {
      return {};
    }
  }

  function getAction(event) {
    return event.action || parsePayload(event).action || '';
  }

  function eventNameIn(event, names) {
    return names.indexOf(event.event_name || '') !== -1;
  }

  function createActionCounts() {
    var counts = {};
    Object.keys(ACTION_LABELS).forEach(function(key) { counts[key] = 0; });
    return counts;
  }

  function addActionCounts(target, source) {
    Object.keys(ACTION_LABELS).forEach(function(key) {
      target[key] = (target[key] || 0) + (source[key] || 0);
    });
  }

  function sumActionKeys(actions, keys) {
    return keys.reduce(function(sum, key) { return sum + (actions[key] || 0); }, 0);
  }

  function getPayloadText(event) {
    var payload = parsePayload(event);
    return [
      payload.link_label,
      payload.link_url,
      payload.source_url,
      payload.url,
      payload.title,
      event.target_type,
      event.content_type,
      event.page,
      event.event_name,
      event.action
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function getAtomicActions(event) {
    var actions = createActionCounts();
    var action = getAction(event);
    var name = event.event_name || '';
    var text = getPayloadText(event);
    var contentType = getContentType(event);
    var isLinkClick = action === 'open_link' || /link_click/.test(name);

    if (action === 'impression' || name === 'trend_item_impression') actions.exposure += 1;
    if (action === 'click' || /card_click/.test(name)) actions.contentClick += 1;
    if (action === 'expand' || name === 'trend_item_expand') actions.expand += 1;
    if (action === 'open_detail' || /detail_click/.test(name)) actions.detailClick += 1;
    if (action === 'save' || action === 'favorite' || /favorite|save|collect/.test(name)) actions.save += 1;

    if (isLinkClick && /官网|official|website|site|主页|产品页/.test(text) && !/producthunt|github/.test(text)) actions.officialClick += 1;
    if (isLinkClick && /demo|试用|体验|preview|playground/.test(text) && contentType !== 'skill') actions.demoClick += 1;
    if (isLinkClick && /producthunt|product hunt|原帖|ph_url/.test(text)) actions.productHuntClick += 1;
    if (action === 'open_source' || name === 'skill_source_click' || (isLinkClick && /github|源码|source/.test(text))) actions.githubClick += 1;
    if (action === 'copy_command' || action === 'copy_install_command' || name === 'trend_command_copy' || name === 'skill_install_copy') actions.copyInstall += 1;
    if (action === 'trial_start' || action === 'trial_complete' || name === 'skill_trial_start' || name === 'skill_trial_complete' || name === 'skill_demo_try_click' || (action === 'try_demo' && contentType === 'skill')) actions.skillTrial += 1;
    if (action === 'want_try' || name === 'trend_want_try_click') actions.wantTry += 1;
    if (action === 'want_too' || action === 'like_or_me_too' || name === 'trend_want_too_click' || name === 'wish_like_click') actions.wantToo += 1;
    if (action === 'comment_submit' || name === 'wish_comment_submit') actions.comment += 1;
    if (action === 'submit_success' || name === 'wish_submit_success') actions.wishSubmit += 1;
    if (action === 'can_build' || action === 'open_creator' || /我能做一个|can_build|creator_cta/.test(text) || name === 'opportunity_can_build_click') actions.canBuild += 1;

    return actions;
  }

  function getSignalValueFromActions(actions, signalKey) {
    var def = SIGNAL_DEFINITIONS.filter(function(item) { return item.key === signalKey; })[0];
    return def ? sumActionKeys(actions, def.sourceKeys) : 0;
  }

  function getKeyActionCount(actions) {
    return sumActionKeys(actions, ACTION_BREAKDOWN_KEYS);
  }

  function isInterestEvent(event) {
    return getSignalValueFromActions(getAtomicActions(event), 'interest') > 0 || eventNameIn(event, EVENT_NAME_COMPAT.interest);
  }

  function isTryEvent(event) {
    return getSignalValueFromActions(getAtomicActions(event), 'try') > 0 || eventNameIn(event, EVENT_NAME_COMPAT.try);
  }

  function isReuseEvent(event) {
    return getSignalValueFromActions(getAtomicActions(event), 'reuse') > 0 || eventNameIn(event, EVENT_NAME_COMPAT.reuse);
  }

  function isResonanceEvent(event) {
    return getSignalValueFromActions(getAtomicActions(event), 'resonance') > 0 || eventNameIn(event, EVENT_NAME_COMPAT.resonance);
  }

  function isOutboundEvent(event) {
    var actions = getAtomicActions(event);
    return actions.officialClick + actions.demoClick + actions.productHuntClick + actions.githubClick > 0
      || eventNameIn(event, EVENT_NAME_COMPAT.outbound);
  }

  function getActorId(event) {
    return event.user_id || event.anonymous_id || '';
  }

  function getSessionKey(event) {
    return event.session_id || event.anonymous_id || event.user_id || '';
  }

  function getTrendTab(event) {
    return parsePayload(event).trend_tab || '';
  }

  function getEventTags(event) {
    var tags = parsePayload(event).tags;
    if (!tags) return [];
    if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
    if (typeof tags === 'string') return tags.split(/[,，、]/).map(function(tag) { return tag.trim(); }).filter(Boolean);
    return [];
  }

  function getEventTitle(event) {
    return parsePayload(event).title || event.content_id || '';
  }

  function getContentType(event) {
    return event.content_type || parsePayload(event).content_type || '';
  }

  function getRangeBounds(range) {
    var now = new Date();
    var end = new Date(now);
    var start = new Date(now);
    if (range === 'today') {
      start.setHours(0, 0, 0, 0);
    } else if (range === 'yesterday') {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
    } else if (range === '30d') {
      start.setDate(start.getDate() - 30);
    } else {
      start.setDate(start.getDate() - 7);
    }
    return { start: start, end: end };
  }

  function maskUser(event) {
    var id = event.user_id || event.anonymous_id || '';
    if (!id) return '--';
    return String(id).slice(0, 8);
  }

  function renderOptions(select, values, labels) {
    if (!select) return;
    select.innerHTML = values.map(function(value) {
      var text = value ? ((labels && labels[value]) || value) : '全部';
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(text) + '</option>';
    }).join('');
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    renderOptions($('pageFilter'), PAGE_OPTIONS);
    renderOptions($('trendFilter'), TREND_OPTIONS, TREND_LABELS);
    renderOptions($('typeFilter'), TYPE_OPTIONS);
    bindUI();
  }

  function bindUI() {
    if ($('authForm')) $('authForm').addEventListener('submit', function(event) {
      event.preventDefault();
      login();
    });
    if ($('refreshBtn')) $('refreshBtn').addEventListener('click', fetchEvents);
    if ($('signOutBtn')) $('signOutBtn').addEventListener('click', signOut);
    if ($('copyEventsBtn')) $('copyEventsBtn').addEventListener('click', copyEventsJson);
    if ($('pageFilter')) $('pageFilter').addEventListener('change', function(event) {
      state.page = event.target.value;
      applyFilters();
    });
    if ($('trendFilter')) $('trendFilter').addEventListener('change', function(event) {
      state.trend = event.target.value;
      applyFilters();
    });
    if ($('typeFilter')) $('typeFilter').addEventListener('change', function(event) {
      state.type = event.target.value;
      applyFilters();
    });
    if ($('contentSort')) $('contentSort').addEventListener('change', function(event) {
      state.sort = event.target.value;
      renderDashboard();
    });
    if ($('viewTabs')) $('viewTabs').addEventListener('click', function(event) {
      var btn = event.target.closest('button[data-view]');
      if (!btn) return;
      state.view = btn.getAttribute('data-view') || 'dashboard';
      Array.prototype.forEach.call($('viewTabs').querySelectorAll('button'), function(item) {
        item.classList.toggle('active', item === btn);
      });
      applyViewMode();
    });
    if ($('rangeTabs')) $('rangeTabs').addEventListener('click', function(event) {
      var btn = event.target.closest('button[data-range]');
      if (!btn) return;
      state.range = btn.getAttribute('data-range');
      Array.prototype.forEach.call($('rangeTabs').querySelectorAll('button'), function(item) {
        item.classList.toggle('active', item === btn);
      });
      fetchEvents();
    });
  }

  function mount(client, user) {
    init();
    state.client = client || state.client;
    state.user = user || state.user;
    state.mounted = !!(state.client && state.user);
    updateAuthState();
    if (state.mounted) fetchEvents();
  }

  function initClient() {
    var config = window.SIGNAL_OPS_SUPABASE_CONFIG || {};
    if (!window.supabase || !window.supabase.createClient || !config.url || !config.anonKey) {
      showStatus('Supabase 客户端未就绪，无法加载运营数据。', '请检查 ops-dashboard/config.js 和 Supabase CDN 是否正常加载。');
      return;
    }
    state.client = window.supabase.createClient(config.url, config.anonKey);
    state.client.auth.onAuthStateChange(function(_event, session) {
      state.user = session && session.user ? session.user : null;
      updateAuthState();
      if (state.user) fetchEvents();
    });
    state.client.auth.getSession().then(function(res) {
      state.user = res.data && res.data.session ? res.data.session.user : null;
      updateAuthState();
      if (state.user) fetchEvents();
    }).catch(function(error) {
      showStatus('无法恢复登录状态。', error.message || String(error));
    });
  }

  function updateAuthState() {
    if ($('authCard')) $('authCard').hidden = !!state.user;
    if ($('toolbar')) $('toolbar').hidden = !state.user;
    if (!state.user) {
      if ($('dashboard')) $('dashboard').hidden = true;
      if ($('userPill')) $('userPill').textContent = '未登录';
      return;
    }
    if ($('userPill')) $('userPill').textContent = (state.user.email || state.user.id || '').replace(/(.{2}).*(@.*)/, '$1***$2');
  }

  function login() {
    if (!state.client) return;
    var email = $('authEmail').value.trim();
    var password = $('authPassword').value.trim();
    if ($('authState')) $('authState').textContent = '登录中...';
    state.client.auth.signInWithPassword({ email: email, password: password }).then(function(res) {
      if (res.error) {
        if ($('authState')) $('authState').textContent = res.error.message || '登录失败';
        return;
      }
      if ($('authState')) $('authState').textContent = '';
    }).catch(function(error) {
      if ($('authState')) $('authState').textContent = error.message || '登录失败';
    });
  }

  function signOut() {
    if (!state.client) return;
    state.client.auth.signOut();
    state.events = [];
    state.filteredEvents = [];
    if ($('dashboard')) $('dashboard').hidden = true;
    showStatus('已退出后台。', '重新登录后可以继续查看运营数据。');
  }

  function fetchEvents() {
    if (!state.client || !state.user) return;
    hideStatus();
    if ($('dashboard')) $('dashboard').hidden = true;
    if ($('refreshBtn')) {
      $('refreshBtn').disabled = true;
      $('refreshBtn').textContent = '加载中';
    }

    ensureAdminAccess().then(function(ok) {
      if (!ok) {
        if ($('refreshBtn')) {
          $('refreshBtn').disabled = false;
          $('refreshBtn').textContent = '刷新数据';
        }
        return;
      }
      queryEvents();
    }).catch(function(error) {
      if ($('refreshBtn')) {
        $('refreshBtn').disabled = false;
        $('refreshBtn').textContent = '刷新数据';
      }
      handleQueryError(error);
    });
  }

  function ensureAdminAccess() {
    return state.client
      .from('site_admins')
      .select('user_id')
      .eq('user_id', state.user.id)
      .maybeSingle()
      .then(function(res) {
        if (res.error) {
          var message = (res.error.message || '').toLowerCase();
          if (message.indexOf('site_admins') !== -1 || String(res.error.code) === '42P01') {
            showStatus('没有找到 site_admins 后台白名单表。', '请先配置控制后台权限，并把当前账号加入 public.site_admins。');
            return false;
          }
          throw res.error;
        }
        if (!res.data || res.data.user_id !== state.user.id) {
          showStatus('当前账号没有读取 analytics_events 的权限。', '请把当前 Supabase Auth 用户 ID 加入 public.site_admins。');
          return false;
        }
        return true;
      });
  }

  function queryEvents() {
    var bounds = getRangeBounds(state.range);
    var query = state.client
      .from('analytics_events')
      .select('*')
      .gte('created_at', bounds.start.toISOString())
      .lt('created_at', bounds.end.toISOString())
      .order('created_at', { ascending: false })
      .limit(10000);

    query.then(function(res) {
      if ($('refreshBtn')) {
        $('refreshBtn').disabled = false;
        $('refreshBtn').textContent = '刷新数据';
      }
      if (res.error) {
        handleQueryError(res.error);
        return;
      }
      state.events = Array.isArray(res.data) ? res.data : [];
      applyFilters();
    }).catch(function(error) {
      if ($('refreshBtn')) {
        $('refreshBtn').disabled = false;
        $('refreshBtn').textContent = '刷新数据';
      }
      handleQueryError(error);
    });
  }

  function handleQueryError(error) {
    var message = (error && (error.message || error.details || error.hint || error.code)) || String(error);
    var lower = message.toLowerCase();
    if (lower.indexOf('analytics_events') !== -1 && (lower.indexOf('does not exist') !== -1 || lower.indexOf('could not find') !== -1 || String(error.code) === '42P01')) {
      showStatus('没有找到 analytics_events 表。', '请先执行埋点任务中的 Supabase SQL。');
      return;
    }
    if (lower.indexOf('permission') !== -1 || lower.indexOf('rls') !== -1 || String(error.code) === '42501') {
      showStatus('当前账号没有读取 analytics_events 的权限。', '请检查 Supabase RLS 策略，或把当前用户加入 public.site_admins。');
      return;
    }
    showStatus('运营数据查询失败。', message);
  }

  function showStatus(title, detail) {
    $('statusCard').hidden = false;
    $('statusCard').innerHTML = '<strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(detail || '') + '</span>';
  }

  function hideStatus() {
    $('statusCard').hidden = true;
    $('statusCard').innerHTML = '';
  }

  function applyFilters() {
    var filtered = state.events.filter(function(event) {
      if (state.page && event.page !== state.page) return false;
      if (state.trend && getTrendTab(event) !== state.trend) return false;
      if (state.type && getContentType(event) !== state.type) return false;
      if (state.tag && getEventTags(event).indexOf(state.tag) === -1) return false;
      return true;
    });
    state.filteredEvents = filtered;
    renderTagFilter();
    renderDashboard();
  }

  function renderTagFilter() {
    var counts = {};
    state.events.forEach(function(event) {
      getEventTags(event).forEach(function(tag) { counts[tag] = (counts[tag] || 0) + 1; });
    });
    var tags = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; }).slice(0, 24);
    $('tagFilter').innerHTML = '<button class="tag-chip' + (!state.tag ? ' active' : '') + '" data-tag="">全部标签</button>'
      + tags.map(function(tag) {
        return '<button class="tag-chip' + (state.tag === tag ? ' active' : '') + '" data-tag="' + escapeHtml(tag) + '">' + escapeHtml(tag) + ' ' + counts[tag] + '</button>';
      }).join('');
    Array.prototype.forEach.call($('tagFilter').querySelectorAll('button'), function(btn) {
      btn.addEventListener('click', function() {
        state.tag = btn.getAttribute('data-tag') || '';
        applyFilters();
      });
    });
  }

  function buildModel(events) {
    var actors = {};
    var sessions = {};
    var counts = {
      total: events.length,
      users: 0,
      sessions: 0,
      pageViews: 0,
      trendViews: 0,
      exposure: 0,
      actions: createActionCounts(),
      interest: 0,
      try: 0,
      reuse: 0,
      resonance: 0,
      outbound: 0
    };
    var trends = {};
    var content = {};
    var tags = {};

    Object.keys(TREND_LABELS).forEach(function(tab) {
      trends[tab] = createTrendStats(tab);
    });

    events.forEach(function(event) {
      var eventActions = getAtomicActions(event);
      var actor = getActorId(event);
      if (actor) actors[actor] = true;
      var session = getSessionKey(event);
      if (session) sessions[session] = true;
      if (event.event_name === 'page_view') counts.pageViews += 1;
      if (event.event_name === 'trend_page_view' || (event.page === 'trends' && getAction(event) === 'view')) counts.trendViews += 1;
      addActionCounts(counts.actions, eventActions);
      counts.exposure += eventActions.exposure;
      counts.interest += getSignalValueFromActions(eventActions, 'interest');
      counts.try += getSignalValueFromActions(eventActions, 'try');
      counts.reuse += getSignalValueFromActions(eventActions, 'reuse');
      counts.resonance += getSignalValueFromActions(eventActions, 'resonance');
      counts.outbound += eventActions.officialClick + eventActions.demoClick + eventActions.productHuntClick + eventActions.githubClick;

      var tab = getTrendTab(event);
      if (tab && !trends[tab]) trends[tab] = createTrendStats(tab);
      if (tab) addTrendEvent(trends[tab], event, eventActions);

      var contentId = event.content_id || '';
      if (contentId) {
        var key = contentId + '::' + getContentType(event);
        if (!content[key]) content[key] = createContentStats(contentId, getContentType(event));
        addContentEvent(content[key], event, eventActions);
      }

      getEventTags(event).forEach(function(tag) {
        if (!tags[tag]) tags[tag] = createTagStats(tag);
        addTagEvent(tags[tag], event, eventActions);
      });
    });
    counts.users = Object.keys(actors).length;
    counts.sessions = Object.keys(sessions).length;

    return {
      counts: counts,
      trends: Object.keys(trends).map(function(key) { return finalizeTrendStats(trends[key]); }),
      content: Object.keys(content).map(function(key) { return finalizeContentStats(content[key]); }),
      tags: Object.keys(tags).map(function(key) { return finalizeTagStats(tags[key]); }),
      events: events
    };
  }

  function createTrendStats(tab) {
    return {
      tab: tab,
      label: TREND_LABELS[tab] || tab,
      exposure: 0,
      actions: createActionCounts(),
      expand: 0,
      detail: 0,
      save: 0,
      try: 0,
      outbound: 0,
      copy: 0,
      wantToo: 0,
      keyActions: 0,
      boardScore: 0,
      interest: 0,
      reuse: 0,
      resonance: 0,
      total: 0,
      items: {}
    };
  }

  function addTrendEvent(stats, event, eventActions) {
    eventActions = eventActions || getAtomicActions(event);
    stats.total += 1;
    addActionCounts(stats.actions, eventActions);
    stats.exposure += eventActions.exposure;
    stats.expand += eventActions.expand;
    stats.detail += eventActions.detailClick;
    stats.save += eventActions.save;
    stats.try += eventActions.wantTry + eventActions.demoClick + eventActions.officialClick;
    stats.outbound += eventActions.officialClick + eventActions.demoClick + eventActions.productHuntClick + eventActions.githubClick;
    stats.copy += eventActions.copyInstall;
    stats.wantToo += eventActions.wantToo;
    stats.keyActions += getKeyActionCount(eventActions);
    stats.interest += getSignalValueFromActions(eventActions, 'interest');
    stats.reuse += getSignalValueFromActions(eventActions, 'reuse');
    stats.resonance += getSignalValueFromActions(eventActions, 'resonance');

    var contentId = event.content_id || '';
    if (contentId) {
      var itemKey = contentId + '::' + getContentType(event);
      if (!stats.items[itemKey]) stats.items[itemKey] = createTrendItemStats(contentId, getContentType(event), stats.tab);
      addTrendItemEvent(stats.items[itemKey], event, eventActions);
    }
  }

  function finalizeTrendStats(stats) {
    stats.ctr = stats.exposure ? stats.expand / stats.exposure : 0;
    stats.detailRate = stats.exposure ? stats.detail / stats.exposure : 0;
    stats.saveRate = stats.exposure ? stats.save / stats.exposure : 0;
    stats.boardScore = getTrendBoardScore(stats);
    stats.decision = getTrendDecision(stats);
    stats.itemList = Object.keys(stats.items).map(function(key) {
      return finalizeTrendItemStats(stats.items[key]);
    }).sort(function(a, b) {
      return b.boardScore - a.boardScore || b.keyActions - a.keyActions || b.click - a.click || b.exposure - a.exposure || b.total - a.total;
    });
    return stats;
  }

  function createTrendItemStats(id, type, tab) {
    return {
      id: id,
      type: type || '',
      tab: tab,
      title: id,
      actions: createActionCounts(),
      exposure: 0,
      click: 0,
      expand: 0,
      detail: 0,
      keyActions: 0,
      interest: 0,
      try: 0,
      reuse: 0,
      resonance: 0,
      outbound: 0,
      total: 0
    };
  }

  function addTrendItemEvent(stats, event, eventActions) {
    stats.total += 1;
    if (getEventTitle(event)) stats.title = getEventTitle(event);
    addActionCounts(stats.actions, eventActions);
    stats.exposure += eventActions.exposure;
    stats.click += eventActions.contentClick + eventActions.expand + eventActions.detailClick;
    stats.expand += eventActions.expand;
    stats.detail += eventActions.detailClick;
    stats.keyActions += getKeyActionCount(eventActions);
    stats.interest += getSignalValueFromActions(eventActions, 'interest');
    stats.try += getSignalValueFromActions(eventActions, 'try');
    stats.reuse += getSignalValueFromActions(eventActions, 'reuse');
    stats.resonance += getSignalValueFromActions(eventActions, 'resonance');
    stats.outbound += eventActions.officialClick + eventActions.demoClick + eventActions.productHuntClick + eventActions.githubClick;
  }

  function finalizeTrendItemStats(stats) {
    stats.boardScore = getTrendBoardScore(stats);
    stats.clickRate = stats.exposure ? stats.click / stats.exposure : 0;
    stats.keyActionRate = stats.exposure ? stats.keyActions / stats.exposure : 0;
    stats.decision = getTrendDecision(stats);
    return stats;
  }

  function createContentStats(id, type) {
    return {
      id: id,
      type: type || '',
      title: id,
      pages: {},
      tags: {},
      actions: createActionCounts(),
      chainSessions: {
        exposure: {},
        engagement: {},
        keyActions: {}
      },
      exposure: 0,
      click: 0,
      detail: 0,
      keyActions: 0,
      try: 0,
      reuse: 0,
      resonance: 0,
      outbound: 0,
      interest: 0,
      total: 0,
      events: []
    };
  }

  function addContentEvent(stats, event, eventActions) {
    eventActions = eventActions || getAtomicActions(event);
    stats.total += 1;
    stats.events.push(event);
    if (getEventTitle(event)) stats.title = getEventTitle(event);
    if (event.page) stats.pages[event.page] = (stats.pages[event.page] || 0) + 1;
    getEventTags(event).forEach(function(tag) { stats.tags[tag] = true; });
    addActionCounts(stats.actions, eventActions);
    var sessionKey = getSessionKey(event);
    stats.exposure += eventActions.exposure;
    stats.click += eventActions.contentClick + eventActions.expand + eventActions.detailClick;
    stats.detail += eventActions.detailClick;
    stats.keyActions += getKeyActionCount(eventActions);
    if (sessionKey && eventActions.exposure) stats.chainSessions.exposure[sessionKey] = true;
    if (sessionKey && eventActions.contentClick + eventActions.expand + eventActions.detailClick > 0) stats.chainSessions.engagement[sessionKey] = true;
    if (sessionKey && getKeyActionCount(eventActions) > 0) stats.chainSessions.keyActions[sessionKey] = true;
    stats.try += getSignalValueFromActions(eventActions, 'try');
    stats.reuse += getSignalValueFromActions(eventActions, 'reuse');
    stats.resonance += getSignalValueFromActions(eventActions, 'resonance');
    stats.outbound += eventActions.officialClick + eventActions.demoClick + eventActions.productHuntClick + eventActions.githubClick;
    stats.interest += getSignalValueFromActions(eventActions, 'interest');
  }

  function finalizeContentStats(stats) {
    stats.tagsList = Object.keys(stats.tags);
    stats.mainPage = Object.keys(stats.pages).sort(function(a, b) { return stats.pages[b] - stats.pages[a]; })[0] || '';
    stats.chain = {
      exposure: stats.exposure,
      engagement: stats.click,
      keyActions: stats.keyActions,
      exposureSessions: Object.keys(stats.chainSessions.exposure).length,
      engagementSessions: Object.keys(stats.chainSessions.engagement).length,
      keyActionSessions: Object.keys(stats.chainSessions.keyActions).length,
      engagementRate: Object.keys(stats.chainSessions.exposure).length ? Math.min(Object.keys(stats.chainSessions.engagement).length, Object.keys(stats.chainSessions.exposure).length) / Object.keys(stats.chainSessions.exposure).length : 0,
      keyActionRate: Object.keys(stats.chainSessions.exposure).length ? Math.min(Object.keys(stats.chainSessions.keyActions).length, Object.keys(stats.chainSessions.exposure).length) / Object.keys(stats.chainSessions.exposure).length : 0
    };
    stats.advice = getContentAdvice(stats);
    stats.events = stats.events.slice(0, 8);
    return stats;
  }

  function createTagStats(tag) {
    return {
      tag: tag,
      eventCount: 0,
      contents: {},
      actions: createActionCounts(),
      click: 0,
      try: 0,
      reuse: 0,
      resonance: 0
    };
  }

  function addTagEvent(stats, event, eventActions) {
    eventActions = eventActions || getAtomicActions(event);
    stats.eventCount += 1;
    if (event.content_id) stats.contents[event.content_id] = true;
    addActionCounts(stats.actions, eventActions);
    stats.click += getSignalValueFromActions(eventActions, 'interest');
    stats.try += getSignalValueFromActions(eventActions, 'try');
    stats.reuse += getSignalValueFromActions(eventActions, 'reuse');
    stats.resonance += getSignalValueFromActions(eventActions, 'resonance');
  }

  function finalizeTagStats(stats) {
    stats.contentCount = Object.keys(stats.contents).length;
    stats.decision = getTagDecision(stats);
    return stats;
  }

  function getTrendBoardScore(stats) {
    var actions = stats.actions || {};
    if (stats.tab === 'watchList') {
      return stats.expand + stats.detail + actions.save;
    }
    if (stats.tab === 'tryList') {
      return actions.wantTry + actions.demoClick + actions.officialClick;
    }
    if (stats.tab === 'newWorksList') {
      return actions.detailClick + actions.demoClick + actions.canBuild;
    }
    if (stats.tab === 'capabilityList') {
      return actions.githubClick + actions.copyInstall + actions.skillTrial;
    }
    if (stats.tab === 'opportunityList') {
      return actions.wantToo + actions.comment + actions.wishSubmit + actions.canBuild;
    }
    return stats.interest + stats.try + stats.reuse + stats.resonance;
  }

  function getTrendDecision(stats) {
    var actions = stats.actions || {};
    if (stats.tab === 'watchList') {
      if (stats.exposure >= 10 && stats.ctr < 0.08 && stats.detailRate < 0.08) return '曝光有了，兴趣不足';
      if (stats.ctr >= 0.25 || stats.detailRate >= 0.2) return '继续观察，可补详情';
      if (actions.save > 0) return '有收藏意图，适合留在观察榜';
      return '观察口径：看展开/详情/收藏';
    }
    if (stats.tab === 'tryList') {
      if (actions.wantTry + actions.demoClick + actions.officialClick >= 3) return '试用意图强，适合前排';
      if (stats.exposure >= 8 && actions.wantTry + actions.demoClick + actions.officialClick === 0) return '曝光未转试用';
      return '想试口径：看我想试/Demo/官网';
    }
    if (stats.tab === 'newWorksList') {
      if (actions.detailClick + actions.demoClick + actions.canBuild >= 3) return '新作有验证价值';
      return '新作口径：看详情/Demo/创作者入口';
    }
    if (stats.tab === 'capabilityList') {
      if (actions.githubClick + actions.copyInstall + actions.skillTrial >= 3) return '复用意图强，适合能力榜';
      if (actions.githubClick || actions.copyInstall) return '已有复用信号';
      return '能力口径：看 GitHub/复制/试用';
    }
    if (stats.tab === 'opportunityList') {
      if (actions.wantToo + actions.comment + actions.wishSubmit + actions.canBuild >= 3) return '需求共鸣强，适合机会验证';
      if (actions.wantToo || actions.comment) return '有共鸣，继续收集';
      return '机会口径：看共鸣/评论/许愿';
    }
    return '继续观察';
  }

  function getContentAdvice(item) {
    if (item.try >= 2 && item.outbound >= 2) return '保留在想试榜 / 做体验内容';
    if (item.reuse >= 2) return '加入能力榜 / Skill 精选';
    if (item.resonance >= 2) return '进入机会榜 / 做 Demo';
    if (item.click >= 3 && item.try + item.reuse + item.resonance === 0) return '继续观察，不急着投入';
    if (item.exposure >= 10 && item.click === 0) return '标题或卡片弱，考虑下榜';
    return '观察下一轮信号';
  }

  function getTagDecision(tag) {
    if (tag.eventCount < 3) return '样本不足';
    if (tag.try >= tag.reuse && tag.try >= tag.resonance && tag.try > 0) return '适合继续做内容种草';
    if (tag.reuse >= tag.try && tag.reuse >= tag.resonance && tag.reuse > 0) return '适合扩 Skill / Agent 能力';
    if (tag.resonance > 0) return '适合做机会验证 / App Demo';
    return '继续观察';
  }

  function renderDashboard() {
    var model = buildModel(state.filteredEvents);
    $('dashboard').hidden = false;
    $('dataNote').textContent = RANGE_LABELS[state.range] + ' · ' + fmt(state.filteredEvents.length) + ' 条事件';
    $('dashboardNote').textContent = RANGE_LABELS[state.range] + ' · ' + fmt(state.filteredEvents.length) + ' 条事件';
    if (!state.events.length) {
      showStatus('当前时间范围内还没有埋点数据。', '请确认前台已接入 trackEvent，并且 analytics_events 表允许写入。');
    } else {
      hideStatus();
    }
    renderVisualDashboard(model);
    renderInsights(model);
    renderSignalCards(model);
    renderFunnels(model);
    renderTrendBoard(model);
    renderFocusContent(model);
    renderHeatCloud(model);
    renderContentBoard(model);
    renderEventTable(model);
    renderRawSummary(model);
    applyViewMode();
  }

  function applyViewMode() {
    var root = $('dashboard');
    if (!root) return;
    root.setAttribute('data-view', state.view);
    Array.prototype.forEach.call(root.querySelectorAll('.mode-dashboard, .mode-cards, .mode-raw'), function(section) {
      var visible = section.classList.contains('mode-' + state.view);
      section.hidden = !visible;
    });
  }

  function renderVisualDashboard(model) {
    renderCockpitHero(model);
    renderSignalDonut(model);
    renderSparkPanel(model);
    renderTrendColumnChart(model);
    renderFunnelVisual(model);
    renderSignalRadar(model);
    renderContentBubbleChart(model);
  }

  function renderCockpitHero(model) {
    var insights = buildInsights(model);
    var main = insights[0] || { title: '等待信号进入', body: '当前筛选范围内暂时没有足够数据。' };
    var exposureSessions = countUniqueSessions(model.events, function(e) { return getAtomicActions(e).exposure > 0; });
    var keyActionSessions = countUniqueSessions(model.events, function(e) { return getKeyActionCount(getAtomicActions(e)) > 0; });
    var actionRate = pct(Math.min(keyActionSessions, exposureSessions), exposureSessions);
    $('cockpitHero').innerHTML = ''
      + '<div class="cockpit-label">当前最重要结论</div>'
      + '<h3>' + escapeHtml(main.title) + '</h3>'
      + '<p>' + escapeHtml(main.body) + '</p>'
      + '<div class="cockpit-metrics">'
      + renderMetricPill('访问用户', model.counts.users)
      + renderMetricPill('曝光', model.counts.exposure)
      + renderMetricPill('关键动作率', actionRate)
      + renderMetricPill('外链点击', model.counts.outbound)
      + '</div>';
  }

  function renderMetricPill(label, value) {
    var display = typeof value === 'number' ? fmt(value) : value;
    return '<div class="metric-pill"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(display) + '</strong></div>';
  }

  function renderSignalDonut(model) {
    var values = [
      model.counts.interest,
      model.counts.try,
      model.counts.reuse,
      model.counts.resonance
    ];
    var total = Math.max(1, values.reduce(function(sum, value) { return sum + value; }, 0));
    var a = values[0] / total * 100;
    var b = a + values[1] / total * 100;
    var c = b + values[2] / total * 100;
    var style = 'background:conic-gradient(var(--blue) 0 ' + a + '%, var(--green) ' + a + '% ' + b + '%, var(--purple) ' + b + '% ' + c + '%, var(--pink) ' + c + '% 100%)';
    $('signalDonut').innerHTML = ''
      + '<div class="panel-title">四类信号占比</div>'
      + '<div class="donut-wrap">'
      + '<div class="donut" style="' + style + '"><div><strong>' + fmt(total) + '</strong><span>总信号</span></div></div>'
      + '<div class="legend-list">'
      + renderLegend('兴趣', values[0], 'blue')
      + renderLegend('想试', values[1], 'green')
      + renderLegend('复用', values[2], 'purple')
      + renderLegend('共鸣', values[3], 'pink')
      + '</div></div>';
  }

  function renderLegend(label, value, color) {
    return '<div class="legend-item"><span class="legend-dot ' + color + '"></span><span>' + escapeHtml(label) + '</span><strong>' + fmt(value) + '</strong></div>';
  }

  function renderSparkPanel(model) {
    var series = buildTimeSeries(model.events);
    var max = Math.max.apply(null, series.map(function(item) { return item.count; }).concat([1]));
    var points = series.map(function(item, index) {
      var x = series.length === 1 ? 0 : index / (series.length - 1) * 280;
      var y = 86 - (item.count / max * 70);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var bars = series.map(function(item, index) {
      var h = Math.max(4, item.count / max * 58);
      return '<span style="height:' + h.toFixed(1) + 'px" title="' + escapeHtml(item.label + ': ' + item.count) + '"></span>';
    }).join('');
    $('sparkPanel').innerHTML = ''
      + '<div class="panel-title">事件走势</div>'
      + '<svg class="sparkline" viewBox="0 0 280 96" role="img" aria-label="事件走势">'
      + '<polyline points="' + points + '" fill="none" stroke="rgba(0,122,255,.14)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"></polyline>'
      + '<polyline points="' + points + '" fill="none" stroke="var(--blue)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></polyline>'
      + '</svg>'
      + '<div class="spark-bars">' + bars + '</div>';
  }

  function buildTimeSeries(events) {
    var buckets = {};
    var range = state.range === 'today' || state.range === 'yesterday' ? 'hour' : 'day';
    events.forEach(function(event) {
      var date = new Date(event.created_at);
      if (isNaN(date.getTime())) return;
      var key;
      if (range === 'hour') {
        key = String(date.getHours()).padStart(2, '0') + ':00';
      } else {
        key = String(date.getMonth() + 1).padStart(2, '0') + '/' + String(date.getDate()).padStart(2, '0');
      }
      buckets[key] = (buckets[key] || 0) + 1;
    });
    var keys = Object.keys(buckets).sort();
    if (!keys.length) keys = range === 'hour' ? ['09:00', '12:00', '15:00', '18:00'] : ['D-3', 'D-2', 'D-1', '今天'];
    return keys.map(function(key) { return { label: key, count: buckets[key] || 0 }; });
  }

  function renderTrendColumnChart(model) {
    var max = Math.max.apply(null, model.trends.map(function(item) { return item.boardScore; }).concat([1]));
    $('trendColumnChart').innerHTML = '<div class="panel-title">五榜关键指标柱状图</div><div class="column-chart">'
      + model.trends.map(function(item) {
        var score = item.boardScore || 0;
        return '<div class="column-item">'
          + '<div class="column-bar" style="height:' + Math.max(8, score / max * 180).toFixed(1) + 'px">'
          + '<span class="column-seg try" style="height:' + pctNumber(item.try, Math.max(1, item.try + item.reuse + item.resonance)) + '%"></span>'
          + '<span class="column-seg reuse" style="height:' + pctNumber(item.reuse, Math.max(1, item.try + item.reuse + item.resonance)) + '%"></span>'
          + '<span class="column-seg resonance" style="height:' + pctNumber(item.resonance, Math.max(1, item.try + item.reuse + item.resonance)) + '%"></span>'
          + '</div><strong>' + fmt(score) + '</strong><span>' + escapeHtml(item.label) + '</span></div>';
      }).join('')
      + '</div>';
  }

  function renderFunnelVisual(model) {
    var events = model.events;
    var steps = [
      ['访问 session', countUniqueSessions(events, function(e) { return e.event_name === 'page_view'; })],
      ['有效兴趣 session', countUniqueSessions(events, function(e) { return isInterestEvent(e); })],
      ['关键动作 session', countUniqueSessions(events, function(e) { return getKeyActionCount(getAtomicActions(e)) > 0; })],
      ['复用 / 共鸣 session', countUniqueSessions(events, function(e) { return isReuseEvent(e) || isResonanceEvent(e); })]
    ];
    var max = Math.max.apply(null, steps.map(function(step) { return step[1]; }).concat([1]));
    $('funnelVisual').innerHTML = '<div class="panel-title">整体漏斗</div><div class="big-funnel">'
      + steps.map(function(step, index) {
        var width = Math.max(24, step[1] / max * 100);
        return '<div class="funnel-layer" style="width:' + width.toFixed(1) + '%"><span>' + escapeHtml(step[0]) + '</span><strong>' + fmt(step[1]) + '</strong></div>';
      }).join('')
      + '</div>';
  }

  function renderSignalRadar(model) {
    var values = [
      model.counts.interest,
      model.counts.try,
      model.counts.reuse,
      model.counts.resonance
    ];
    var max = Math.max.apply(null, values.concat([1]));
    var labels = ['兴趣', '想试', '复用', '共鸣'];
    var points = values.map(function(value, index) {
      var angle = (-90 + index * 90) * Math.PI / 180;
      var radius = 16 + (value / max) * 62;
      return (90 + Math.cos(angle) * radius).toFixed(1) + ',' + (90 + Math.sin(angle) * radius).toFixed(1);
    }).join(' ');
    $('signalRadar').innerHTML = '<div class="panel-title">信号罗盘</div>'
      + '<svg class="radar" viewBox="0 0 180 180" role="img" aria-label="信号罗盘">'
      + '<circle cx="90" cy="90" r="68"></circle><circle cx="90" cy="90" r="42"></circle><line x1="90" y1="18" x2="90" y2="162"></line><line x1="18" y1="90" x2="162" y2="90"></line>'
      + '<polygon points="' + points + '"></polygon>'
      + '<text x="90" y="14">' + labels[0] + '</text><text x="166" y="94">' + labels[1] + '</text><text x="90" y="176">' + labels[2] + '</text><text x="14" y="94">' + labels[3] + '</text>'
      + '</svg>';
  }

  function renderContentBubbleChart(model) {
    var items = model.content.slice().sort(function(a, b) {
      return b.keyActions - a.keyActions || (b.try + b.reuse + b.resonance + b.click) - (a.try + a.reuse + a.resonance + a.click);
    }).slice(0, 9);
    var max = Math.max.apply(null, items.map(function(item) { return item.keyActions || item.total; }).concat([1]));
    if (!items.length) {
      $('contentBubbleChart').innerHTML = '<div class="panel-title">内容信号气泡</div><div class="empty">暂无内容信号。</div>';
      return;
    }
    $('contentBubbleChart').innerHTML = '<div class="panel-title">内容信号气泡</div><div class="bubble-field">'
      + items.map(function(item) {
        var size = 78 + (item.keyActions || item.total) / max * 86;
        var tone = item.reuse >= item.try && item.reuse >= item.resonance ? 'reuse' : item.resonance >= item.try ? 'resonance' : 'try';
        return '<div class="bubble ' + tone + '" style="width:' + size.toFixed(0) + 'px;height:' + size.toFixed(0) + 'px"><strong>' + fmt(item.keyActions) + '</strong><span>' + escapeHtml(item.title) + '</span></div>';
      }).join('')
      + '</div>';
  }

  function renderRawSummary(model) {
    $('rawSummary').innerHTML = ''
      + '<div class="raw-stat"><span>当前事件</span><strong>' + fmt(model.counts.total) + '</strong></div>'
      + '<div class="raw-stat"><span>去重 session</span><strong>' + fmt(model.counts.sessions) + '</strong></div>'
      + '<div class="raw-stat"><span>曝光</span><strong>' + fmt(model.counts.exposure) + '</strong></div>'
      + '<div class="raw-stat"><span>关键动作</span><strong>' + fmt(getKeyActionCount(model.counts.actions)) + '</strong></div>';
  }

  function renderInsights(model) {
    var insights = buildInsights(model);
    $('insightGrid').innerHTML = insights.map(function(item, index) {
      return '<article class="insight-card' + (index === 0 ? ' priority' : '') + '"><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.body) + '</p></article>';
    }).join('');
  }

  function buildInsights(model) {
    if (!model.counts.total) {
      return [
        { title: '还没有足够信号', body: '当前筛选范围内没有事件，先确认埋点 SQL、RLS 读取权限和前台 trackEvent 是否正常。' },
        { title: '后台不会影响前台', body: '这里所有结论只用于观察，不会自动改变趋势页、Skill 库或机会榜。' }
      ];
    }
    var insights = [];
    var topTrend = model.trends.slice().sort(function(a, b) { return b.boardScore - a.boardScore || b.keyActions - a.keyActions; })[0];
    if (topTrend && topTrend.total) {
      insights.push({ title: topTrend.label + '最值得先看', body: '按该榜单独立口径累计 ' + fmt(topTrend.boardScore) + ' 个关键指标，结论是“' + topTrend.decision + '”。' });
    }
    var topTry = model.content.slice().sort(function(a, b) { return b.try - a.try || b.outbound - a.outbound; })[0];
    if (topTry && topTry.try) {
      insights.push({ title: '最想试内容：' + topTry.title, body: '产生 ' + fmt(topTry.try) + ' 次想试信号和 ' + fmt(topTry.outbound) + ' 次外链点击，适合继续打磨体验入口。' });
    }
    var topReuse = model.content.slice().sort(function(a, b) { return b.reuse - a.reuse; })[0];
    if (topReuse && topReuse.reuse) {
      insights.push({ title: '最可复用内容：' + topReuse.title, body: '产生 ' + fmt(topReuse.reuse) + ' 次复用行为，可以考虑进入 Skill 精选或能力榜。' });
    }
    var topResonance = model.content.slice().sort(function(a, b) { return b.resonance - a.resonance; })[0];
    if (topResonance && topResonance.resonance) {
      insights.push({ title: '共鸣最强方向：' + topResonance.title, body: '产生 ' + fmt(topResonance.resonance) + ' 次共鸣行为，适合继续做机会验证或 Demo。' });
    }
    var topTag = model.tags.slice().sort(function(a, b) { return b.eventCount - a.eventCount; })[0];
    if (topTag) {
      insights.push({ title: '热度标签：' + topTag.tag, body: '兴趣 ' + fmt(topTag.click) + '、想试 ' + fmt(topTag.try) + '、复用 ' + fmt(topTag.reuse) + '、共鸣 ' + fmt(topTag.resonance) + '，判断为“' + topTag.decision + '”。' });
    }
    return insights.slice(0, 5);
  }

  function renderSignalCards(model) {
    var max = Math.max(model.counts.interest, model.counts.try, model.counts.reuse, model.counts.resonance, 1);
    $('signalGrid').innerHTML = SIGNAL_DEFINITIONS.map(function(card) {
      var value = model.counts[card.key] || 0;
      return '<article class="signal-card ' + card.key + '">'
        + '<div class="signal-card-header"><h3>' + card.title + '</h3><span class="signal-share">' + pct(value, Math.max(1, model.counts.interest + model.counts.try + model.counts.reuse + model.counts.resonance)) + '</span></div>'
        + '<div class="signal-value">' + fmt(value) + '</div>'
        + '<div class="signal-bar"><span class="signal-fill" style="width:' + pctNumber(value, max) + '%"></span></div>'
        + '<p>' + card.desc + '</p>'
        + renderSignalSourceBreakdown(model.counts.actions, card.sourceKeys)
        + '</article>';
    }).join('');
  }

  function renderSignalSourceBreakdown(actions, keys) {
    var max = Math.max.apply(null, keys.map(function(key) { return actions[key] || 0; }).concat([1]));
    return '<div class="source-breakdown">'
      + keys.map(function(key) {
        var value = actions[key] || 0;
        return '<div class="source-row"><span>' + escapeHtml(ACTION_LABELS[key] || key) + '</span><div class="mini-bar"><span class="mini-fill" style="width:' + pctNumber(value, max) + '%"></span></div><strong>' + fmt(value) + '</strong></div>';
      }).join('')
      + '</div>';
  }

  function renderFunnels(model) {
    var events = model.events;
    var funnels = [
      {
        title: 'Today → 详情',
        desc: '今日页是否把用户带到具体内容。',
        steps: [
          ['Today session', countUniqueSessions(events, function(e) { return e.page === 'today' && e.event_name === 'page_view'; })],
          ['详情 session', countUniqueSessions(events, function(e) { return e.event_name === 'today_hero_detail_click' || e.event_name === 'today_card_click'; })],
          ['外链 session', countUniqueSessions(events, function(e) { return e.event_name === 'today_outbound_click'; })]
        ]
      },
      {
        title: 'Trends → 我想试',
        desc: '趋势榜单是否产生试用意图。',
        steps: [
          ['趋势 session', countUniqueSessions(events, function(e) { return e.event_name === 'trend_page_view' || (e.page === 'trends' && e.event_name === 'page_view'); })],
          ['曝光 session', countUniqueSessions(events, function(e) { return getAtomicActions(e).exposure > 0; })],
          ['想试 session', countUniqueSessions(events, function(e) { return getAtomicActions(e).wantTry > 0; })]
        ]
      },
      {
        title: 'Skills → 复用',
        desc: 'Skill 是否从浏览走向安装或试用。',
        steps: [
          ['Skill session', countUniqueSessions(events, function(e) { return e.page === 'skills' && e.event_name === 'page_view'; })],
          ['试用 session', countUniqueSessions(events, function(e) { return getAtomicActions(e).skillTrial > 0; })],
          ['复制 / GitHub session', countUniqueSessions(events, function(e) { var a = getAtomicActions(e); return a.copyInstall > 0 || a.githubClick > 0; })]
        ]
      }
    ];
    $('funnelGrid').innerHTML = funnels.map(renderFunnelCard).join('');
  }

  function renderFunnelCard(funnel) {
    var max = Math.max.apply(null, funnel.steps.map(function(step) { return step[1]; }).concat([1]));
    return '<article class="funnel-card"><h3>' + escapeHtml(funnel.title) + '</h3><p>' + escapeHtml(funnel.desc) + '</p><div class="funnel-steps">'
      + funnel.steps.map(function(step) {
        return '<div class="funnel-step"><span>' + escapeHtml(step[0]) + '</span><div class="mini-bar"><span class="mini-fill" style="width:' + pctNumber(step[1], max) + '%"></span></div><strong>' + fmt(step[1]) + '</strong></div>';
      }).join('')
      + '</div></article>';
  }

  function countEvents(events, predicate) {
    return events.filter(predicate).length;
  }

  function countUniqueSessions(events, predicate) {
    var sessions = {};
    events.forEach(function(event) {
      if (!predicate(event)) return;
      var key = getSessionKey(event);
      if (key) sessions[key] = true;
    });
    return Object.keys(sessions).length;
  }

  function renderTrendBoard(model) {
    var max = Math.max.apply(null, model.trends.map(function(item) { return Math.max(item.boardScore, item.interest, item.try, item.reuse, item.resonance); }).concat([1]));
    $('trendBoard').innerHTML = model.trends.map(function(item) {
      return '<article class="trend-board-card">'
        + '<div class="trend-board-head">'
        + '<div><div class="trend-title">' + escapeHtml(item.label) + '</div><div class="trend-meta">榜单汇总 · 曝光 ' + fmt(item.exposure) + ' · 点击/展开/详情 ' + fmt(item.expand + item.detail) + ' · 关键动作 ' + fmt(item.keyActions) + ' · 总事件 ' + fmt(item.total) + '</div>' + renderTrendSpecificMetrics(item) + '</div>'
        + renderSignalBars(item, max)
        + '<div class="decision-pill">' + escapeHtml(item.decision) + '</div>'
        + '</div>'
        + renderTrendItemList(item)
        + '</article>';
    }).join('');
  }

  function renderTrendItemList(trend) {
    var items = (trend.itemList || []).slice(0, 12);
    if (!items.length) {
      return '<div class="trend-item-empty">这个榜单暂时没有可归因到具体产品的事件。</div>';
    }
    var max = Math.max.apply(null, items.map(function(item) {
      return Math.max(item.boardScore, item.click, item.keyActions, item.exposure, item.total);
    }).concat([1]));
    return '<div class="trend-item-list">'
      + items.map(function(item) { return renderTrendItemRow(item, max); }).join('')
      + '</div>';
  }

  function renderTrendItemRow(item, max) {
    return '<div class="trend-item-row">'
      + '<div class="trend-item-main">'
      + '<div class="trend-item-title">' + escapeHtml(item.title || item.id) + '</div>'
      + '<div class="trend-meta">' + escapeHtml(item.type || 'unknown') + ' · content_id ' + escapeHtml(item.id) + ' · 总事件 ' + fmt(item.total) + '</div>'
      + '</div>'
      + '<div class="trend-item-metrics">'
      + renderTrendMetric('曝光', item.exposure, max)
      + renderTrendMetric('点击/展开/详情', item.click, max)
      + renderTrendMetric('关键动作', item.keyActions, max)
      + renderTrendMetric('转化', pct(Math.min(item.keyActions, item.exposure), item.exposure), 100)
      + '</div>'
      + renderCompactActionBreakdown(item.actions)
      + '</div>';
  }

  function renderTrendMetric(label, value, max) {
    var isRate = typeof value === 'string';
    var width = isRate ? parseInt(value, 10) || 0 : pctNumber(value, max);
    return '<div class="trend-metric"><span>' + escapeHtml(label) + '</span><div class="mini-bar"><span class="mini-fill" style="width:' + width + '%"></span></div><strong>' + escapeHtml(isRate ? value : fmt(value)) + '</strong></div>';
  }

  function renderCompactActionBreakdown(actions) {
    var keys = ACTION_BREAKDOWN_KEYS.filter(function(key) { return actions[key] > 0; }).slice(0, 6);
    if (!keys.length) return '<div class="trend-action-strip muted">暂无关键动作</div>';
    return '<div class="trend-action-strip">'
      + keys.map(function(key) {
        return '<span>' + escapeHtml(ACTION_LABELS[key] || key) + ' ' + fmt(actions[key] || 0) + '</span>';
      }).join('')
      + '</div>';
  }

  function renderTrendSpecificMetrics(item) {
    var actions = item.actions || {};
    var metrics;
    if (item.tab === 'watchList') {
      metrics = [
        ['展开率', pct(item.expand, item.exposure)],
        ['详情率', pct(item.detail, item.exposure)],
        ['收藏率', pct(actions.save || 0, item.exposure)]
      ];
    } else if (item.tab === 'tryList') {
      metrics = [
        ['我想试', actions.wantTry || 0],
        ['Demo', actions.demoClick || 0],
        ['官网', actions.officialClick || 0]
      ];
    } else if (item.tab === 'newWorksList') {
      metrics = [
        ['详情', actions.detailClick || 0],
        ['Demo', actions.demoClick || 0],
        ['创作者入口', actions.canBuild || 0]
      ];
    } else if (item.tab === 'capabilityList') {
      metrics = [
        ['GitHub', actions.githubClick || 0],
        ['复制命令', actions.copyInstall || 0],
        ['Skill 试用', actions.skillTrial || 0]
      ];
    } else {
      metrics = [
        ['我也想要', actions.wantToo || 0],
        ['评论', actions.comment || 0],
        ['许愿/我能做', (actions.wishSubmit || 0) + (actions.canBuild || 0)]
      ];
    }
    return '<div class="trend-specific">' + metrics.map(function(pair) {
      return '<span>' + escapeHtml(pair[0]) + ' ' + escapeHtml(pair[1]) + '</span>';
    }).join('') + '</div>';
  }

  function renderSignalBars(item, max) {
    return '<div class="signal-bars">'
      + renderSmallBar('兴趣', item.interest || item.click || item.expand || 0, max, 'interest')
      + renderSmallBar('想试', item.try || 0, max, 'try')
      + renderSmallBar('复用', item.reuse || item.copy || 0, max, 'reuse')
      + renderSmallBar('共鸣', item.resonance || item.wantToo || 0, max, 'resonance')
      + '</div>';
  }

  function renderSmallBar(label, value, max, key) {
    return '<div class="bar-item"><span>' + label + '</span><div class="mini-bar"><span class="mini-fill ' + key + '" style="width:' + pctNumber(value, max) + '%"></span></div><strong>' + fmt(value) + '</strong></div>';
  }

  function renderFocusContent(model) {
    var byTry = model.content.slice().sort(function(a, b) { return b.try - a.try || b.total - a.total; })[0];
    var byReuse = model.content.slice().sort(function(a, b) { return b.reuse - a.reuse || b.total - a.total; })[0];
    var byResonance = model.content.slice().sort(function(a, b) { return b.resonance - a.resonance || b.total - a.total; })[0];
    var cards = [
      { label: '最想试', item: byTry, metric: byTry ? byTry.try : 0, desc: '适合继续优化 Demo、官网链接或体验说明。' },
      { label: '最可复用', item: byReuse, metric: byReuse ? byReuse.reuse : 0, desc: '适合加入能力榜、Skill 精选或安装说明。' },
      { label: '最有共鸣', item: byResonance, metric: byResonance ? byResonance.resonance : 0, desc: '适合进入机会榜、做验证 Demo 或收集需求。' }
    ];
    $('focusGrid').innerHTML = cards.map(function(card, index) {
      if (!card.item) return '<article class="focus-card"><span class="rank">' + (index + 1) + '</span><strong>' + card.label + '</strong><p>暂无内容信号。</p></article>';
      return '<article class="focus-card"><span class="rank">' + (index + 1) + '</span><strong>' + escapeHtml(card.label + '：' + card.item.title) + '</strong><p>' + fmt(card.metric) + ' 个关键动作。' + card.desc + '</p></article>';
    }).join('');
  }

  function renderHeatCloud(model) {
    var tags = model.tags.slice().sort(function(a, b) { return b.eventCount - a.eventCount; }).slice(0, 32);
    var max = Math.max.apply(null, tags.map(function(tag) { return tag.eventCount; }).concat([1]));
    if (!tags.length) {
      $('heatCloud').innerHTML = '<div class="empty">暂无标签信号。后续埋点 payload.tags 变多后，这里会显示场景热度。</div>';
      return;
    }
    $('heatCloud').innerHTML = tags.map(function(tag) {
      var heat = Math.max(0.12, tag.eventCount / max).toFixed(2);
      return '<button class="heat-chip" style="--heat:' + heat + '" title="' + escapeHtml(tag.decision) + '" data-tag="' + escapeHtml(tag.tag) + '">'
        + '<strong>' + escapeHtml(tag.tag) + '</strong>'
        + '<span>兴趣 ' + fmt(tag.click) + ' · 想试 ' + fmt(tag.try) + '</span>'
        + '<span>复用 ' + fmt(tag.reuse) + ' · 共鸣 ' + fmt(tag.resonance) + '</span>'
        + '</button>';
    }).join('');
    Array.prototype.forEach.call($('heatCloud').querySelectorAll('button'), function(btn) {
      btn.addEventListener('click', function() {
        state.tag = btn.getAttribute('data-tag') || '';
        applyFilters();
      });
    });
  }

  function renderContentBoard(model) {
    var max = Math.max.apply(null, model.content.map(function(item) { return Math.max(item.interest, item.try, item.reuse, item.resonance); }).concat([1]));
    var sorted = model.content.slice().sort(function(a, b) {
      return metricForSort(b) - metricForSort(a) || b.total - a.total;
    }).slice(0, 30);
    if (!sorted.length) {
      $('contentBoard').innerHTML = '<div class="empty">当前筛选下暂无可聚合的内容信号。</div>';
      return;
    }
    $('contentBoard').innerHTML = sorted.map(function(item) {
      var key = item.id + '::' + item.type;
      var expanded = state.expandedContentKey === key;
      return '<article class="content-row' + (expanded ? ' expanded' : '') + '" data-content-key="' + escapeHtml(key) + '">'
        + '<div class="content-main">'
        + '<div><div class="content-title">' + escapeHtml(item.title) + '</div><div class="content-meta">' + escapeHtml(item.type || 'unknown') + ' · 来源页 ' + escapeHtml(item.mainPage || '--') + ' · 总信号 ' + fmt(item.total) + '</div>' + renderPills(item.tagsList) + '</div>'
        + renderBehaviorChain(item)
        + '<button type="button">' + (expanded ? '收起' : '展开') + '</button>'
        + '</div>'
        + '<div class="content-detail">'
        + '<strong>' + escapeHtml(item.advice) + '</strong><br>'
        + 'content_id：' + escapeHtml(item.id) + '；曝光 ' + fmt(item.exposure) + '，点击/展开/详情 ' + fmt(item.click) + '，关键动作 ' + fmt(item.keyActions) + '，想试 ' + fmt(item.try) + '，复用 ' + fmt(item.reuse) + '，共鸣 ' + fmt(item.resonance) + '，外链 ' + fmt(item.outbound) + '。'
        + renderSignalBars(item, max)
        + renderActionBreakdown(item.actions)
        + '<div class="event-muted">最近事件：' + item.events.map(function(event) { return escapeHtml(event.event_name || getAction(event)); }).join(' / ') + '</div>'
        + '</div>'
        + '</article>';
    }).join('');
    Array.prototype.forEach.call($('contentBoard').querySelectorAll('.content-row'), function(row) {
      row.addEventListener('click', function() {
        var key = row.getAttribute('data-content-key');
        state.expandedContentKey = state.expandedContentKey === key ? '' : key;
        renderDashboard();
      });
    });
  }

  function renderBehaviorChain(item) {
    return '<div class="behavior-chain">'
      + renderChainNode('曝光', item.chain.exposure, '')
      + '<span class="chain-arrow">→</span>'
      + renderChainNode('点击/展开/详情', item.chain.engagement, pct(Math.min(item.chain.engagementSessions, item.chain.exposureSessions), item.chain.exposureSessions))
      + '<span class="chain-arrow">→</span>'
      + renderChainNode('关键动作', item.chain.keyActions, pct(Math.min(item.chain.keyActionSessions, item.chain.exposureSessions), item.chain.exposureSessions))
      + '</div>';
  }

  function renderChainNode(label, value, rate) {
    return '<div class="chain-node"><span>' + escapeHtml(label) + '</span><strong>' + fmt(value) + '</strong>' + (rate ? '<em>' + escapeHtml(rate) + '</em>' : '') + '</div>';
  }

  function renderActionBreakdown(actions) {
    return '<div class="action-breakdown">'
      + ACTION_BREAKDOWN_KEYS.map(function(key) {
        return '<div class="action-chip"><span>' + escapeHtml(ACTION_LABELS[key] || key) + '</span><strong>' + fmt(actions[key] || 0) + '</strong></div>';
      }).join('')
      + '</div>';
  }

  function metricForSort(item) {
    return {
      total: item.total,
      click: item.click,
      chain: item.keyActions,
      try: item.try,
      reuse: item.reuse,
      resonance: item.resonance,
      outbound: item.outbound
    }[state.sort] || item.total;
  }

  function renderPills(tags) {
    if (!tags || !tags.length) return '';
    return '<div class="pill-row">' + tags.slice(0, 6).map(function(tag) {
      return '<span class="mini-pill">' + escapeHtml(tag) + '</span>';
    }).join('') + '</div>';
  }

  function renderEventTable(model) {
    var events = model.events.slice(0, 100);
    $('eventTableBody').innerHTML = events.map(function(event) {
      return '<tr>'
        + '<td>' + escapeHtml(formatTime(event.created_at)) + '</td>'
        + '<td>' + escapeHtml(event.event_name || '') + '</td>'
        + '<td>' + escapeHtml(event.page || '') + '</td>'
        + '<td>' + escapeHtml(getEventTitle(event)) + '</td>'
        + '<td>' + escapeHtml(getContentType(event)) + '</td>'
        + '<td>' + escapeHtml(getAction(event)) + '</td>'
        + '<td>' + escapeHtml(maskUser(event)) + '</td>'
        + '</tr>';
    }).join('');
  }

  function formatTime(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function copyEventsJson() {
    var json = JSON.stringify(state.filteredEvents.slice(0, 100), null, 2);
    navigator.clipboard.writeText(json).then(function() {
      $('copyEventsBtn').textContent = '已复制';
      setTimeout(function() { $('copyEventsBtn').textContent = '复制事件 JSON'; }, 1200);
    }).catch(function() {
      $('copyEventsBtn').textContent = '复制失败';
      setTimeout(function() { $('copyEventsBtn').textContent = '复制事件 JSON'; }, 1200);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  window.SignalOpsDashboard = {
    mount: mount,
    refresh: fetchEvents
  };
})();

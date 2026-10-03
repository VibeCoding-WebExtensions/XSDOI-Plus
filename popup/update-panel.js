// 检查更新面板 - popup
//
// 对比本地版本（chrome.runtime.getManifest().version）与 GitHub Release 上的最新 tag。
// ⚠️ 自托管的 crx **无法自动更新**：Chrome 只对 Chrome Web Store 上架的扩展走自动更新通道，
//    本项目 manifest 里没有 update_url。所以这里只做「检测 + 引导」：
//    检测到新版 → 给一个跳 Release 下载页的入口，其余交给用户手动替换。
// 为什么不加「一键下载 crx」：Chrome 不允许安装非商店来源的 .crx，最终仍要解压后
// 「加载已解压的扩展程序」，为此多申请一个 downloads 权限不划算。
// ============================================================

(function () {
  'use strict';

  var REPO = 'VibeCoding-WebExtensions/XSDOI-Plus';
  var API_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  var TIMEOUT_MS = 12000;

  var currentEl = document.getElementById('update-current');
  var statusEl = document.getElementById('update-status');
  var checkBtn = document.getElementById('update-check');
  var releaseBtn = document.getElementById('update-open-release');
  var extBtn = document.getElementById('update-open-ext');

  var currentVer = (chrome.runtime.getManifest().version || '').replace(/^V/i, '');

  // ---------- 工具 ----------
  // "V4.6.0" / "4.6.0" → [4, 6, 0]；解析不出来返回 null
  function parseVer(s) {
    var m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s || ''));
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  }

  // a > b → 1；a < b → -1；相等或无法解析 → 0
  function cmpVer(a, b) {
    if (!a || !b) return 0;
    for (var i = 0; i < 3; i++) {
      if (a[i] > b[i]) return 1;
      if (a[i] < b[i]) return -1;
    }
    return 0;
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'as-status' + (cls ? ' ' + cls : '');
  }

  // ---------- 检测 ----------
  function check() {
    checkBtn.disabled = true;
    releaseBtn.style.display = 'none';
    setStatus('正在检测…');

    var timer = setTimeout(function () {
      // 超时不走 abort：popup 关闭后 fetch 失败也没所谓，这里只是给用户一个明确反馈
      checkBtn.disabled = false;
      setStatus('检测超时：网络不通，请稍后重试', 'err');
    }, TIMEOUT_MS);

    fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) {
        if (!r.ok) {
          var hint = r.status === 403 ? '（GitHub API 限流，等几分钟再试）'
            : r.status === 404 ? '（仓库或 Release 不存在）' : '';
          throw new Error('HTTP ' + r.status + hint);
        }
        return r.json();
      })
      .then(function (data) {
        clearTimeout(timer);
        checkBtn.disabled = false;

        var tag = (data && data.tag_name) || '';
        var latest = parseVer(tag);
        var mine = parseVer(currentVer);

        if (!latest) {
          setStatus('无法解析线上版本号（tag：' + (tag || '空') + '）', 'err');
          return;
        }
        var c = cmpVer(latest, mine);
        if (c > 0) {
          setStatus('发现新版本 V' + latest.join('.') + '，当前 V' + currentVer, 'err');
          if (data.html_url) {
            releaseBtn.dataset.url = data.html_url;
            releaseBtn.style.display = '';
          }
        } else if (c === 0) {
          setStatus('已是最新版本 V' + currentVer, 'ok');
        } else {
          setStatus('本地 V' + currentVer + ' 高于线上最新 V' + latest.join('.') + '（本地可能是开发版）', 'err');
        }
      })
      .catch(function (e) {
        clearTimeout(timer);
        checkBtn.disabled = false;
        setStatus('检测失败：' + (e && e.message ? e.message : '未知错误'), 'err');
      });
  }

  // ---------- 事件 ----------
  checkBtn.addEventListener('click', check);

  releaseBtn.addEventListener('click', function () {
    var url = releaseBtn.dataset.url;
    if (url) chrome.tabs.create({ url: url });
  });

  extBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: 'chrome://extensions' });
  });

  // ---------- 初始化 ----------
  currentEl.textContent = '当前版本：V' + currentVer;
  setStatus('点「检测更新」查询 GitHub Release');
})();

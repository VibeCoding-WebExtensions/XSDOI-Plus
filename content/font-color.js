// ============================================================
// 全局字体颜色 - content script（隔离世界）
//
// 覆盖 xsdoi.com 的文字 CSS 变量（--text-strong/main/second/muted 等），
// 亮色模式默认黑、暗色模式默认白，用户可在 popup「字体颜色」面板自定义。
// 只改文字颜色变量，不影响彩色字体（品牌色/等级色等）与编辑器（CodeMirror）字体。
// 另：侧边栏菜单（#nav .el-menu-item）的文字色被站点写在**内联 style** 上，
//     不走变量 → 这里额外单列两条 !important 规则（见 buildCSS 末尾注释）。
// ============================================================

(function () {
  'use strict';

  var STYLE_ID = 'xsdoi-font-color-style';

  // 颜色解析：支持 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba()，返回 [r,g,b,a]（0-255）
  // 复用 POWERMODE.parseColor（constants.js 已注入），缺失时内置兜底
  function parseColor(str) {
    if (typeof POWERMODE !== 'undefined' && POWERMODE.parseColor) {
      return POWERMODE.parseColor(str);
    }
    return null;
  }

  // 生成覆盖文字变量的 CSS。用户色作为主文字（strong/main/title/regular），
  // 次要文字（second/muted/placeholder）用主色的不同透明度派生，保持层级感。
  function buildCSS(lightColor, darkColor) {
    var l = parseColor(lightColor) || [31, 39, 51, 1];   // 兜底亮色 #1f2733
    var d = parseColor(darkColor) || [238, 241, 248, 1]; // 兜底暗色 #eef1f8

    function rgba(c, alpha) {
      return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + alpha + ')';
    }

    function vars(c, prefix) {
      return [
        prefix + '--text-strong: ' + rgba(c, 1) + ';',
        prefix + '--text-main: ' + rgba(c, 1) + ';',
        prefix + '--text-title: ' + rgba(c, 1) + ';',
        prefix + '--text-regular: ' + rgba(c, 1) + ';',
        prefix + '--text-second: ' + rgba(c, 0.72) + ';',
        prefix + '--text-placeholder: ' + rgba(c, 0.55) + ';',
        prefix + '--text-muted: ' + rgba(c, 0.45) + ';'
      ].join('\n');
    }

    return [
      'html:not(.theme-dark) {',
      vars(l, '  '),
      '}',
      /* ⚠️ 暗色必须写 `html.theme-dark.theme-dark`（重复类名提特异性）。
         站点自己也定义了一套同名变量：
             :root            -> --text-strong:#1f2733 ...（亮色，特异性 0,1,0）
             html.theme-dark  -> --text-strong:#eef1f8 ...（暗色，特异性 0,1,1）
         扩展的 <style> 在 document_start 插入，排在站点样式表**之前** →
         暗色下 `html.theme-dark`(0,1,1) 与站点那条**特异性和重要性都相同**，靠源码顺序决胜 → 站点赢，
         **自定义颜色在暗色主题里实际上一直没生效**（亮色因为站点是 :root(0,1,0)，扩展(0,1,1) 能赢，所以只有亮色看起来正常）。
         重复一次类名把特异性提到 (0,2,1) 即可稳定压过，不依赖顺序。 */
      'html.theme-dark.theme-dark {',
      vars(d, '  '),
      '}',
      /* ===== 侧边栏菜单文字（不走变量，必须单独写）=====
         站点把每个菜单项的颜色由 JS 写成**内联 style**：
           <li class="el-menu-item" style="padding-left:20px; color: rgb(168,176,194)">   （普通项，11 个）
           <li class="el-menu-item is-active" style="padding-left:20px; color: rgb(152,164,255)">（激活项）
         内联普通声明的优先级高于任何选择器（含带 id 的）→ 只改 CSS 变量对菜单**文字**无效；
         而图标走的是 `.el-menu-item i[data-v-31527af1]{color:var(--text-second)}` 这条变量规则，
         所以现象就是「只有图标跟着变色，文字不动」。
         要压过内联只有一条路：作者样式表里的 `!important`（!important > 内联普通声明）。
         ⚠️ 显式排除 .is-active：激活项是站点自己的 `color:var(--brand)!important`
         + `background:var(--brand-soft)`，属于「彩色字体」（品牌色），保持不动。 */
      'html:not(.theme-dark) #nav .el-menu-item:not(.is-active) {',
      '  color: ' + rgba(l, 1) + ' !important;',
      '}',
      'html.theme-dark #nav .el-menu-item:not(.is-active) {',
      '  color: ' + rgba(d, 1) + ' !important;',
      '}'
    ].join('\n');
  }

  function apply() {
    try {
      if (!chrome.storage || !chrome.storage.sync) return;
      chrome.storage.sync.get(FONT_COLOR.STORAGE_KEY, function (data) {
        try {
          var cfg = data && data[FONT_COLOR.STORAGE_KEY];
          var el = document.getElementById(STYLE_ID);
          if (!cfg || !cfg.enabled) {
            if (el) el.remove();
            return;
          }
          var light = (typeof cfg.lightColor === 'string' && cfg.lightColor.trim()) ? cfg.lightColor.trim() : FONT_COLOR.DEFAULTS.lightColor;
          var dark = (typeof cfg.darkColor === 'string' && cfg.darkColor.trim()) ? cfg.darkColor.trim() : FONT_COLOR.DEFAULTS.darkColor;
          var css = buildCSS(light, dark);
          if (el) {
            el.textContent = css;
          } else {
            var s = document.createElement('style');
            s.id = STYLE_ID;
            s.textContent = css;
            (document.head || document.documentElement).appendChild(s);
          }
        } catch (e) { /* 忽略 */ }
      });
    } catch (e) { /* 上下文失效等静默 */ }
  }

  // 监听 popup 保存变化，无需刷新页面即可生效
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'sync') return;
      if (changes[FONT_COLOR.STORAGE_KEY]) apply();
    });
  } catch (e) { /* 忽略 */ }

  // document_start 注入：尽早应用，避免首屏闪烁
  apply();
})();

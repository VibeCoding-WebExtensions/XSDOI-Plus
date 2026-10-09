// ============================================================
// 网页桌宠 - content script（隔离世界）
//
// 在 xsdoi.com 所有页面注入一只可拖动的圆球桌宠（全局注入，不限路由）：
//   - 圆球外观：圆形容器，可显示用户自定义图片（storage.local 的
//     webPetImg，cover 裁剪）；未设置时显示默认表情球
//   - 随机散步：页面底部区域自由走动，边缘折返，偶有停顿
//   - 鼠标拖动：Pointer 抓取拖动，松手停住，靠近屏幕边缘自动吸附
//   - 显隐控制：读取 storage.sync 的 webPetEnabled（popup「桌宠」面板
//     开关），关闭即隐藏
//   - 持久化：开关、图片、位置（视口百分比）刷新后保持
//   - 注：2026-09-30 移除了「双击打开 AI 聊天窗口」（连同 API 配置 / 系统提示词 / 多会话 /
//     Markdown+LaTeX 渲染），桌宠现在只是一只球：拖动 / 散步 / 抛物线 / 尾迹碰撞 / 自定义图片
// ============================================================

(function () {
  'use strict';

  var CONTAINER_ID = 'xsdoi-web-pet';
  var STYLE_ID = 'xsdoi-web-pet-style';
  var STORAGE_KEY = 'webPet';           // { x: %, y: % }
  var ENABLE_KEY = 'webPetEnabled';     // popup「桌宠」面板开关
  var IMG_KEY = 'webPetImg';            // 自定义图片 dataURL（storage.local）
  var CROP_KEY = 'webPetCrop';          // 裁剪参数 { scale, cx, cy }（popup 可视化裁剪器）
  var BOUNCE_KEY = 'webPetBounce';      // 弹性系数 = 恢复系数 e（0.2~1，popup「桌宠」面板）
  var THROW_KEY = 'webPetThrow';        // 抛掷力度倍率（0.3~2，popup「桌宠」面板）

  var PET_SIZE = 56;   // 显示尺寸 px
  var MARGIN = 8;      // 与视口边缘的最小间距 px
  var SNAP = 40;       // 距边缘小于该值则吸附 px
  var WALK_STEP = 2;   // 散步每帧移动 px

  // 默认表情球（无自定义图片时显示；眼睛带 xsdoi-pet-eye class 便于眨眼）
  var SVG_FACE = [
    '<svg viewBox="0 0 32 32" width="56" height="56">',
    '<circle cx="16" cy="16" r="15" fill="#60a5fa"/>',
    '<circle class="xsdoi-pet-eye" cx="10.5" cy="14.5" r="3.4" fill="#1f2937"/>',
    '<circle class="xsdoi-pet-eye" cx="21.5" cy="14.5" r="3.4" fill="#1f2937"/>',
    '<circle cx="9.6" cy="13.4" r="1.1" fill="#dbeafe"/>',
    '<circle cx="20.6" cy="13.4" r="1.1" fill="#dbeafe"/>',
    '<path d="M12 21 Q16 24.5 20 21" stroke="#1f2937" stroke-width="1.7" fill="none" stroke-linecap="round"/>',
    '<circle cx="6.5" cy="20.5" r="2.5" fill="#f9a8d4"/>',
    '<circle cx="25.5" cy="20.5" r="2.5" fill="#f9a8d4"/>',
    '</svg>'
  ].join('');

  // ---------- 样式 ----------
  var CSS_TEXT = [
    '#' + CONTAINER_ID + '{position:fixed;left:0;top:0;z-index:2147483000;width:' + PET_SIZE + 'px;height:' + PET_SIZE + 'px;pointer-events:none;will-change:transform;}',
    '#' + CONTAINER_ID + ' .xsdoi-pet-body{position:relative;width:100%;height:100%;border-radius:50%;overflow:hidden;pointer-events:auto;cursor:grab;user-select:none;-webkit-user-select:none;background:#60a5fa;box-shadow:0 2px 8px rgba(0,0,0,.18);}',
    '#' + CONTAINER_ID + '.xsdoi-pet-dragging .xsdoi-pet-body{cursor:grabbing;}',
    '#' + CONTAINER_ID + ' .xsdoi-pet-img{position:absolute;left:0;top:0;object-fit:cover;display:block;pointer-events:none;max-width:none;max-height:none;border:none;margin:0;padding:0;background:none;box-shadow:none;border-radius:0;filter:none;transform:none;transition:none;animation:none;opacity:1;visibility:visible;z-index:0;}',
    '#' + CONTAINER_ID + ' .xsdoi-pet-body svg{display:block;width:100%;height:100%;}',
    '#' + CONTAINER_ID + '.xsdoi-pet-walking .xsdoi-pet-body{animation:xsdoiPetWalk .45s ease-in-out infinite;}',
    '@keyframes xsdoiPetWalk{0%,100%{transform:translateY(0);}40%{transform:translateY(-6px);}70%{transform:translateY(-1px);}}',
    '#' + CONTAINER_ID + '.xsdoi-pet-idle .xsdoi-pet-body svg{animation:xsdoiPetBreathe 2.6s ease-in-out infinite;}',
    '@keyframes xsdoiPetBreathe{0%,100%{transform:scale(1);}50%{transform:scale(1.04);}}',
    '#' + CONTAINER_ID + ' .xsdoi-pet-eye{transform-box:fill-box;transform-origin:center;animation:xsdoiPetBlink 3.6s infinite;}',
    '@keyframes xsdoiPetBlink{0%,44%,56%,100%{transform:scaleY(1);}48%,52%{transform:scaleY(.08);}}',
    '#' + CONTAINER_ID + '.xsdoi-pet-bounce .xsdoi-pet-body{animation:xsdoiPetBounce .4s ease;}',
    '@keyframes xsdoiPetBounce{0%{transform:scale(1);}40%{transform:scale(.86);}100%{transform:scale(1);}}',
    '#' + CONTAINER_ID + '.xsdoi-pet-flying .xsdoi-pet-body{animation:xsdoiPetFly .55s ease-in;}',
    '@keyframes xsdoiPetFly{0%{transform:scale(1) rotate(0deg);}50%{transform:scale(.88,1.14) rotate(-8deg);}100%{transform:scale(1) rotate(0deg);}}',
  ].join('\n');

  // ---------- 状态 ----------
  var pet = null;      // 容器
  var body = null;     // 圆球本体
  var enabled = true;  // 是否显示（webPetEnabled）
  var pos = { x: 80, y: 100 }; // 视口百分比（容器左上角）；y=100 默认贴底，首次生成即在下方散步，无下落动画

  var vw = 0, vh = 0;
  var px = 0, py = 0;

  var dragging = false;
  var pointerId = null;
  var dragDX = 0, dragDY = 0;
  var dragMoved = 0;

  var targetX = 0, targetY = 0;
  var waitUntil = 0;
  var raf = 0;
  var customImg = null; // 自定义图片 dataURL（storage.local webPetImg）
  // 圆形裁剪参数：scale = 放大倍数（圆直径 = 容器/scale），cx/cy = 裁剪中心（图片坐标 0-1）
  var crop = { scale: 2, cx: 0.5, cy: 0.5 };

  // 抛物线飞行状态
  var flying = false;
  var flyVx = 0, flyVy = 0;  // 飞行初速度（px/frame）
  var G = 0.15;              // 重力加速度（px/frame²，~60fps）
  // 拖拽轨迹采样，用于估算松手速度
  var dragSamples = [];
  // 抛物线运动中的瞬时速度（updateParabola 内部使用，需先声明）
  var pxFly = 0, pyFly = 0, vxFly = 0, vyFly = 0;

  // 轨迹碰撞参数
  var COLLISION_RADIUS = PET_SIZE / 2 + 4; // 宠物碰撞半径（减小避免穿模）
  // 弹性系数 = 物理上的恢复系数 e（0 = 不弹，1 = 完全弹性），popup 可调 0.2~1。
  // ⚠️ V4.6.0 之前这里是 BOUNCE_DAMPING(0.9) × BOUNCE_FORCE(1.3) = **1.17 > 1** ——
  //    每次碰撞反而多 17% 动能，越弹越高；再叠加固定上限 -18px/frame，
  //    在 G=0.15 下单次弹跳高度 18²/(2×0.15) = 1080px，比一屏还高。
  var bounceCoef = 0.5;                  // storage.sync webPetBounce
  var throwCoef = 1.0;                   // storage.sync webPetThrow
  var DAMPING_RATIO = 0.28;              // 果冻阻尼比 ζ（0~1，越小回弹越"晃"）
  var SQUASH_REST = 0.0;                 // 形变静止偏移
  var SQUASH_GAIN = 3.4;                 // 形变增益（撞击速度 → 压缩量）
  var squash = 0, squashV = 0;           // 果冻形变状态：位移与速度
  var COLLISION_COOLDOWN = 6;            // 碰撞冷却帧数（避免反弹瞬移）
  var collisionCooldown = 0;             // 当前冷却计时器

  // 反弹速度上限随弹性缩放：固定上限会让低弹性「该落还弹」（速度被顶住、能量不衰减）。
  // 弹跳高度 h = v²/(2G)：e=0.2 → v≈6 → h≈120px；e=0.5 → v≈10.5 → h≈368px；e=1 → v=18 → h≈1080px
  function maxBounceVy() { return -(3 + 15 * bounceCoef); }

  // 两个系数取自 storage，非法值一律回落默认值
  function normalizeBounce(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 0.5 : Math.max(0.2, Math.min(1, n));
  }

  function normalizeThrow(v) {
    var n = parseFloat(v);
    return isNaN(n) ? 1.0 : Math.max(0.3, Math.min(2, n));
  }

  // 规范化裁剪参数（兼容旧值/非法值）
  function normalizeCrop(v) {
    if (v && typeof v === 'object' && typeof v.scale === 'number') {
      return {
        scale: Math.max(1, Math.min(8, v.scale)),
        cx: (typeof v.cx === 'number') ? Math.max(0, Math.min(1, v.cx)) : 0.5,
        cy: (typeof v.cy === 'number') ? Math.max(0, Math.min(1, v.cy)) : 0.5
      };
    }
    return { scale: 2, cx: 0.5, cy: 0.5 };
  }

  // ---------- 基础工具 ----------
  function measure() {
    vw = window.innerWidth;
    vh = window.innerHeight;
  }

  function ensureContainer() {
    if (pet) return;
    pet = document.createElement('div');
    pet.id = CONTAINER_ID;
    pet.innerHTML = '<div class="xsdoi-pet-body"></div>';
    body = pet.querySelector('.xsdoi-pet-body');
    document.body.appendChild(pet);
    pet.addEventListener('pointerdown', onPointerDown);
    pet.addEventListener('pointercancel', function (e) {
      if (e.pointerId === pointerId) onPointerUp(e);
    });
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }

  // 渲染圆球内容：有自定义图片按裁剪参数定位显示，否则显示默认表情球
  function renderFace() {
    if (!body) return;
    if (customImg) {
      body.innerHTML = '<img class="xsdoi-pet-img" src="' + customImg + '" alt="">';
      var img = body.querySelector('.xsdoi-pet-img');
      if (img) {
        var layout = function () {
          var ratio = (img.naturalWidth > 0 && img.naturalHeight > 0)
            ? img.naturalWidth / img.naturalHeight : 1;
          var w = PET_SIZE * crop.scale;
          var h = w / ratio;
          var k = 1;
          if (crop.cx > 0) k = Math.max(k, PET_SIZE / (2 * crop.cx * w));
          if (crop.cy > 0) k = Math.max(k, PET_SIZE / (2 * crop.cy * h));
          if (1 - crop.cx > 0) k = Math.max(k, PET_SIZE / (2 * (1 - crop.cx) * w));
          if (1 - crop.cy > 0) k = Math.max(k, PET_SIZE / (2 * (1 - crop.cy) * h));
          w *= k;
          h *= k;
          img.style.width = w + 'px';
          img.style.height = h + 'px';
          img.style.left = (PET_SIZE / 2 - crop.cx * w) + 'px';
          img.style.top = (PET_SIZE / 2 - crop.cy * h) + 'px';
        };
        if (img.complete && img.naturalWidth > 0) layout();
        else img.addEventListener('load', layout);
      }
    } else {
      body.innerHTML = SVG_FACE;
    }
  }

  function toPx() {
    px = pos.x / 100 * Math.max(1, vw - PET_SIZE);
    py = pos.y / 100 * Math.max(1, vh - PET_SIZE);
  }

  function applyPos() {
    // 果冻形变：squash 量为二阶弹簧-阻尼系统的位移，遵循
    //   ü = -ω²·u - 2ζω·u̇      (u = squash 偏移量, ζ = 阻尼比)
    // 撞击瞬间把冲击速度「注入」形变速度 u̇，之后由弹簧拉回、阻尼耗散 → 果冻回弹。
    // 体积近似守恒：横向按 1/√(1-u) 补偿，挤压时变胖、拉伸时变瘦。
    var s = 1 - squash;                       // 纵向缩放
    var guard = s > 0.05 ? s : 0.05;
    var lateral = 1 / Math.sqrt(guard);       // 体积守恒
    if (lateral > 2.2) lateral = 2.2;        // 别拉成一条线
    pet.style.transform = 'translate(' + px + 'px,' + py + 'px) scale(' +
      lateral.toFixed(4) + ',' + s.toFixed(4) + ')';
  }

  // ---------- 果冻形变积分器（每帧调用，dt 秒） ----------
  var SQUASH_W = 15.0;   // ω：形变固有角频率，越大回弹越快
  function stepSquash(dt) {
    var k = SQUASH_W * SQUASH_W;
    var c = 2 * DAMPING_RATIO * SQUASH_W;
    squashV += (-k * (squash - SQUASH_REST) - c * squashV) * dt;
    squash += squashV * dt;
    // 限幅：极端连击下形变不能反号到「缩成一团」
    if (squash > 0.55) { squash = 0.55; squashV = Math.min(squashV, 0); }
    if (squash < -0.40) { squash = -0.40; squashV = Math.max(squashV, 0); }
  }

  // 撞击/抛掷时给形变注入速度：impact 为冲击强度（正数）
  function pokeSquash(impact) {
    squashV += impact * SQUASH_W * 0.055 * SQUASH_GAIN;
  }

  function clampToViewport() {
    var bounced = {};
    var oldPx = px, oldPy = py;
    px = Math.max(MARGIN, Math.min(vw - PET_SIZE - MARGIN, px));
    py = Math.max(MARGIN, Math.min(vh - PET_SIZE - MARGIN, py));
    if (px === MARGIN && oldPx < MARGIN) bounced.left = true;
    if (px === vw - PET_SIZE - MARGIN && oldPx > vw - PET_SIZE - MARGIN) bounced.right = true;
    if (py === MARGIN && oldPy < MARGIN) bounced.top = true;
    if (py === vh - PET_SIZE - MARGIN && oldPy > vh - PET_SIZE - MARGIN) bounced.bottom = true;
    return bounced;
  }

  // ---------- 显隐（popup「桌宠」面板开关） ----------
  function applyVisibility() {
    if (!pet) return;
    pet.style.display = enabled ? 'block' : 'none';
  }

  function saveState() {
    pos.x = px / Math.max(1, vw - PET_SIZE) * 100;
    pos.y = py / Math.max(1, vh - PET_SIZE) * 100;
    if (!isCtxValid()) return;
    chrome.storage.sync.set({ webPet: { x: pos.x, y: pos.y } });
  }

  // ---------- 随机散步（贴底走动） ----------
  function groundY() {
    return vh - PET_SIZE - MARGIN;
  }

  function pickTarget() {
    var x1 = MARGIN;
    var x2 = vw - PET_SIZE - MARGIN;
    targetX = x1 + Math.random() * (x2 - x1);
    targetY = groundY();
    pet.classList.toggle('xsdoi-pet-left', targetX < px);
  }

  function step() {
    // 果冻形变积分必须在最前面：下面有多个 early-return（拖动/等待/静止），
    // 若放在其后，桌宠静止时形变会冻结住、回弹播一半卡住。
    stepSquash(1 / 60);
    if (dragging) return;
    var now = Date.now();
    if (now < waitUntil) { applyPos(); return; }
    if (collisionCooldown > 0) collisionCooldown--;
    if (flying) {
      if (updateParabola()) return;
      applyPos();
      return;
    }
    // 散步时不响应鼠标尾迹（避免贴底走动时被尾迹弹跳）
    var dx = targetX - px;
    var dy = targetY - py;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 3) {
      pet.classList.remove('xsdoi-pet-walking');
      pet.classList.add('xsdoi-pet-idle');
      waitUntil = now + 1500 + Math.random() * 2500;
      pickTarget();
      applyPos();
      return;
    }
    var s = Math.min(WALK_STEP, dist);
    px += dx / dist * s;
    py += dy / dist * s;
    pet.classList.add('xsdoi-pet-walking');
    pet.classList.remove('xsdoi-pet-idle');
    applyPos();
  }

  function loop() {
    step();
    raf = requestAnimationFrame(loop);
  }

  // ---------- 拖动 ----------
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    dragMoved = 0;
    dragDX = e.clientX - px;
    dragDY = e.clientY - py;
    try { pet.setPointerCapture(pointerId); } catch (err) {}
    pet.classList.add('xsdoi-pet-dragging');
    pet.classList.remove('xsdoi-pet-walking', 'xsdoi-pet-idle');
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    var nx = e.clientX - dragDX;
    var ny = e.clientY - dragDY;
    dragMoved = Math.max(dragMoved, Math.abs(nx - px) + Math.abs(ny - py));
    dragSamples.push({ x: nx, y: ny, t: Date.now() });
    if (dragSamples.length > 6) dragSamples.shift();
    px = nx;
    py = ny;
    clampToViewport();
    applyPos();
  }

  function onPointerUp(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try { pet.releasePointerCapture(pointerId); } catch (err) {}
    pet.classList.remove('xsdoi-pet-dragging');
    snapToEdge();
    saveState();
    if (dragMoved < 6) {
      pet.classList.remove('xsdoi-pet-bounce');
      void pet.offsetWidth;
      pet.classList.add('xsdoi-pet-bounce');
      pet.classList.add('xsdoi-pet-idle');
      waitUntil = Date.now() + 1200;
    } else {
      waitUntil = 0;
      var ground = groundY();
      if (py < ground - PET_SIZE / 2) {
        startParabolicFall();
      } else {
        pickTarget();
      }
    }
    dragSamples = [];
  }

  function startParabolicFall() {
    flying = true;
    vxFly = flyVx;
    vyFly = flyVy;
    pet.classList.remove('xsdoi-pet-idle', 'xsdoi-pet-walking');
    pet.classList.add('xsdoi-pet-flying');
    if (dragSamples.length >= 2) {
      var a = dragSamples[dragSamples.length - 2];
      var b = dragSamples[dragSamples.length - 1];
      var dt = b.t - a.t;
      if (dt > 0) {
        flyVx = (b.x - a.x) / dt * 16;
        flyVy = (b.y - a.y) / dt * 16;
      }
    }
    // 抛掷力度：初速度与速度上限一起缩放（上限不缩放的话，滑块拉满也不会「抛得更远」）
    var tVyMax = 8 * throwCoef;
    var tVxMax = 4 * throwCoef;
    flyVy = Math.max(-tVyMax, Math.min(tVyMax, flyVy * 0.6 * throwCoef));
    flyVx = Math.max(-tVxMax, Math.min(tVxMax, flyVx * throwCoef));
    vxFly = flyVx;
    vyFly = flyVy;
    // 抛掷瞬间拉伸果冻（朝运动方向拉长）
    pokeSquash(-Math.min(1.6, Math.abs(flyVx) * 0.10 + Math.abs(flyVy) * 0.06));
  }

  function updateParabola() {
    if (!flying) return false;
    vxFly += 0;
    vyFly += G;
    px += vxFly;
    py += vyFly;
    var bounds = clampToViewport();
    // 撞视口边缘的反弹也走同一个弹性系数，否则拖到边上的手感与碰撞不一致
    if (bounds.left || bounds.right) vxFly = -vxFly * bounceCoef;
    if (bounds.top) vyFly = -vyFly * bounceCoef;
    applyPos();
    checkTrailCollision();
    var ground = groundY();
    if (py >= ground) {
      py = ground;
      // 落地：按落地速度注入果冻冲量（速度越大压得越扁）
      pokeSquash(Math.min(2.2, Math.abs(vyFly) * 0.12));
      applyPos();
      flying = false;
      pet.classList.remove('xsdoi-pet-flying');
      pet.classList.remove('xsdoi-pet-bounce');
      void pet.offsetWidth;
      pet.classList.add('xsdoi-pet-bounce');
      setTimeout(function () {
        pet.classList.remove('xsdoi-pet-bounce');
      }, 400);
      pickTarget();
      return true;
    }
    return false;
  }

  // ============================================
  // 轨迹碰撞检测与响应
  // ============================================
  function petCenter() {
    return { x: px + PET_SIZE / 2, y: py + PET_SIZE / 2 };
  }

  function checkDotCollision() {
    if (collisionCooldown > 0) return;
    var dots = window.__xsdoiTrail && window.__xsdoiTrail.dots || [];
    var c = petCenter();
    for (var i = 0; i < dots.length; i++) {
      var dot = dots[i];
      if (!dot || !dot.style || dot.style.display === 'none') continue;
      var dotX = parseFloat(dot.style.left) + PET_SIZE / 2;
      var dotY = parseFloat(dot.style.top) + PET_SIZE / 2;
      var dotRadius = parseInt(dot.style.width) / 2 || 8;
      var dx = c.x - dotX;
      var dy = c.y - dotY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < COLLISION_RADIUS + dotRadius) {
        var nx = dx / dist;
        var ny = dy / dist;
        var pushDist = COLLISION_RADIUS + dotRadius + 1;
        px = c.x - PET_SIZE / 2 + nx * pushDist;
        py = c.y - PET_SIZE / 2 + ny * pushDist;
        clampToViewport();
        applyPos();
        var vDot = vxFly * nx + vyFly * ny;
        if (vDot < 0) {
          vxFly = (vxFly - 2 * vDot * nx) * bounceCoef;
          vyFly = (vyFly - 2 * vDot * ny) * bounceCoef;
        }
        vyFly = Math.max(maxBounceVy(), vyFly);
        var speed = Math.sqrt(vxFly * vxFly + vyFly * vyFly);
        if (speed < 0.5) {
          vxFly = nx * 3;
          vyFly = ny * 3;
        }
        pokeSquash(Math.min(1.8, speed * 0.10));
        pet.classList.add('xsdoi-pet-bounce');
        setTimeout(function() { pet.classList.remove('xsdoi-pet-bounce'); }, 300);
        collisionCooldown = COLLISION_COOLDOWN;
        return true;
      }
    }
    return false;
  }

  function checkRibbonCollision() {
    if (collisionCooldown > 0) return;
    var pts = window.__xsdoiTrail && window.__xsdoiTrail.points || [];
    if (pts.length < 2) return false;
    var c = petCenter();
    var minDist = Infinity;
    var closestPoint = null;

    for (var i = 1; i < pts.length; i++) {
      var p0 = pts[i - 1];
      var p1 = pts[i];
      if (!p0._alpha || !p1._alpha || p0._alpha < 0.1 || p1._alpha < 0.1) continue;
      var dx = p1.x - p0.x;
      var dy = p1.y - p0.y;
      var lenSq = dx * dx + dy * dy;
      var t = lenSq > 0 ? Math.max(0, Math.min(1, ((c.x - p0.x) * dx + (c.y - p0.y) * dy) / lenSq)) : 0;
      var projX = p0.x + dx * t;
      var projY = p0.y + dy * t;
      var dist = Math.sqrt((c.x - projX) * (c.x - projX) + (c.y - projY) * (c.y - projY));
      if (dist < minDist) {
        minDist = dist;
        closestPoint = { x: projX, y: projY };
      }
    }

    if (!closestPoint || minDist > COLLISION_RADIUS) return false;

    var nx = (c.x - closestPoint.x) / minDist || 0;
    var ny = (c.y - closestPoint.y) / minDist || 1;

    var pushDist = COLLISION_RADIUS + 1;
    px = c.x - PET_SIZE / 2 + nx * pushDist;
    py = c.y - PET_SIZE / 2 + ny * pushDist;
    clampToViewport();
    applyPos();

    var vDotN = vxFly * nx + vyFly * ny;
    if (vDotN < 0) {
      vxFly = (vxFly - 2 * vDotN * nx) * bounceCoef;
      vyFly = (vyFly - 2 * vDotN * ny) * bounceCoef;
    }

    vyFly = Math.max(maxBounceVy(), vyFly);
    var newSpeed = Math.sqrt(vxFly * vxFly + vyFly * vyFly);
    if (newSpeed < 0.5) {
      vxFly = nx * 3;
      vyFly = ny * 3;
    }
    pokeSquash(Math.min(1.8, newSpeed * 0.10));

    pet.classList.add('xsdoi-pet-bounce');
    setTimeout(function() { pet.classList.remove('xsdoi-pet-bounce'); }, 300);
    collisionCooldown = COLLISION_COOLDOWN;
    return true;
  }

  function checkTrailCollision() {
    if (!window.__xsdoiTrail) return;
    var mode = window.__xsdoiTrail.mode;
    if (mode === 'dots') {
      checkDotCollision();
    } else if (mode === 'ribbon') {
      checkRibbonCollision();
    }
  }

  function snapToEdge() {
    var snapped = false;
    if (px < SNAP) { px = MARGIN; snapped = true; }
    else if (px > vw - PET_SIZE - SNAP) { px = vw - PET_SIZE - MARGIN; snapped = true; }
    if (py < SNAP) { py = MARGIN; snapped = true; }
    else if (py > vh - PET_SIZE - SNAP) { py = vh - PET_SIZE - MARGIN; snapped = true; }
    if (snapped) applyPos();
  }

  // 扩展上下文是否仍然有效（扩展被重载/卸载后 content script 调用 chrome.* 会抛
  // "Extension context invalidated"，此时 chrome.runtime.id 变为 undefined）
  function isCtxValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // ---------- 初始化 ----------
  function load() {
    // 顺手清理「已删除的 AI 聊天」遗留的配置：API 地址 / 模型 / **API Key** / 系统提示词。
    // API Key 是敏感信息，功能都删了就不该继续躺在 storage.sync（会跟着账号同步走）里。
    // ⚠️ 会话历史（webPetSessions / webPetCurrentSessionId）**故意不动** —— 那是用户数据，
    //    要清得用户自己发话。
    var LEGACY_CHAT_KEYS = ['webPetApiUrl', 'webPetModel', 'webPetApiKey', 'webPetSystemPrompt'];
    chrome.storage.sync.get([STORAGE_KEY, ENABLE_KEY, CROP_KEY, BOUNCE_KEY, THROW_KEY].concat(LEGACY_CHAT_KEYS), function (items) {
      var stale = LEGACY_CHAT_KEYS.filter(function (k) { return items[k] !== undefined; });
      if (stale.length) {
        try { chrome.storage.sync.remove(stale); } catch (e) { /* 上下文失效等忽略 */ }
      }
      enabled = items[ENABLE_KEY] !== false;
      crop = normalizeCrop(items[CROP_KEY]);
      bounceCoef = normalizeBounce(items[BOUNCE_KEY]);
      throwCoef = normalizeThrow(items[THROW_KEY]);
      var sp = items[STORAGE_KEY];
      if (sp) {
        // 只恢复水平位置；垂直位置强制贴底——桌宠每次生成直接出现在底部散步，
        // 不再从旧存储位置/随机高度"落"到地面。
        if (typeof sp.x === 'number') pos.x = sp.x;
        pos.y = 100;
      }
      ensureContainer();
      measure();
      toPx();
      py = groundY();   // 强制贴底：一出现就在地面，无下落过渡
      clampToViewport();
      applyPos();
      applyVisibility();
      chrome.storage.local.get([IMG_KEY], function (loc) {
        if (typeof loc[IMG_KEY] === 'string' && loc[IMG_KEY]) {
          customImg = loc[IMG_KEY];
        }
        renderFace();
        pickTarget();
        loop();
      });
    });
  }

  // popup 开关 / 图片变化时实时响应
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (!isCtxValid()) return;
    if (area === 'sync' && changes[ENABLE_KEY]) {
      enabled = changes[ENABLE_KEY].newValue !== false;
      applyVisibility();
    }
    if (area === 'sync' && changes[CROP_KEY]) {
      crop = normalizeCrop(changes[CROP_KEY].newValue);
      renderFace();
    }
    // 弹性 / 抛掷力度：不用重绘，下一帧 updateParabola 直接用新值
    if (area === 'sync' && changes[BOUNCE_KEY]) {
      bounceCoef = normalizeBounce(changes[BOUNCE_KEY].newValue);
    }
    if (area === 'sync' && changes[THROW_KEY]) {
      throwCoef = normalizeThrow(changes[THROW_KEY].newValue);
    }
    if (area === 'local' && changes[IMG_KEY]) {
      var v = changes[IMG_KEY].newValue;
      customImg = (typeof v === 'string' && v) ? v : null;
      renderFace();
    }
  });

  window.addEventListener('resize', function () {
    measure();
    clampToViewport();
    applyPos();
  });

  var style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);

  load();
})();

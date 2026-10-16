/**
 * KMUH TMS 高醫線上學習 F12 控制台一鍵注入腳本 (Zero-Install Console Snippet)
 * 適用場景：公用電腦、護理站或無法安裝 Tampermonkey 擴充套件的環境。
 * 使用方式：在 TMS 課程播放頁面按 F12 -> 切換到「Console (主控台)」 -> 貼上本段代碼 -> 按 Enter 執行。
 */
(() => {
  const SPEED = 2.5; // 預設倍速，可自行修改為 2.0、3.0 等
  console.log('%c[KMUH TMS 助手] 正在啟動一鍵加速與防暫停...', 'background:#2563eb;color:#fff;padding:4px 8px;border-radius:4px;');

  // 1. 覆蓋 Document 焦點狀態，防止切換分頁暫停
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  } catch (e) {}

  const blocked = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'pagehide'];
  blocked.forEach(evt => {
    window.addEventListener(evt, e => e.stopImmediatePropagation(), true);
    document.addEventListener(evt, e => e.stopImmediatePropagation(), true);
  });

  // 2. 處理現存與未來影片
  function handleVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      v.playbackRate = SPEED;
      v.muted = true; // 靜音避免發出雜音
      if (v.paused && !v.ended) {
        v.play().catch(() => {});
      }
      if (!v.__kmuh_hooked) {
        v.__kmuh_hooked = true;
        v.addEventListener('ended', () => {
          console.log('[KMUH TMS] 單元結束，嘗試自動點擊下一課...');
          setTimeout(clickNext, 1500);
        });
      }
    });
  }

  // 3. 自動點擊下一單元
  function clickNext() {
    const btn = document.querySelector(
      'button[data-role="next"], a.next-chapter, .next-btn, .fs-next-btn, #next_btn, a[title="下一單元"]'
    );
    if (btn) {
      btn.click();
      console.log('[KMUH TMS] 已點擊下一單元');
    }
  }

  // 4. 自動關閉確認彈窗
  function dismissModals() {
    document.querySelectorAll('.modal.in button, .modal.show button, .bootbox button').forEach(b => {
      const txt = b.innerText.trim();
      if (['確定', '確認', '繼續', '繼續觀看', '我知道了', '關閉'].includes(txt)) {
        b.click();
      }
    });
  }

  // 5. 注入綠色指示徽章
  let badge = document.getElementById('kmuh-console-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'kmuh-console-badge';
    badge.style.cssText =
      'position:fixed;bottom:20px;right:20px;background:#10b981;color:#fff;padding:8px 14px;border-radius:20px;font-size:12px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:sans-serif;font-weight:bold;';
    badge.innerText = `TMS 助手運行中 (${SPEED}x | 防失焦)`;
    document.body.appendChild(badge);
  }

  // 循環監控
  const loop = setInterval(() => {
    handleVideos();
    dismissModals();
    const v = document.querySelector('video');
    if (v && v.duration) {
      const pct = Math.floor((v.currentTime / v.duration) * 100);
      badge.innerText = `TMS 進行中: ${pct}% (${SPEED}x)`;
    }
  }, 1000);

  window.__kmuh_tms_stop = () => {
    clearInterval(loop);
    if (badge) badge.remove();
    console.log('[KMUH TMS] 助手已停止');
  };

  console.log('%c[KMUH TMS 助手] 已就緒！輸入 __kmuh_tms_stop() 可隨時停止。', 'color:#10b981;font-weight:bold;');
})();

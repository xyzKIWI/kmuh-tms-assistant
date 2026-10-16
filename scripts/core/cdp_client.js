/**
 * KMUH TMS Assistant 2.0 - Core CDP Client
 * Zero-extension native browser automation via Chrome DevTools Protocol (port 9222).
 */

const DEFAULT_PORT = 9222;

const ANTI_BLUR_SCRIPT = `(() => {
  try {
    // Neutralize any residual Tampermonkey userscript automation & remove its UI
    localStorage.setItem('kmuh_tms_config', JSON.stringify({
      speed: 1.0, antiBlur: true, autoNext: false, autoSurvey: false, autoExam: false, autoCurriculum: false, minimized: true
    }));
    localStorage.removeItem('kmuh_autopilot_running');
    const cleanLegacyUI = () => {
      document.querySelectorAll('#kmuh-tms-panel, #kmuh-tms-header, #kmuh-pending-banner').forEach(el => {
        const root = el.closest('div[style*="fixed"]') || el;
        root.remove();
      });
    };
    cleanLegacyUI();
    document.addEventListener('DOMContentLoaded', cleanLegacyUI);
    setTimeout(cleanLegacyUI, 1000);

    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(document, 'webkitHidden', { get: () => false, configurable: true });
    document.hasFocus = () => true;
    window.addEventListener('blur', (e) => e.stopImmediatePropagation(), true);
    document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  } catch (e) {}
})()`;

async function getTabs(port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  return await res.json();
}

async function closeTab(tabId, port = DEFAULT_PORT) {
  try {
    const tabs = await getTabs(port);
    const pages = tabs.filter(t => t.type === 'page');
    // Guard: If closing this tab would leave 0 pages, open a persistent home tab first
    if (pages.length <= 1 && pages.some(p => p.id === tabId)) {
      await fetch(`http://127.0.0.1:${port}/json/new?https://tms.kmuh.org.tw/`, { method: 'PUT' });
      await new Promise(r => setTimeout(r, 1000));
    }
    await fetch(`http://127.0.0.1:${port}/json/close/${tabId}`);
    return true;
  } catch (e) {
    return false;
  }
}

function sendCdpCommand(wsUrl, method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const reqId = Math.floor(Math.random() * 1000000);
    const ws = new WebSocket(wsUrl);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch (e) {}
        reject(new Error(`CDP timeout (${timeoutMs}ms) on ${method}`));
      }
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: reqId, method, params }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id === reqId) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch (e) {}
          resolve(data.result);
        }
      } catch (e) {}
    };

    ws.onerror = (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    };
  });
}

async function evalTab(wsUrl, expression, timeoutMs = 30000) {
  try {
    const res = await sendCdpCommand(
      wsUrl,
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      timeoutMs
    );
    return res?.result?.value;
  } catch (err) {
    return null;
  }
}


async function injectAntiBlur(wsUrl) {
  try {
    await evalTab(wsUrl, ANTI_BLUR_SCRIPT);
  } catch (e) {}
}

async function openTab(url, waitMs = 3500, port = DEFAULT_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${url}`, {
    method: 'PUT'
  });
  const tab = await res.json();
  if (tab.webSocketDebuggerUrl) {
    await injectAntiBlur(tab.webSocketDebuggerUrl);
  }
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return tab;
}

async function navigateTab(wsUrl, url, waitMs = 3000) {
  await sendCdpCommand(wsUrl, 'Page.navigate', { url });
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

module.exports = {
  DEFAULT_PORT,
  ANTI_BLUR_SCRIPT,
  getTabs,
  openTab,
  closeTab,
  evalTab,
  sendCdpCommand,
  injectAntiBlur,
  navigateTab
};

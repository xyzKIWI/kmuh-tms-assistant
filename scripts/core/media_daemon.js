/**
 * KMUH TMS Assistant 2.0 - Concurrent Media Daemon
 * Manages parallel 1.0x compliant video playback, heartbeat monitoring,
 * automatic .fs-endReading settlement, and immediate physical tab closure.
 */

const { getTabs, openTab, closeTab, evalTab, injectAntiBlur } = require('./cdp_client');

function parseTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const clean = timeStr.replace(/^[^\d]*/, '').trim();
  const parts = clean.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

async function setupMediaTab(task) {
  const mediaUrl = task.url || `https://tms.kmuh.org.tw/media/${task.mediaId}`;
  const tabs = await getTabs();
  let tab = tabs.find((t) => t.url.includes(`/media/${task.mediaId}`));

  if (!tab) {
    tab = await openTab(mediaUrl, 4000);
  } else {
    await injectAntiBlur(tab.webSocketDebuggerUrl);
  }

  task.tabId = tab.id;
  task.wsUrl = tab.webSocketDebuggerUrl;
  task.targetSec = (task.targetMin || 15) * 60;
  task.done = false;

  await evalTab(
    task.wsUrl,
    `(() => {
      // Low-Power Pause-and-Clock: pause video decoding (0% CPU/GPU, 0 bandwidth) while keeping ReadingClock active
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        if (!v.paused) v.pause();
      }
      if (!window.__kmuh_media_keeper) {
        window.__kmuh_media_keeper = setInterval(() => {
          const vid = document.querySelector('video');
          if (vid && !vid.paused) {
            vid.muted = true;
            vid.pause();
          }
          document.querySelectorAll('.modal.in button, .bootbox button, .swal2-confirm').forEach(b => {
            if (/確定|確認|繼續/.test(b.innerText)) b.click();
          });
        }, 2000);
      }
    })()`
  );

  console.log(`[MediaDaemon] Launched Low-Power [${task.courseId || ''}/${task.mediaId}] ${task.title || ''} (Target: ${task.targetMin}m)`);
}

async function checkAndSettleTask(task) {
  if (task.done) return true;

  const tabs = await getTabs();
  const liveTab = tabs.find((t) => t.id === task.tabId);
  if (!liveTab) {
    task.done = true;
    return true;
  }

  // If the page already redirected back to /course/ after auto-settlement, close it
  if (liveTab.url.includes('/course/') && !liveTab.url.includes('/media/')) {
    console.log(`[MediaDaemon] [${task.title}] Redirected to course page. Closing tab...`);
    await closeTab(task.tabId);
    task.done = true;
    return true;
  }

  task.wsUrl = liveTab.webSocketDebuggerUrl;

  const status = await evalTab(
    task.wsUrl,
    `(() => {
      if (document.body.innerText.includes('重覆開啟多個相同的視窗') || document.body.innerText.includes('--:--:--')) {
        location.reload();
        return { userTime: null, videoTime: 0, paused: true, reloaded: true };
      }
      const vid = document.querySelector('video');
      if (vid && !vid.paused) {
        vid.muted = true;
        vid.pause();
      }
      const text = document.body.innerText || '';
      const matches = Array.from(text.matchAll(/([\\u4e00-\\u9fa5]{2,4}):\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)/g));
      const valid = matches.find(m => !/長度|總長/.test(m[1]));
      return {
        userTime: valid ? valid[0] : null,
        videoTime: Math.floor(vid?.currentTime || 0),
        paused: vid ? vid.paused : true
      };
    })()`
  );

  if (status) {
    const elapsedSec = status.userTime ? parseTimeToSeconds(status.userTime) : 0;
    const effectiveSec = Math.max(elapsedSec, status.videoTime || 0);
    console.log(
      `[MediaDaemon] [${task.title || task.mediaId}] Progress: ${effectiveSec}s / ${task.targetSec}s (header: ${status.userTime || 'N/A'}, video: ${status.videoTime}s) | LowPower: ${status.paused}`
    );

    if (effectiveSec >= task.targetSec) {
      console.log(`🎯 [MediaDaemon] [${task.title || task.mediaId}] Target reached (${effectiveSec}s >= ${task.targetSec}s)! Settling reading...`);
      await evalTab(
        task.wsUrl,
        `(() => {
          const endBtn = document.querySelector('.fs-endReading, a.navbar-brand') ||
            Array.from(document.querySelectorAll('a, button')).find(b => b.innerText && b.innerText.includes('結束閱讀'));
          if (endBtn) endBtn.click();
        })()`
      );
      await new Promise((r) => setTimeout(r, 3500));
      await closeTab(task.tabId);
      task.done = true;
      console.log(`✅ [MediaDaemon] [${task.title || task.mediaId}] Settled and tab closed!`);
      return true;
    }
  }

  return false;
}

async function runMediaPool(tasks, maxConcurrency = 6, pollIntervalMs = 15000, onMediaDone = null) {
  const pending = [...tasks];
  const active = [];

  while (active.length < maxConcurrency && pending.length > 0) {
    const t = pending.shift();
    try {
      await setupMediaTab(t);
      active.push(t);
    } catch (e) {
      console.warn(`[MediaPool] Error setting up tab [${t.mediaId}], re-queuing:`, e.message);
      pending.push(t);
    }
    if (pending.length > 0) await new Promise((r) => setTimeout(r, 2500));
  }

  while (active.length > 0) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    for (let i = active.length - 1; i >= 0; i--) {
      const task = active[i];
      let done = false;
      try {
        done = await checkAndSettleTask(task);
      } catch (e) {
        // retry on next tick
      }
      if (done) {
        active.splice(i, 1);
        if (onMediaDone) {
          try {
            await onMediaDone(task);
          } catch (e) {
            console.error('[MediaPool] Callback error:', e);
          }
        }
        if (pending.length > 0 && active.length < maxConcurrency) {
          const next = pending.shift();
          try {
            await setupMediaTab(next);
            active.push(next);
          } catch (e) {
            console.warn(`[MediaPool] Error setting up next tab [${next.mediaId}], re-queuing:`, e.message);
            pending.push(next);
          }
        }
      }
    }
  }
  console.log('🎉 [MediaDaemon] All media tasks in pool completed and closed!');
}


async function runMediaBatch(tasks, pollIntervalMs = 15000) {
  return await runMediaPool(tasks, tasks.length, pollIntervalMs);
}

module.exports = {
  parseTimeToSeconds,
  setupMediaTab,
  checkAndSettleTask,
  runMediaBatch,
  runMediaPool
};


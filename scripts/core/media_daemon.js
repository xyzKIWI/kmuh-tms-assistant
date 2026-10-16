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
      const v = document.querySelector('video');
      if (v) {
        v.muted = true;
        v.playbackRate = 1.0;
        v.play().catch(() => {});
      }
      if (!window.__kmuh_media_keeper) {
        window.__kmuh_media_keeper = setInterval(() => {
          const vid = document.querySelector('video');
          if (vid && vid.paused && !vid.ended) {
            vid.muted = true;
            vid.play().catch(() => {});
          }
          document.querySelectorAll('.modal.in button, .bootbox button, .swal2-confirm').forEach(b => {
            if (/確定|確認|繼續/.test(b.innerText)) b.click();
          });
        }, 2000);
      }
    })()`
  );

  console.log(`[MediaDaemon] Launched [${task.courseId || ''}/${task.mediaId}] ${task.title || ''} (Target: ${task.targetMin}m)`);
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
      const vid = document.querySelector('video');
      if (vid && vid.paused && !vid.ended) {
        vid.muted = true;
        vid.play().catch(() => {});
      }
      const text = document.body.innerText || '';
      const match = text.match(/[\\u4e00-\\u9fa5]{2,4}:\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)/);
      return {
        userTime: match ? match[0] : null,
        videoTime: Math.floor(vid?.currentTime || 0),
        paused: !!vid?.paused
      };
    })()`
  );

  if (status && status.userTime) {
    const elapsedSec = parseTimeToSeconds(status.userTime);
    console.log(
      `[MediaDaemon] [${task.title || task.mediaId}] Read: ${status.userTime} (${elapsedSec}s / ${task.targetSec}s) | Video: ${status.videoTime}s | Paused: ${status.paused}`
    );

    if (elapsedSec >= task.targetSec) {
      console.log(`🎯 [MediaDaemon] [${task.title || task.mediaId}] Target reached! Settling reading...`);
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

async function runMediaBatch(tasks, pollIntervalMs = 15000) {
  for (const task of tasks) {
    await setupMediaTab(task);
  }

  while (true) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    let allDone = true;
    for (const task of tasks) {
      try {
        const done = await checkAndSettleTask(task);
        if (!done) allDone = false;
      } catch (e) {
        allDone = false;
      }
    }
    if (allDone) {
      console.log('🎉 [MediaDaemon] All media tasks in batch completed and closed!');
      break;
    }
  }
}

module.exports = {
  parseTimeToSeconds,
  setupMediaTab,
  checkAndSettleTask,
  runMediaBatch
};

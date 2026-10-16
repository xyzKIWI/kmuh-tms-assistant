/**
 * KMUH TMS Assistant 2.0 - Survey Engine
 * Automatically completes 5-star satisfaction questionnaires and closes the tab.
 */

const { openTab, closeTab, evalTab } = require('./cdp_client');

async function completeSurvey(pollUrl) {
  console.log(`[SurveyEngine] Opening survey: ${pollUrl}`);
  const tab = await openTab(pollUrl, 3000);
  const wsUrl = tab.webSocketDebuggerUrl;

  try {
    // Step 1: Check if expired or already completed
    const pageCheck = await evalTab(
      wsUrl,
      `(() => {
        const text = document.body.innerText || '';
        if (text.includes('已經過了期限') || text.includes('無法填寫問卷')) {
          return { status: 'expired' };
        }
        const startBtn = Array.from(document.querySelectorAll('button, a')).find(
          b => b.innerText && b.innerText.includes('開始填寫')
        );
        if (startBtn) {
          startBtn.click();
          return { status: 'started' };
        }
        return { status: 'ready' };
      })()`
    );

    if (pageCheck?.status === 'expired') {
      console.log(`[SurveyEngine] Survey expired (${pollUrl}), skipping and closing.`);
      await closeTab(tab.id);
      return { success: false, reason: 'expired' };
    }

    if (pageCheck?.status === 'started') {
      await new Promise((r) => setTimeout(r, 2500));
    }

    // Step 2: Fill all radio groups (5-star / very satisfied / physician role) and textareas
    const fillResult = await evalTab(
      wsUrl,
      `(() => {
        const radioGroups = {};
        document.querySelectorAll('input[type="radio"]').forEach(r => {
          if (!radioGroups[r.name]) radioGroups[r.name] = [];
          radioGroups[r.name].push(r);
        });

        let filledCount = 0;
        for (const name in radioGroups) {
          const group = radioGroups[name];
          const roleOption = group.find(r => r.parentElement?.innerText?.includes('醫師'));
          const fiveStar = group.find(
            r =>
              r.value === '5' ||
              r.parentElement?.innerText?.includes('非常滿意') ||
              r.parentElement?.innerText?.includes('非常同意') ||
              r.parentElement?.innerText?.includes('非常符合')
          );
          const target = roleOption || fiveStar || group[0];
          if (target) {
            target.checked = true;
            target.click();
            target.dispatchEvent(new Event('change', { bubbles: true }));
            filledCount++;
          }
        }

        document.querySelectorAll('textarea, input[type="text"]').forEach(t => {
          if (t.name !== 'navbarSearch' && !t.value) {
            t.value = '無建議，課程內容豐富實用，收穫良多！';
            t.dispatchEvent(new Event('input', { bubbles: true }));
            t.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });

        const submitBtn = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn')).find(
          b => {
            const txt = (b.innerText || b.value || '').trim();
            return txt === '送出' || txt === '交卷' || b.getAttribute('role') === 'submit-exam';
          }
        );

        if (submitBtn) {
          submitBtn.click();
          return { filledCount, submitted: true };
        }
        return { filledCount, submitted: false };
      })()`
    );

    if (fillResult?.submitted) {
      await new Promise((r) => setTimeout(r, 2000));
      // Confirm Bootbox dialog if present
      await evalTab(
        wsUrl,
        `(() => {
          const confirmBtn =
            document.querySelector('button[data-bb-handler="confirm"], .bootbox .btn-primary') ||
            Array.from(document.querySelectorAll('.modal button')).find(b => /確定|送出|交卷/.test(b.innerText));
          if (confirmBtn) confirmBtn.click();
        })()`
      );
      await new Promise((r) => setTimeout(r, 2500));
      console.log(`✅ [SurveyEngine] Survey submitted (${fillResult.filledCount} items filled). Closing tab...`);
    }
  } finally {
    await closeTab(tab.id);
  }

  return { success: true };
}

module.exports = {
  completeSurvey
};

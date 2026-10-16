/**
 * KMUH TMS Assistant 2.0 - Program Auditor & Course Enroller
 * Audits curriculum progress, calculates shortfalls, crawls online catalog,
 * and auto-enrolls in highest-yield short courses.
 */

const { openTab, closeTab, evalTab, navigateTab } = require('./cdp_client');

// Known expired or non-actionable historical courses to skip
const IGNORED_COURSE_IDS = new Set(['24136']);

async function auditProgram(programId = '10713') {
  const url = `https://tms.kmuh.org.tw/program/showMy/${programId}`;
  const tab = await openTab(url, 3500);
  const wsUrl = tab.webSocketDebuggerUrl;

  try {
    const audit = await evalTab(
      wsUrl,
      `(() => {
        const text = document.body.innerText || '';
        const recognized = parseFloat(text.match(/已認列[:：\\s]*([\\d\\.]+)\\s*積分/)?.[1] || '0');
        const shortfall = parseFloat(text.match(/總稽核值不足[\\s\\n]*([\\d\\.]+)/)?.[1] || '0');
        const totalRequired = parseFloat(text.match(/總稽核值[\\s\\n]+([\\d\\.]+)/)?.[1] || '30');
        const completed = text.includes('狀態: 已完成') || shortfall === 0;

        const nodes = Array.from(document.querySelectorAll('.xtree-node, .node')).map(n => {
          const link = n.querySelector('a[href*="category="]');
          return {
            categoryName: link?.innerText?.trim() || '',
            categoryUrl: link?.href || '',
            rawText: n.innerText.replace(/\\s+/g, ' ').trim()
          };
        }).filter(n => n.categoryName);

        return {
          programId: '${programId}',
          recognized,
          shortfall,
          totalRequired,
          completed,
          nodes
        };
      })()`
    );
    return audit;
  } finally {
    await closeTab(tab.id);
  }
}

async function enrollAndExtractCourse(courseId) {
  if (IGNORED_COURSE_IDS.has(String(courseId))) {
    return { skipped: true, reason: 'ignored_historical_course' };
  }

  const courseUrl = `https://tms.kmuh.org.tw/course/${courseId}`;
  const tab = await openTab(courseUrl, 3000);
  const wsUrl = tab.webSocketDebuggerUrl;

  try {
    // Click signup button if present
    const signedUp = await evalTab(
      wsUrl,
      `(() => {
        const btn = document.querySelector('.js-signup, button[data-action="signup"], a.js-signup');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()`
    );

    if (signedUp) {
      await new Promise((r) => setTimeout(r, 2000));
      await evalTab(
        wsUrl,
        `(() => {
          const confirmBtn = document.querySelector('.bootbox .btn-primary, button[data-bb-handler="confirm"]');
          if (confirmBtn) confirmBtn.click();
        })()`
      );
      await new Promise((r) => setTimeout(r, 2000));
      await navigateTab(wsUrl, courseUrl, 2500);
    }

    const details = await evalTab(
      wsUrl,
      `(() => {
        const text = document.body.innerText || '';
        const isCompleted = text.includes('完成課程') && text.includes('重覆閱讀不會重覆取得時數');
        const reqMinMatch = text.match(/閱讀達\\s*(\\d+)\\s*分鐘/);
        const requiredMin = reqMinMatch ? Number(reqMinMatch[1]) : null;

        const links = Array.from(document.querySelectorAll('a'))
          .map(a => ({ text: a.innerText.trim(), href: a.href }))
          .filter(
            a =>
              (a.href.includes('/media/') || a.href.includes('/exam/') || a.href.includes('/poll/')) &&
              !a.href.includes('learning.xms.tw') &&
              !a.text.includes('活動相簿')
          );

        return {
          courseId: '${courseId}',
          title: document.title,
          isCompleted,
          requiredMin,
          units: links
        };
      })()`
    );

    return details;
  } finally {
    await closeTab(tab.id);
  }
}

module.exports = {
  IGNORED_COURSE_IDS,
  auditProgram,
  enrollAndExtractCourse
};

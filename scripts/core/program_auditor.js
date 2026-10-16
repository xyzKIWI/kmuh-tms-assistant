/**
 * KMUH TMS Assistant 2.1 - Universal Program Auditor, Scanner & Course Enroller
 * Supports multi-unit programs (積分 / 小時), personal pending/assigned course scanning,
 * keyword/category online catalog search, role-restriction filtering, and unit-level extraction.
 */

const { openTab, closeTab, evalTab, navigateTab } = require('./cdp_client');

// Known expired or non-actionable historical courses to skip
const IGNORED_COURSE_IDS = new Set(['24136']);

async function auditProgram(programId = '10713') {
  const cleanId = String(programId).replace(/^.*\/program\/showMy\//, '').trim();
  const url = `https://tms.kmuh.org.tw/program/showMy/${cleanId}`;
  const tab = await openTab(url, 3500);
  const wsUrl = tab.webSocketDebuggerUrl;

  try {
    const audit = await evalTab(
      wsUrl,
      `(() => {
        const text = document.body.innerText || '';
        const unitMatch = text.match(/總稽核值[\\s\\n]*[\\d\\.]+\\s*(積分|小時|點)/) || text.match(/已認列[:：\\s]*[\\d\\.]+\\s*(積分|小時|點)/);
        const unit = unitMatch ? unitMatch[1] : '積分';
        const nameMatch = text.match(/學程名稱[\\s\\n]+([^\\n]+)/);
        const programName = nameMatch ? nameMatch[1].trim() : document.title;

        const recognized = parseFloat(text.match(/已認列[:：\\s]*([\\d\\.]+)\\s*(?:積分|小時|點)?/)?.[1] || '0');
        const shortfall = parseFloat(text.match(/總稽核值不足[\\s\\n]*([\\d\\.]+)/)?.[1] || '0');
        const totalRequired = parseFloat(text.match(/總稽核值[\\s\\n]+([\\d\\.]+)/)?.[1] || '30');
        const completed = text.includes('狀態: 已完成') || (shortfall === 0 && recognized >= totalRequired);

        const nodes = Array.from(document.querySelectorAll('.xtree-node, .node, table tr')).map(n => {
          const catLink = n.querySelector('a[href*="category="]');
          const courseLink = n.querySelector('a[href*="/course/"]');
          if (!catLink && !courseLink) return null;
          const catIdMatch = catLink?.href?.match(/category=(\\d+)/);
          const courseIdMatch = courseLink?.href?.match(/\\/course\\/(\\d+)/);
          return {
            type: catLink ? 'category' : 'course',
            categoryName: (catLink || courseLink)?.innerText?.trim() || '',
            categoryId: catIdMatch ? catIdMatch[1] : null,
            courseId: courseIdMatch ? courseIdMatch[1] : null,
            url: (catLink || courseLink)?.href || '',
            rawText: n.innerText.replace(/\\s+/g, ' ').trim()
          };
        }).filter(Boolean);

        return {
          programId: '${cleanId}',
          programName,
          unit,
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

async function scanMyCourses() {
  const url = 'https://tms.kmuh.org.tw/course/mine';
  const tab = await openTab(url, 3000);
  const wsUrl = tab.webSocketDebuggerUrl;

  try {
    const res = await evalTab(
      wsUrl,
      `(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const pendingCourses = [];
        const seen = new Set();

        // Extract rows inside 待修課程 and 被調訓的課程 tables
        const tables = Array.from(document.querySelectorAll('table'));
        for (const tbl of tables) {
          const tblText = tbl.innerText || '';
          if (tblText.includes('已經通過') || tblText.includes('通過')) {
            // Skip completed courses table if header has 通過
            const ths = Array.from(tbl.querySelectorAll('th, td')).slice(0, 3).map(e => e.innerText.trim());
            if (ths.includes('通過')) continue;
          }
          for (const tr of Array.from(tbl.querySelectorAll('tr'))) {
            const a = tr.querySelector('a[href*="/course/"]');
            if (!a) continue;
            const m = a.href.match(/\\/course\\/(\\d+)$/);
            if (!m) continue;
            const cid = m[1];
            if (seen.has(cid)) continue;
            seen.add(cid);
            pendingCourses.push({
              courseId: cid,
              title: a.innerText.trim(),
              href: a.href,
              rowText: tr.innerText.replace(/\\s+/g, ' ').trim()
            });
          }
        }

        return { pendingCourses };
      })()`
    );

    res.pendingCourses = (res.pendingCourses || []).filter(
      (c) => !IGNORED_COURSE_IDS.has(String(c.courseId))
    );
    return res;
  } finally {
    await closeTab(tab.id);
  }
}

async function searchOnlineCourses({ keyword = '', categoryId = 0, page = 1 } = {}) {
  const url =
    `https://tms.kmuh.org.tw/course/latest?programId=0&defaultOrder=publishDate&inSign=ing` +
    `&applyExternalCredit=0&search=${encodeURIComponent(keyword)}&division=0` +
    `&category=${categoryId}&property=online&includeAllCertification=0&page=${page}`;
  const tab = await openTab(url, 3000);
  const wsUrl = tab.webSocketDebuggerUrl;

  try {
    const courses = await evalTab(
      wsUrl,
      `(() => {
        return Array.from(document.querySelectorAll('table tr'))
          .slice(1)
          .map(r => {
            const tds = Array.from(r.querySelectorAll('td')).map(d => d.innerText.trim());
            if (!tds[0] || !/^\\d+$/.test(tds[0])) return null;
            return {
              courseId: tds[0],
              title: tds[1] || '',
              type: tds[2] || '',
              category: tds[3] || '',
              hours: parseFloat(tds[4] || '0'),
              credits: parseFloat(tds[5] || '0'),
              date: tds[6] || '',
              status: tds[7] || ''
            };
          })
          .filter(Boolean);
      })()`
    );
    return courses.filter((c) => !IGNORED_COURSE_IDS.has(String(c.courseId)));
  } finally {
    await closeTab(tab.id);
  }
}

async function enrollAndExtractCourse(courseIdOrUrl) {
  const cleanId = String(courseIdOrUrl).replace(/^.*\/course\//, '').replace(/\/.*$/, '').trim();
  if (IGNORED_COURSE_IDS.has(cleanId)) {
    return { courseId: cleanId, skipped: true, reason: 'ignored_historical_course' };
  }

  const courseUrl = `https://tms.kmuh.org.tw/course/${cleanId}`;
  const tab = await openTab(courseUrl, 3000);
  const wsUrl = tab.webSocketDebuggerUrl;

  try {
    // Check role restriction before signup
    const preCheck = await evalTab(
      wsUrl,
      `(() => {
        const text = document.body.innerText || '';
        const roleMatch = text.match(/僅\\s*([^\\s]+)\\s*角色可以報名/);
        const btn = document.querySelector('.js-signup, button[data-action="signup"], a.js-signup');
        const hasUnits = document.querySelectorAll('a[href*="/media/"], a[href*="/poll/"], a[href*="/exam/"]').length > 2;
        if (btn && !hasUnits) {
          btn.click();
          return { clickedSignup: true, roleRestriction: roleMatch ? roleMatch[1] : null };
        }
        return { clickedSignup: false, roleRestriction: roleMatch ? roleMatch[1] : null, hasUnits };
      })()`
    );

    if (preCheck && preCheck.clickedSignup) {
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
        const isCompleted =
          (text.includes('完成課程') && text.includes('重覆閱讀不會重覆取得時數')) ||
          text.includes('您已經通過此課程');
        const isMandatoryAssigned = text.includes('此為調訓課程');

        // Parse unit rows from the course content table
        const rows = Array.from(document.querySelectorAll('table tr'));
        const units = [];

        for (const tr of rows) {
          const a = tr.querySelector('a');
          if (!a || !a.href) continue;
          if (a.href.includes('learning.xms.tw') || a.innerText.includes('活動相簿')) continue;
          if (!/\\/(media|exam|poll)\\//.test(a.href)) continue;

          const rowText = tr.innerText.replace(/\\s+/g, ' ').trim();
          const reqMinMatch = rowText.match(/閱讀達\\s*(\\d+)\\s*分鐘/);
          const requiredMin = reqMinMatch ? Number(reqMinMatch[1]) : 0;
          const mediaMatch = a.href.match(/\\/media\\/(\\d+)/);
          const type = a.href.includes('/media/')
            ? 'media'
            : a.href.includes('/poll/')
            ? 'poll'
            : 'exam';

          // Check if this specific unit row is already completed
          const passed =
            isCompleted ||
            rowText.includes('已完成') ||
            rowText.includes('通過') && !rowText.includes('通過條件');

          units.push({
            title: a.innerText.trim(),
            href: a.href,
            type,
            mediaId: mediaMatch ? mediaMatch[1] : null,
            requiredMin,
            passed,
            rowText
          });
        }

        // Fallback if table rows were not structured as expected
        if (units.length === 0) {
          const fallbackMinMatch = text.match(/閱讀達\\s*(\\d+)\\s*分鐘/);
          const fallbackMin = fallbackMinMatch ? Number(fallbackMinMatch[1]) : 0;
          const links = Array.from(document.querySelectorAll('a'))
            .filter(
              a =>
                (a.href.includes('/media/') || a.href.includes('/exam/') || a.href.includes('/poll/')) &&
                !a.href.includes('learning.xms.tw') &&
                !a.innerText.includes('活動相簿')
            );
          for (const a of links) {
            const mediaMatch = a.href.match(/\\/media\\/(\\d+)/);
            const type = a.href.includes('/media/')
              ? 'media'
              : a.href.includes('/poll/')
              ? 'poll'
              : 'exam';
            units.push({
              title: a.innerText.trim(),
              href: a.href,
              type,
              mediaId: mediaMatch ? mediaMatch[1] : null,
              requiredMin: type === 'media' ? fallbackMin : 0,
              passed: isCompleted,
              rowText: a.innerText.trim()
            });
          }
        }

        return {
          courseId: '${cleanId}',
          title: document.title.replace(/\\s*\\|.*$/, '').trim(),
          isCompleted,
          isMandatoryAssigned,
          roleRestriction: ${JSON.stringify(preCheck?.roleRestriction || null)},
          enrolled: units.length > 0,
          units
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
  scanMyCourses,
  searchOnlineCourses,
  enrollAndExtractCourse
};

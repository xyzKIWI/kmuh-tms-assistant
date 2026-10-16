/**
 * KMUH TMS Assistant 2.2 - Universal Program Auditor, Mandatory Sub-Category Resolver & Course Enroller
 * Parses .xtree-node .ext-col columns accurately (fixing "1"+"0"+"0%" string concatenation),
 * tracks 必修不足 (requiredShortfall) & 面授不足 (faceToFaceShortfall),
 * and performs Leaf-First Mandatory Sub-Category Course Selection & Enrollment.
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
        const unitMatch =
          text.match(/總稽核值[\\s\\n]*[\\d\\.]+\\s*(積分|小時|點)/) ||
          text.match(/已認列[:：\\s]*[\\d\\.]+\\s*(積分|小時|點)/);
        const unit = unitMatch ? unitMatch[1] : '積分';
        const nameMatch = text.match(/學程名稱[\\s\\n]+([^\\n]+)/);
        const programName = nameMatch ? nameMatch[1].trim() : document.title;

        const recognized = parseFloat(
          text.match(/已認列[:：\\s]*([\\d\\.]+)\\s*(?:積分|小時|點)?/)?.[1] || '0'
        );
        const shortfall = parseFloat(text.match(/總稽核值不足[\\s\\n]*([\\d\\.]+)/)?.[1] || '0');
        const faceToFaceShortfall = parseFloat(text.match(/面授不足[\\s\\n]*([\\d\\.]+)/)?.[1] || '0');
        const requiredShortfall = parseFloat(text.match(/必修不足[\\s\\n]*([\\d\\.]+)/)?.[1] || '0');
        const totalRequired = parseFloat(text.match(/總稽核值[\\s\\n]+([\\d\\.]+)/)?.[1] || '30');

        const nodes = Array.from(document.querySelectorAll('.xtree-node')).map(li => {
          const h = li.querySelector(':scope > .header') || li.querySelector('.header');
          if (!h) return null;
          const cols = Array.from(h.querySelectorAll('.ext-col')).map(c => c.innerText.trim());
          const catLink = Array.from(h.querySelectorAll('a')).find(a => a.href.includes('category='));
          const courseLink = Array.from(h.querySelectorAll('a')).find(a => /\\/course\\/\\d+/.test(a.href));
          const link = catLink || courseLink;

          // Extract section number prefix (e.g. "3.1", "5.2", "12.3.1")
          const headerText = h.innerText.replace(/\\s+/g, ' ').trim();
          const secMatch = headerText.match(/(\\d+(?:\\.\\d+)*)\\.?\\s+([^\\s]+)/);
          const sectionNum = secMatch ? secMatch[1] : '';
          const categoryName = link ? link.innerText.trim() : (secMatch ? secMatch[2] : headerText);

          const mode = cols[2] || '全部';
          const required = cols[3] && cols[3] !== '-' ? parseFloat(cols[3]) || 0 : 0;
          const completedCredits = cols[4] && cols[4] !== '-' ? parseFloat(cols[4]) || 0 : 0;
          const progressText = cols[5] || (completedCredits >= required && required > 0 ? '100%' : '');
          const deficit = Math.max(0, Number((required - completedCredits).toFixed(2)));

          const catIdMatch = catLink?.href?.match(/category=(\\d+)/);
          const courseIdMatch = courseLink?.href?.match(/\\/course\\/(\\d+)/);

          return {
            id: li.id,
            sectionNum,
            type: catLink ? 'category' : courseLink ? 'course' : 'group',
            categoryName,
            categoryId: catIdMatch ? catIdMatch[1] : null,
            courseId: courseIdMatch ? courseIdMatch[1] : null,
            mode,
            required,
            completedCredits,
            deficit,
            progressText,
            url: link?.href || ''
          };
        }).filter(Boolean);

        const onlineDeficitNodes = nodes.filter(n => n.deficit > 0 && n.mode !== '面授');
        const completed =
          text.includes('狀態: 已完成') ||
          (shortfall === 0 && requiredShortfall === 0 && onlineDeficitNodes.length === 0);

        return {
          programId: '${cleanId}',
          programName,
          unit,
          recognized,
          totalRequired,
          shortfall,
          requiredShortfall,
          faceToFaceShortfall,
          completed,
          incompleteOnlineNodes: onlineDeficitNodes,
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
        const pendingCourses = [];
        const seen = new Set();

        const tables = Array.from(document.querySelectorAll('table'));
        for (const tbl of tables) {
          const ths = Array.from(tbl.querySelectorAll('th, td')).slice(0, 3).map(e => e.innerText.trim());
          if (ths.includes('通過')) continue;

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
    // Check role restriction and click .js-signup if present
    const preCheck = await evalTab(
      wsUrl,
      `(() => {
        const text = document.body.innerText || '';
        const roleMatch = text.match(/角色限制[\\s\\n]+([^\\n]+)/);
        const roleRestriction = roleMatch ? roleMatch[1].trim() : null;
        const isRestrictedOut =
          roleRestriction &&
          !roleRestriction.includes('岡山') &&
          !roleRestriction.includes('不限') &&
          !roleRestriction.includes('主治醫師') &&
          (roleRestriction.includes('僅') || roleRestriction.includes('限'));

        const btn = document.querySelector('.js-signup, button[data-action="signup"], a.js-signup');
        if (btn && !isRestrictedOut) {
          btn.click();
          return { clickedSignup: true, roleRestriction, isRestrictedOut: false };
        }
        return { clickedSignup: false, roleRestriction, isRestrictedOut: !!isRestrictedOut };
      })()`
    );

    if (preCheck && preCheck.clickedSignup) {
      await new Promise((r) => setTimeout(r, 2000));
      await evalTab(
        wsUrl,
        `(() => {
          const confirmBtn = document.querySelector('.bootbox .btn-primary, button[data-bb-handler="confirm"], .modal-footer .btn-primary');
          if (confirmBtn) confirmBtn.click();
        })()`
      );
      await new Promise((r) => setTimeout(r, 2200));
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

          const tds = Array.from(tr.querySelectorAll('td')).map(d => d.innerText.trim());
          const statusCol = tds[tds.length - 1] || '';
          const achievementCol = tds[tds.length - 2] || '';
          const passed =
            isCompleted ||
            achievementCol.includes('已完成') ||
            statusCol.includes('通過') ||
            rowText.includes('已完成');

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

        return {
          courseId: '${cleanId}',
          title: document.title.replace(/\\s*\\|.*$/, '').trim(),
          isCompleted,
          isMandatoryAssigned,
          roleRestriction: ${JSON.stringify(preCheck?.roleRestriction || null)},
          isRestrictedOut: ${Boolean(preCheck?.isRestrictedOut)},
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

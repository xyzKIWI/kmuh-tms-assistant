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
          // Click only visible confirm buttons (avoid hidden #confirmDropCourseModal buttons)
          const visibleConfirm = Array.from(
            document.querySelectorAll('.bootbox .btn-primary, .modal.in .btn-primary, button[data-bb-handler="confirm"], .modal button.btn-primary')
          ).find(b => b.offsetParent !== null && !String(b.id || '').includes('DropCourse'));
          if (visibleConfirm) visibleConfirm.click();
        })()`
      );
      await new Promise((r) => setTimeout(r, 2500));
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
        const hasExpiredWarning =
          text.includes('因部分課程內容已經超過通過期限') ||
          text.includes('此課程將無法完成');

        // KMUH TMS renders course units inside .xtree-node (or table tr)
        const containers = Array.from(document.querySelectorAll('#activityTree li.xtree-node, .xtree-node, table tr'));
        const units = [];
        const seenKeys = new Set();

        for (const el of containers) {
          const directLink = Array.from(el.querySelectorAll('a')).find(
            link =>
              link.href &&
              /\\/(media|exam|poll)\\//.test(link.href) &&
              !link.href.includes('learning.xms.tw') &&
              !link.innerText.includes('活動相簿')
          );

          const ajaxBtn = el.querySelector('a[id^="__button"]');
          const targetAnchor = directLink || ajaxBtn;
          if (!targetAnchor) continue;

          // Extract AJAX checkPassPrevious endpoint if href is "#"
          let ajaxUrl = null;
          if (!directLink && ajaxBtn && (window.jQuery || window.$)) {
            try {
              const $ = window.jQuery || window.$;
              const ev = $._data(ajaxBtn, 'events');
              const fnStr = ev && ev.click && ev.click[0] ? ev.click[0].handler.toString() : '';
              const m = fnStr.match(/['"](\\/ajax\\/sys\\.pages\\.course\\/checkPassPrevious\\/[^'"]+)['"]/);
              if (m) ajaxUrl = m[1];
            } catch (e) {}
          }

          const cols = Array.from(el.querySelectorAll('.ext-col, td')).map(c => c.innerText.trim());
          const rowText = (cols.join(' ') + ' ' + el.innerText).replace(/\\s+/g, ' ').trim();
          const key = directLink ? directLink.href : (el.id || ajaxUrl || rowText);
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);

          const reqMinMatch = rowText.match(/閱讀達\\s*(\\d+)\\s*分鐘/);
          const requiredMin = reqMinMatch ? Number(reqMinMatch[1]) : 0;
          const passScoreMatch = cols.join(' ').match(/(\\d{1,3})\\s*分及格/) || rowText.match(/(?:^|\\s)(\\d{1,3})\\s*分及格/);
          const passScore = passScoreMatch ? Number(passScoreMatch[1]) : 70;

          let type = 'unknown';
          if (directLink) {
            type = directLink.href.includes('/media/')
              ? 'media'
              : directLink.href.includes('/poll/')
              ? 'poll'
              : 'exam';
          } else {
            if (rowText.includes('閱讀達') || el.querySelector('.fa-play-circle, .fa-video, .fa-file-alt')) {
              type = 'media';
            } else if (rowText.includes('分及格') || rowText.includes('成績比重') || el.querySelector('.fa-check-square')) {
              type = 'exam';
            } else if (rowText.includes('須填寫') || rowText.includes('問卷') || rowText.includes('滿意度')) {
              type = 'poll';
            }
          }
          if (type === 'unknown') continue;

          const mediaMatch = directLink ? directLink.href.match(/\\/media\\/(\\d+)/) : null;
          const hasCheckIcon = !!el.querySelector('.fa-check, .glyphicon-ok, .text-success');
          const passed =
            isCompleted ||
            hasCheckIcon ||
            cols.some(c => c.includes('已完成') || c === '通過') ||
            rowText.includes('已完成');

          units.push({
            nodeId: el.id || null,
            btnId: ajaxBtn ? ajaxBtn.id : null,
            ajaxUrl,
            title: targetAnchor.innerText.trim(),
            href: directLink ? directLink.href : null,
            type,
            mediaId: mediaMatch ? mediaMatch[1] : null,
            requiredMin,
            passScore,
            passed,
            rowText
          });
        }

        return {
          courseId: '${cleanId}',
          title: document.title.replace(/\\s*\\|.*$/, '').trim(),
          isCompleted,
          isMandatoryAssigned,
          hasExpiredWarning,
          roleRestriction: ${JSON.stringify(preCheck?.roleRestriction || null)},
          isRestrictedOut: ${Boolean(preCheck?.isRestrictedOut)},
          enrolled: units.length > 0,
          units
        };
      })()`
    );

    // Resolve any missing unit hrefs via in-page AJAX checkPassPrevious or click
    if (details && Array.isArray(details.units)) {
      for (const unit of details.units) {
        if (!unit.href && unit.ajaxUrl) {
          const resolvedUrl = await evalTab(
            wsUrl,
            `new Promise((resolve) => {
              if (window.fs && typeof window.fs.post === 'function') {
                window.fs.post('${unit.ajaxUrl}', {}, function(o) {
                  if (o && o.status && o.data && o.data.url) {
                    const u = o.data.url.startsWith('http') ? o.data.url : location.origin + o.data.url;
                    resolve(u);
                  } else {
                    resolve(null);
                  }
                });
              } else {
                resolve(null);
              }
              setTimeout(() => resolve(null), 4000);
            })`
          );
          if (resolvedUrl) {
            unit.href = resolvedUrl;
            const mMatch = resolvedUrl.match(/\/media\/(\d+)/);
            if (mMatch) unit.mediaId = mMatch[1];
          }
        }
      }
    }

    return details;
  } finally {
    await closeTab(tab.id);
  }
}

async function dropCourse(courseId) {
  const cleanId = String(courseId).replace(/^.*\/course\//, '').replace(/\/.*$/, '').trim();
  const tab = await openTab(`https://tms.kmuh.org.tw/course/${cleanId}`, 3500);
  const wsUrl = tab.webSocketDebuggerUrl;
  try {
    const clicked = await evalTab(
      wsUrl,
      `(() => {
        const dropBtn =
          document.querySelector('a[role="drop-course"], .btn-drop, a[href*="drop"]') ||
          Array.from(document.querySelectorAll('a, button')).find(b => (b.innerText || '').trim() === '退選');
        if (dropBtn) {
          dropBtn.click();
          return true;
        }
        return false;
      })()`
    );
    if (!clicked) {
      return { courseId: cleanId, dropped: false, reason: 'no_drop_button' };
    }
    await new Promise((r) => setTimeout(r, 2000));
    const confirmed = await evalTab(
      wsUrl,
      `(() => {
        const confirmBtn =
          document.querySelector('#confirmDropCourseModal button.btn-primary, .bootbox .btn-primary, .modal.in .btn-primary') ||
          Array.from(document.querySelectorAll('.modal button, .bootbox button')).find(b => (b.innerText || '').includes('確定'));
        if (confirmBtn) {
          confirmBtn.click();
          return true;
        }
        return false;
      })()`
    );
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`🗑️ [ProgramAuditor] Dropped course [${cleanId}] (Confirmed: ${Boolean(confirmed)})`);
    return { courseId: cleanId, dropped: Boolean(confirmed) };
  } finally {
    await closeTab(tab.id);
  }
}

module.exports = {
  IGNORED_COURSE_IDS,
  auditProgram,
  scanMyCourses,
  searchOnlineCourses,
  enrollAndExtractCourse,
  dropCourse
};

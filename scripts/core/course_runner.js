/**
 * KMUH TMS Assistant 2.2 - End-to-End Course & Program Orchestrator
 * Implements Leaf-First Mandatory Sub-Category Course Selection (resolving every 0% / 50% node
 * and propagating credits up to parent categories) + parallel 1.0x media playback + surveys + exams.
 */

const { openTab, closeTab, evalTab } = require('./cdp_client');
const {
  IGNORED_COURSE_IDS,
  auditProgram,
  scanMyCourses,
  searchOnlineCourses,
  enrollAndExtractCourse
} = require('./program_auditor');
const { runMediaBatch, runMediaPool } = require('./media_daemon');
const { completeSurvey } = require('./survey_engine');
const { extractExamQuestions, submitExamAnswers, takeExamUntilPassed } = require('./exam_engine');

// Keywords in course titles that indicate non-physician role restrictions or invalid modes
const EXCLUDED_TITLE_KEYWORDS = [
  '面授',
  '視訊',
  '限NP',
  '專科護理師',
  '護理職類',
  '新進護理人員',
  '志工',
  '外包'
];

async function settleZeroMinuteMedia(mediaId, title) {
  const url = `https://tms.kmuh.org.tw/media/${mediaId}`;
  console.log(`[CourseRunner] Opening 0-min handout/media [${mediaId}] ${title}...`);
  const tab = await openTab(url, 4000);
  try {
    await evalTab(
      tab.webSocketDebuggerUrl,
      `(() => {
        const endBtn = document.querySelector('a.fs-endReading') ||
          Array.from(document.querySelectorAll('a, button')).find(e => (e.innerText || '').includes('結束閱讀'));
        if (endBtn) endBtn.click();
      })()`
    );
    await new Promise((r) => setTimeout(r, 1500));
    await evalTab(
      tab.webSocketDebuggerUrl,
      `(() => {
        const confirmBtn = document.querySelector('.bootbox .btn-primary, .modal-footer .btn-primary');
        if (confirmBtn) confirmBtn.click();
      })()`
    );
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    await closeTab(tab.id);
    console.log(`[CourseRunner] ✅ Closed 0-min media [${mediaId}] ${title}`);
  }
}

async function completeCourseAssessments(cid) {
  let info = await enrollAndExtractCourse(cid);
  if (info.isCompleted) return info;

  for (const unit of info.units || []) {
    if (unit.passed) continue;

    if (unit.type === 'poll') {
      console.log(`[CourseRunner] Submitting 5-star survey for [${cid}]: ${unit.href}`);
      await completeSurvey(unit.href);
    } else if (unit.type === 'exam') {
      console.log(`[CourseRunner] Running exam until passed for [${cid}]: ${unit.href}`);
      await takeExamUntilPassed(unit.href);
    }
  }

  info = await enrollAndExtractCourse(cid);
  if (info.isCompleted) {
    console.log(`🎯 [CourseRunner] Course [${cid}] ${info.title} is now 100% COMPLETED!`);
  }
  return info;
}

async function runCoursesEndToEnd(courseIds, { maxConcurrency = 6 } = {}) {
  const cleanIds = Array.from(
    new Set(
      courseIds
        .map((id) => String(id).replace(/^.*\/course\//, '').replace(/\/.*$/, '').trim())
        .filter((id) => id && !IGNORED_COURSE_IDS.has(id))
    )
  );

  if (cleanIds.length === 0) {
    console.log('[CourseRunner] No actionable courses to run.');
    return [];
  }

  console.log(
    `[CourseRunner] Starting end-to-end pipeline for ${cleanIds.length} course(s): ${cleanIds.join(', ')}`
  );

  const mediaQueue = [];
  const mediaByCourse = new Map();

  // Phase 1: Enroll & inspect units
  for (const cid of cleanIds) {
    const info = await enrollAndExtractCourse(cid);

    if (info.skipped || info.isCompleted) {
      console.log(`[CourseRunner] [${cid}] ${info.title || ''} already completed or skipped.`);
      continue;
    }

    if (!info.enrolled) {
      console.warn(
        `[CourseRunner] ⚠️ [${cid}] ${info.title} could not enroll (restriction: ${
          info.roleRestriction || 'unknown'
        }).`
      );
      continue;
    }

    let hasMediaPending = false;
    for (const unit of info.units) {
      if (unit.passed) continue;

      if (unit.type === 'media' && unit.mediaId) {
        if (!unit.requiredMin || unit.requiredMin <= 0) {
          await settleZeroMinuteMedia(unit.mediaId, `${info.title} - ${unit.title}`);
        } else {
          hasMediaPending = true;
          const task = {
            courseId: cid,
            mediaId: unit.mediaId,
            targetMin: unit.requiredMin,
            title: `[${cid}] ${info.title.slice(0, 16)}`
          };
          mediaQueue.push(task);
          if (!mediaByCourse.has(cid)) mediaByCourse.set(cid, []);
          mediaByCourse.get(cid).push(task);
        }
      }
    }

    if (!hasMediaPending) {
      await completeCourseAssessments(cid);
    }
  }

  // Phase 2: Parallel 1.0x media playback with sliding window pool & immediate assessment
  if (mediaQueue.length > 0) {
    console.log(
      `[CourseRunner] Launching MediaDaemon sliding pool (${mediaQueue.length} media tasks, concurrency ${maxConcurrency})...`
    );
    await runMediaPool(mediaQueue, maxConcurrency, 15000, async (finishedTask) => {
      const cid = finishedTask.courseId;
      if (cid && mediaByCourse.has(cid)) {
        const remainingForCourse = mediaByCourse.get(cid).filter((t) => !t.done);
        if (remainingForCourse.length === 0) {
          console.log(`[CourseRunner] All media finished for course [${cid}]! Resolving assessments...`);
          await completeCourseAssessments(cid);
        }
      }
    });
  }

  // Phase 3: Final sweep & verification
  const results = [];
  for (const cid of cleanIds) {
    const info = await completeCourseAssessments(cid);
    results.push({
      courseId: cid,
      title: info.title,
      isCompleted: info.isCompleted,
      remainingUnits: (info.units || []).filter((u) => !u.passed).length
    });
  }

  return results;
}

/**
 * Selects eligible online courses for every incomplete (0% / 50%) mandatory sub-category
 * in a program using Leaf-First traversal (so child credits propagate to parent categories).
 */
async function selectMandatoryCoursesForProgram(programId) {
  const audit = await auditProgram(programId);
  console.log(
    `[CourseRunner] Program #${audit.programId} (${audit.programName}): ` +
      `Recognized=${audit.recognized}/${audit.totalRequired} ${audit.unit}, ` +
      `TotalShortfall=${audit.shortfall}, MandatoryShortfall=${audit.requiredShortfall}`
  );

  const selectedCourseIds = [];
  const selectedSet = new Set();
  const ancestorBonus = new Map(); // sectionNum -> extra credits from newly selected child courses

  // Sort nodes deepest-first (e.g. "12.3.1" -> "5.1" -> "5") so leaf sub-categories are filled first
  const sortedNodes = [...audit.nodes].sort((a, b) => {
    const depthA = a.sectionNum ? a.sectionNum.split('.').length : 0;
    const depthB = b.sectionNum ? b.sectionNum.split('.').length : 0;
    return depthB - depthA;
  });

  for (const node of sortedNodes) {
    if (node.mode === '面授') continue;

    const bonus = ancestorBonus.get(node.sectionNum) || 0;
    let needed = Number((node.deficit - bonus).toFixed(2));
    if (needed <= 0) continue;

    if (node.type === 'course' && node.courseId && !IGNORED_COURSE_IDS.has(node.courseId)) {
      if (!selectedSet.has(node.courseId)) {
        selectedSet.add(node.courseId);
        selectedCourseIds.push(node.courseId);
      }
      continue;
    }

    if (node.type === 'category' && node.categoryId) {
      console.log(
        `[CourseRunner] Resolving mandatory node [${node.sectionNum} ${node.categoryName}] ` +
          `(Deficit: ${node.deficit}, CoveredByChildren: ${bonus}, NetNeeded: ${needed} ${audit.unit})...`
      );

      const candidates = await searchOnlineCourses({ categoryId: node.categoryId, page: 1 });
      const eligible = candidates.filter(
        (c) =>
          c.status !== '已通過' &&
          !selectedSet.has(c.courseId) &&
          !EXCLUDED_TITLE_KEYWORDS.some((kw) => c.title.includes(kw))
      );

      // 1. Prefer exact credit/hour match for remaining deficit (e.g. 1.5 credit course for 1.5 deficit)
      // 2. Otherwise prefer shortest hours/credits first to accumulate via multiple short courses
      // 3. On tie, prefer already enrolled ('已加入')
      eligible.sort((a, b) => {
        const gainA = (audit.unit === '小時' ? a.hours : a.credits) || 0.5;
        const gainB = (audit.unit === '小時' ? b.hours : b.credits) || 0.5;
        const exactA = Math.abs(gainA - needed) < 0.01 ? 1 : 0;
        const exactB = Math.abs(gainB - needed) < 0.01 ? 1 : 0;
        if (exactA !== exactB) return exactB - exactA;
        if (a.hours !== b.hours) return a.hours - b.hours;
        if (a.status === '已加入' && b.status !== '已加入') return -1;
        if (b.status === '已加入' && a.status !== '已加入') return 1;
        return 0;
      });

      let gainedTotal = 0;
      for (const cand of eligible) {
        if (needed <= 0) break;
        const details = await enrollAndExtractCourse(cand.courseId);
        if (details.enrolled && !details.isCompleted && !details.isRestrictedOut) {
          selectedSet.add(cand.courseId);
          selectedCourseIds.push(cand.courseId);
          const gain = (audit.unit === '小時' ? cand.hours : cand.credits) || 0.5;
          needed = Number(Math.max(0, needed - gain).toFixed(2));
          gainedTotal += gain;
          console.log(
            `  -> Enrolled [${cand.courseId}] ${cand.title} (+${gain} ${audit.unit}, RequiredMin: ${
              details.units.find((u) => u.type === 'media')?.requiredMin || 0
            }m, Remaining node need: ${needed})`
          );
        }
      }

      // Propagate gainedTotal to all ancestor section numbers (e.g. "5.1" -> "5")
      if (node.sectionNum && gainedTotal > 0) {
        const parts = node.sectionNum.split('.');
        while (parts.length > 1) {
          parts.pop();
          const parentSec = parts.join('.');
          ancestorBonus.set(parentSec, (ancestorBonus.get(parentSec) || 0) + gainedTotal);
        }
      }
    }
  }

  return { audit, selectedCourseIds };
}

async function runProgramEndToEnd(programId, { maxRounds = 3 } = {}) {
  let finalAudit = null;

  for (let round = 1; round <= maxRounds; round++) {
    console.log(`\n[CourseRunner] === Program #${programId} Closed-Loop Audit Round ${round}/${maxRounds} ===`);
    const { audit, selectedCourseIds } = await selectMandatoryCoursesForProgram(programId);
    finalAudit = audit;

    if (selectedCourseIds.length === 0) {
      console.log(
        `[CourseRunner] 🎉 All online mandatory sub-categories for #${audit.programId} are 100% satisfied!`
      );
      return audit;
    }

    await runCoursesEndToEnd(selectedCourseIds);
    finalAudit = await auditProgram(programId);

    if (finalAudit.incompleteOnlineNodes.length === 0 && finalAudit.shortfall <= 0) {
      console.log(
        `[CourseRunner] 🎉 Verified after Round ${round}: all online mandatory sub-categories reached 100%!`
      );
      break;
    }
  }

  return finalAudit;
}

async function runPendingCoursesEndToEnd() {
  const { pendingCourses } = await scanMyCourses();
  console.log(
    `[CourseRunner] Found ${pendingCourses.length} pending/assigned course(s) in /course/mine.`
  );
  const ids = pendingCourses.map((c) => c.courseId);
  return await runCoursesEndToEnd(ids);
}

async function runKeywordCoursesEndToEnd(keyword) {
  const courses = await searchOnlineCourses({ keyword });
  const target = courses.filter((c) => c.status !== '已通過');
  console.log(
    `[CourseRunner] Keyword "${keyword}" matched ${target.length} unfinished online course(s).`
  );
  return await runCoursesEndToEnd(target.map((c) => c.courseId));
}

module.exports = {
  selectMandatoryCoursesForProgram,
  runCoursesEndToEnd,
  runProgramEndToEnd,
  runPendingCoursesEndToEnd,
  runKeywordCoursesEndToEnd
};

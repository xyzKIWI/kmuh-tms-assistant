/**
 * KMUH TMS Assistant 2.1 - End-to-End Course & Program Orchestrator
 * Chains auto-enrollment, parallel 1.0x media completion, 5-star survey submission,
 * and exam completion into a single turnkey pipeline for any course or program.
 */

const { openTab, closeTab, evalTab } = require('./cdp_client');
const {
  IGNORED_COURSE_IDS,
  auditProgram,
  scanMyCourses,
  searchOnlineCourses,
  enrollAndExtractCourse
} = require('./program_auditor');
const { runMediaBatch } = require('./media_daemon');
const { completeSurvey } = require('./survey_engine');
const { extractExamQuestions, submitExamAnswers } = require('./exam_engine');

// Keywords in course titles that indicate non-physician role restrictions
const EXCLUDED_TITLE_KEYWORDS = ['限NP', '專科護理師', '護理職類', '新進護理人員', '志工'];

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

async function runCoursesEndToEnd(courseIds) {
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

  console.log(`[CourseRunner] Starting end-to-end pipeline for ${cleanIds.length} course(s): ${cleanIds.join(', ')}`);

  const mediaQueue = [];
  const courseMap = new Map();

  // Phase 1: Enroll & inspect units
  for (const cid of cleanIds) {
    const info = await enrollAndExtractCourse(cid);
    courseMap.set(cid, info);

    if (info.skipped || info.isCompleted) {
      console.log(`[CourseRunner] [${cid}] ${info.title || ''} already completed or skipped.`);
      continue;
    }

    if (!info.enrolled) {
      console.warn(`[CourseRunner] ⚠️ [${cid}] ${info.title} could not enroll (restriction: ${info.roleRestriction || 'unknown'}).`);
      continue;
    }

    for (const unit of info.units) {
      if (unit.passed) continue;

      if (unit.type === 'media' && unit.mediaId) {
        if (!unit.requiredMin || unit.requiredMin <= 0) {
          await settleZeroMinuteMedia(unit.mediaId, `${info.title} - ${unit.title}`);
        } else {
          mediaQueue.push({
            courseId: cid,
            mediaId: unit.mediaId,
            targetMin: unit.requiredMin,
            title: `[${cid}] ${info.title.slice(0, 18)}`
          });
        }
      }
    }
  }

  // Phase 2: Parallel 1.0x media playback & auto-close
  if (mediaQueue.length > 0) {
    console.log(`[CourseRunner] Launching parallel MediaDaemon for ${mediaQueue.length} video unit(s)...`);
    await runMediaBatch(mediaQueue);
  }

  // Phase 3: Complete unlocked surveys & exams
  const results = [];
  for (const cid of cleanIds) {
    let info = await enrollAndExtractCourse(cid);
    if (info.isCompleted) {
      results.push({ courseId: cid, title: info.title, isCompleted: true });
      continue;
    }

    for (const unit of info.units || []) {
      if (unit.passed) continue;

      if (unit.type === 'poll') {
        console.log(`[CourseRunner] Submitting 5-star survey for [${cid}]: ${unit.href}`);
        await completeSurvey(unit.href);
      } else if (unit.type === 'exam') {
        console.log(`[CourseRunner] Extracting & submitting exam for [${cid}]: ${unit.href}`);
        const { tab } = await extractExamQuestions(unit.href);
        await submitExamAnswers(tab);
      }
    }

    // Final check
    info = await enrollAndExtractCourse(cid);
    results.push({
      courseId: cid,
      title: info.title,
      isCompleted: info.isCompleted,
      remainingUnits: (info.units || []).filter((u) => !u.passed).length
    });
  }

  return results;
}

async function runProgramEndToEnd(programId) {
  const audit = await auditProgram(programId);
  console.log(
    `[CourseRunner] Program #${audit.programId} (${audit.programName}): ` +
      `${audit.recognized} / ${audit.totalRequired} ${audit.unit} (Shortfall: ${audit.shortfall})`
  );

  if (audit.completed && audit.shortfall <= 0) {
    console.log(`[CourseRunner] 🎉 Program #${audit.programId} is already 100% completed!`);
    return audit;
  }

  let needed = audit.shortfall > 0 ? audit.shortfall : audit.totalRequired - audit.recognized;
  const selectedIds = [];

  // 1. Add any direct mandatory course links in the program
  for (const node of audit.nodes) {
    if (node.type === 'course' && node.courseId && !IGNORED_COURSE_IDS.has(node.courseId)) {
      selectedIds.push(node.courseId);
    }
  }

  // 2. Crawl category online courses to cover shortfall
  const catNodes = audit.nodes.filter((n) => n.type === 'category' && n.categoryId);
  for (const catNode of catNodes) {
    if (needed <= 0) break;
    const candidates = await searchOnlineCourses({ categoryId: catNode.categoryId, page: 1 });
    const eligible = candidates
      .filter(
        (c) =>
          c.status !== '已通過' &&
          !EXCLUDED_TITLE_KEYWORDS.some((kw) => c.title.includes(kw))
      )
      .sort((a, b) => a.hours - b.hours);

    for (const cand of eligible) {
      if (needed <= 0) break;
      const details = await enrollAndExtractCourse(cand.courseId);
      if (details.enrolled && !details.isCompleted) {
        selectedIds.push(cand.courseId);
        const gain = audit.unit === '小時' ? cand.hours : cand.credits;
        needed = Math.max(0, needed - (gain || 0.5));
        console.log(
          `[CourseRunner] Selected [${cand.courseId}] ${cand.title} (+${gain} ${audit.unit}, Remaining shortfall: ${needed})`
        );
      }
    }
  }

  if (selectedIds.length > 0) {
    await runCoursesEndToEnd(selectedIds);
  }

  return await auditProgram(programId);
}

async function runPendingCoursesEndToEnd() {
  const { pendingCourses } = await scanMyCourses();
  console.log(`[CourseRunner] Found ${pendingCourses.length} pending/assigned course(s) in /course/mine.`);
  const ids = pendingCourses.map((c) => c.courseId);
  return await runCoursesEndToEnd(ids);
}

async function runKeywordCoursesEndToEnd(keyword) {
  const courses = await searchOnlineCourses({ keyword });
  const target = courses.filter((c) => c.status !== '已通過');
  console.log(`[CourseRunner] Keyword "${keyword}" matched ${target.length} unfinished online course(s).`);
  return await runCoursesEndToEnd(target.map((c) => c.courseId));
}

module.exports = {
  runCoursesEndToEnd,
  runProgramEndToEnd,
  runPendingCoursesEndToEnd,
  runKeywordCoursesEndToEnd
};

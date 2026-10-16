#!/usr/bin/env node
/**
 * KMUH TMS Assistant 3.0 - Unified Agent-Native LLM Intelligence CLI Pilot
 * Zero-Extension CDP Automation Entry Point
 * Features:
 * - Agent-in-the-Loop LLM Exam Reasoning & Persistent Knowledge Base (exam-extract / exam-solve)
 * - Low-Power Pause-and-Clock Media Engine (0% CPU/GPU decode, 0 bandwidth)
 * - Leaf-First Mandatory Sub-Category (0% / 50%) Multi-Course Dynamic Credit Accumulation
 */

const { closeTab } = require('./core/cdp_client');
const {
  auditProgram,
  scanMyCourses,
  searchOnlineCourses,
  enrollAndExtractCourse,
  dropCourse
} = require('./core/program_auditor');
const {
  runCoursesEndToEnd,
  runProgramEndToEnd,
  runPendingCoursesEndToEnd,
  runKeywordCoursesEndToEnd
} = require('./core/course_runner');
const { runMediaBatch } = require('./core/media_daemon');
const { completeSurvey } = require('./core/survey_engine');
const {
  extractExamQuestions,
  solveExamWithLLM,
  takeExamUntilPassed
} = require('./core/exam_engine');

async function main() {
  const [, , cmd, ...args] = process.argv;
  const [arg1, arg2, arg3] = args;

  switch (cmd) {
    case 'audit': {
      const programId = arg1 || '10713';
      const res = await auditProgram(programId);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'scan': {
      const res = await scanMyCourses();
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'search': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js search <keyword> [categoryId]');
        process.exit(1);
      }
      const res = await searchOnlineCourses({ keyword: arg1, categoryId: arg2 || 0 });
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'run-course': {
      if (args.length === 0) {
        console.error('Usage: node tms_pilot.js run-course <courseId_or_url...>');
        process.exit(1);
      }
      const res = await runCoursesEndToEnd(args);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'run-program': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js run-program <programId_or_url>');
        process.exit(1);
      }
      const res = await runProgramEndToEnd(arg1);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'run-pending': {
      const res = await runPendingCoursesEndToEnd();
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'run-keyword': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js run-keyword <keyword>');
        process.exit(1);
      }
      const res = await runKeywordCoursesEndToEnd(arg1);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'enroll': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js enroll <courseId>');
        process.exit(1);
      }
      const res = await enrollAndExtractCourse(arg1);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'drop': {
      if (args.length === 0) {
        console.error('Usage: node tms_pilot.js drop <courseId_or_url...>');
        process.exit(1);
      }
      const results = [];
      for (const cid of args) {
        results.push(await dropCourse(cid));
      }
      console.log(JSON.stringify(results, null, 2));
      break;
    }

    case 'watch': {
      if (!arg1 || !arg2) {
        console.error('Usage: node tms_pilot.js watch <mediaId> <targetMinutes> [title]');
        process.exit(1);
      }
      await runMediaBatch([
        {
          mediaId: String(arg1),
          targetMin: Number(arg2),
          title: arg3 || `Media-${arg1}`
        }
      ]);
      break;
    }

    case 'poll': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js poll <pollUrl>');
        process.exit(1);
      }
      const res = await completeSurvey(arg1);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'exam-extract': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js exam-extract <examUrl>');
        process.exit(1);
      }
      const { tab, questions } = await extractExamQuestions(arg1);
      await closeTab(tab.id);
      console.log(JSON.stringify(questions, null, 2));
      break;
    }

    case 'exam-solve': {
      if (!arg1 || !arg2) {
        console.error('Usage: node tms_pilot.js exam-solve <examUrl> <answersJson>');
        process.exit(1);
      }
      const answerMap = JSON.parse(arg2);
      const res = await solveExamWithLLM(arg1, answerMap);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    case 'exam': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js exam <examUrl> [answersJson]');
        process.exit(1);
      }
      const explicitAnswers = arg2 ? JSON.parse(arg2) : null;
      const res = await takeExamUntilPassed(arg1, { explicitAnswers });
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    default:
      console.log(`KMUH TMS Assistant 3.0 (Agent-Native LLM Intelligence Edition)
High-Level Turnkey Commands:
  run-program <programId_or_url>      Auto-audit, pick online courses & complete any program (e.g. 10667, 10713)
  run-course <courseId_or_url...>     End-to-end complete one or more specific courses (videos + survey + exam)
  run-pending                         Scan /course/mine (待修課程 + 被調訓必修課) and complete all pending courses
  run-keyword <keyword>               Search online courses by keyword (e.g. "家庭暴力") and complete them
  scan                                List all pending/assigned courses in /course/mine
  search <keyword> [categoryId]       Search available online courses in catalog

LLM Exam & Granular Unit Commands:
  exam-extract <examUrl>              Extract clean question stems & options JSON for Agent LLM reasoning
  exam-solve <examUrl> <answersJson>  Submit LLM-verified answers & cache 100% solution to Knowledge Base
  exam <examUrl> [answersJson]        Run exam with Knowledge Base / LLM answers or auto-retry loop until passed
  audit [programId]                   Audit curriculum progress & shortfall (supports 積分 & 小時)
  enroll <courseId>                   Auto-enroll & extract unit-level status (resolves dynamic AJAX URLs)
  drop <courseId_or_url...>           Auto-drop expired or unwanted face-to-face courses
  watch <mediaId> <targetMin> [name]  Run Low-Power Pause-and-Clock background timer & auto-close tab
  poll <pollUrl>                      Auto-fill 5-star satisfaction survey & auto-close tab`);
      break;
  }
}

main().catch((err) => {
  console.error('[TMS Pilot Error]:', err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * KMUH TMS Assistant 2.0 - Unified Agent-Native CLI Pilot
 * Zero-Extension CDP Automation Entry Point
 *
 * Usage:
 *   node scripts/tms_pilot.js audit [programId]
 *   node scripts/tms_pilot.js enroll <courseId>
 *   node scripts/tms_pilot.js watch <mediaId> <targetMinutes> [title]
 *   node scripts/tms_pilot.js poll <pollUrl>
 *   node scripts/tms_pilot.js exam <examUrl>
 */

const { auditProgram, enrollAndExtractCourse } = require('./core/program_auditor');
const { runMediaBatch } = require('./core/media_daemon');
const { completeSurvey } = require('./core/survey_engine');
const { extractExamQuestions, submitExamAnswers } = require('./core/exam_engine');

async function main() {
  const [, , cmd, arg1, arg2, arg3] = process.argv;

  switch (cmd) {
    case 'audit': {
      const programId = arg1 || '10713';
      const res = await auditProgram(programId);
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

    case 'exam': {
      if (!arg1) {
        console.error('Usage: node tms_pilot.js exam <examUrl>');
        process.exit(1);
      }
      const { tab, questions } = await extractExamQuestions(arg1);
      console.log(`Extracted ${questions.length} questions.`);
      const res = await submitExamAnswers(tab);
      console.log(JSON.stringify(res, null, 2));
      break;
    }

    default:
      console.log(`KMUH TMS Assistant 2.0 (Agent-Native CDP Engine)
Commands:
  audit [programId]                  Audit curriculum progress & shortfall (default: 10713)
  enroll <courseId>                  Auto-enroll & extract units for a course
  watch <mediaId> <targetMin> [name] Run 1.0x compliant background playback & auto-close tab
  poll <pollUrl>                     Auto-fill 5-star satisfaction survey & auto-close tab
  exam <examUrl>                     Extract & submit exam with 100% compliance & auto-close tab`);
      break;
  }
}

main().catch((err) => {
  console.error('[TMS Pilot Error]:', err);
  process.exit(1);
});

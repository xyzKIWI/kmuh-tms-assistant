---
name: kmuh-tms-assistant
description: 100% Agent-Native automated assistant for KMUH TMS (Kaohsiung Medical University Hospital Training Management System, https://tms.kmuh.org.tw/). Operates directly via Chrome DevTools Protocol (CDP port 9222) with zero browser extensions (no Tampermonkey required). Supports arbitrary programs (e.g. #10713 credits, #10667 faculty hours), mandatory hospital-assigned special training (e.g. domestic violence / sexual assault #83249, #83285), user self-selected pending courses (/course/mine), parallel 1.0x compliant video playback with native anti-blur injection, LLM exam solving, 5-star surveys, and automatic tab closing.
---

# KMUH TMS Assistant 2.1 (Agent-Native Zero-Extension Edition)

## Overview
This skill provides **100% Agent-Native** end-to-end automation for the Kaohsiung Medical University Hospital Training Management System (`https://tms.kmuh.org.tw/`).
- **Zero Extension Dependency**: Do **NOT** install or rely on Tampermonkey. All anti-blur, playback monitoring, exam solving, and survey submission run natively via Node.js + Chrome DevTools Protocol (`http://127.0.0.1:9222`). Any residual Tampermonkey config in `localStorage` is automatically disabled upon connection.
- **Universal Support**: Works across **any program** (`/program/showMy/{id}`, whether measured in `積分` or `小時`), **mandatory assigned courses (`被調訓的課程`)**, **keyword searches**, and **user self-selected courses (`待修課程`)**.
- **Auto-Tab Cleanup**: Every course/media/exam/survey tab opened by the engine is **physically closed** via CDP `GET /json/close/{targetId}` immediately after settlement.

---

## Core Architecture (`scripts/core/`)

1. **`scripts/core/cdp_client.js`**
   - Connects directly to `http://127.0.0.1:9222/json`.
   - Injects `ANTI_BLUR_SCRIPT` via `Page.addScriptToEvaluateOnNewDocument` and `Runtime.evaluate`, overriding `document.hidden`, `document.visibilityState`, `document.hasFocus`, and blocking `blur`/`visibilitychange` events while disabling any residual Tampermonkey scripts.
   - Provides `openTab(url)`, `closeTab(targetId)`, `evalTab(wsUrl, expression)`, and `navigateTab(wsUrl, url)`.

2. **`scripts/core/program_auditor.js`**
   - `auditProgram(programId)`: Parses `/program/showMy/{programId}` for multi-unit progress (`積分` / `小時`), shortfall, category nodes (`category=`), and direct course nodes (`/course/`).
   - `scanMyCourses()`: Scans `/course/mine` for user's pending courses (`待修課程`) and mandatory assigned courses (`被調訓的課程`).
   - `searchOnlineCourses({ keyword, categoryId, page })`: Queries `/course/latest` with full filter parameters for online courses.
   - `enrollAndExtractCourse(courseId)`: Clicks `.js-signup` + Bootbox confirmation, checks role restrictions, and extracts row-level unit statuses (`media`, `poll`, `exam`, `requiredMin`, `passed`).
   - Automatically skips expired historical course `24136`.

3. **`scripts/core/course_runner.js`**
   - `runCoursesEndToEnd(courseIds)`: Turnkey pipeline for any list of courses (enrolls $\rightarrow$ settles 0-min handouts $\rightarrow$ runs parallel 1.0x video batch $\rightarrow$ submits unlocked surveys & exams $\rightarrow$ closes all tabs).
   - `runProgramEndToEnd(programId)`: Audits any program, selects eligible online courses (filtering out role-restricted courses like `限NP`, `僅 小港 角色`), and runs them to completion.
   - `runPendingCoursesEndToEnd()`: Scans `/course/mine` and completes all pending/assigned courses.
   - `runKeywordCoursesEndToEnd(keyword)`: Searches online courses by keyword and completes all unfinished matches.

4. **`scripts/core/media_daemon.js`**, **`scripts/core/exam_engine.js`**, **`scripts/core/survey_engine.js`**
   - Granular engines for parallel 1.0x video heartbeat + `.fs-endReading` settlement, exam extraction/submission, and 5-star survey submission, all with automatic tab closure.

---

## Standard Operating Workflow for AI Agents

### Step 1: Verify Browser CDP Port 9222
Ensure Comet or Chrome is running with `--remote-debugging-port=9222` and logged into `https://tms.kmuh.org.tw/`.

### Step 2: Choose the Appropriate Turnkey Command
Run from `C:\Users\User\.gemini\config\skills\kmuh-tms-assistant`:

- **Scenario 1 — Any Curriculum Program (e.g. `#10713`, `#10667`)**:
  ```powershell
  node scripts/tms_pilot.js run-program 10667
  ```
- **Scenario 2 — Specific Assigned or Self-Selected Courses (e.g. Domestic Violence `83249`, `83285`)**:
  ```powershell
  node scripts/tms_pilot.js run-course 83249 83285
  ```
- **Scenario 3 — All Pending / Mandatory Courses in User's Account (`/course/mine`)**:
  ```powershell
  node scripts/tms_pilot.js run-pending
  ```
- **Scenario 4 — Keyword Search & Complete (e.g. `"家庭暴力"`, `"性侵害"`)**:
  ```powershell
  node scripts/tms_pilot.js run-keyword "家庭暴力"
  ```

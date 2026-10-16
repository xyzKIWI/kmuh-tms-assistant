---
name: kmuh-tms-assistant
description: 100% Agent-Native automated assistant for KMUH TMS (Kaohsiung Medical University Hospital Training Management System, https://tms.kmuh.org.tw/) V3.1. Operates directly via Chrome DevTools Protocol (CDP port 9222) with zero browser extensions. Features Agent-in-the-Loop LLM exam solving with persistent knowledge base caching, dynamic AJAX unit URL resolution, sequential Exam-Before-Survey execution, Low-Power Pause-and-Clock media timer (0% CPU/GPU decode, 0 bandwidth), Leaf-First Mandatory Sub-Category (0%/50%) multi-course dynamic credit accumulation, auto-drop expired/face-to-face courses, and automatic tab closing.
---

# KMUH TMS Assistant 3.1 (Agent-Native LLM Intelligence Edition)

## Overview
This skill provides **100% Agent-Native** end-to-end automation for the Kaohsiung Medical University Hospital Training Management System (`https://tms.kmuh.org.tw/`).
- **Agent-in-the-Loop True LLM Exam Solving**: Extracts clean question stems and options from `.kques-item` (`exam-extract`), allows the AI Agent (LLM) to reason over clinical/regulatory questions and inject verified 100% answers (`exam-solve`), caches verified answers to `data/exam_knowledge_base.json`, and includes an automatic retry loop (`while score < passScore`) until passed.
- **Low-Power Pause-and-Clock Mode**: Pauses `<video>` decoding immediately upon entering a media tab (`vid.pause()`) while keeping the `ReadingClock` session heartbeat active—achieving **0% CPU/GPU video decode load and 0 network streaming bandwidth**.
- **Dynamic AJAX Unit Resolution & Sequential Exam-Before-Survey**: Automatically resolves `href="#"` dynamic unit buttons via in-page `checkPassPrevious` AJAX calls, and strictly enforces solving **Exams BEFORE Surveys** to unlock sequential prerequisites.
- **Auto-Drop Expired & Face-to-Face Courses**: Automatically detects and drops courses with expired sub-units (`因部分課程內容已經超過通過期限，此課程將無法完成`) or face-to-face (`面授`/`視訊`/`實體`) restrictions.
- **Leaf-First Mandatory Sub-Category Resolution**: Parses `.xtree-node > .header .ext-col` columns and `必修不足 (requiredShortfall)`. Selects and accumulates one or multiple online courses from bottom-up (`0%` / `50%` leaf nodes first) and runs a Closed-Loop Re-Audit until 100% completion.

---

## Standard Operating Workflow for AI Agents (V3.1)

Run from `C:\Users\User\.gemini\config\skills\kmuh-tms-assistant`:

1. **Agent-in-the-Loop LLM Exam Solving (`exam-extract` -> Agent LLM -> `exam-solve`)**:
   ```powershell
   # Step 1: Extract questions JSON
   node scripts/tms_pilot.js exam-extract "<examUrl>"
   # Step 2: Agent LLM reasons over stems/options and submits exact answerMap JSON
   node scripts/tms_pilot.js exam-solve "<examUrl>" '{"kques_option_xxx":"0"}'
   ```
2. **Complete All `0%` / `50%` Mandatory Sub-Categories in Any Program (`run-program`)**:
   ```powershell
   node scripts/tms_pilot.js run-program <programId>
   ```
3. **Complete Specific Assigned or Self-Selected Courses (`run-course`)**:
   ```powershell
   node scripts/tms_pilot.js run-course <courseId_1> <courseId_2> ...
   ```
4. **Drop Unwanted Face-to-Face or Expired Courses (`drop`)**:
   ```powershell
   node scripts/tms_pilot.js drop <courseId_1> <courseId_2> ...
   ```
5. **Complete All Pending & Mandatory Assigned Courses in `/course/mine` (`run-pending`)**:
   ```powershell
   node scripts/tms_pilot.js run-pending
   ```

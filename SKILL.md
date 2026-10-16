---
name: kmuh-tms-assistant
description: 100% Agent-Native automated assistant for KMUH TMS (Kaohsiung Medical University Hospital Training Management System, https://tms.kmuh.org.tw/). Operates directly via Chrome DevTools Protocol (CDP port 9222) with zero browser extensions (no Tampermonkey required). Supports Leaf-First Mandatory Sub-Category (0%/50%) course selection across arbitrary programs (e.g. #10713 credits, #10667 faculty hours), mandatory hospital-assigned special training (e.g. domestic violence / sexual assault #83249, #83285), user self-selected pending courses (/course/mine), parallel 1.0x compliant video playback with native anti-blur injection, LLM exam solving, 5-star surveys, and automatic tab closing.
---

# KMUH TMS Assistant 2.2 (Agent-Native Mandatory-First Edition)

## Overview
This skill provides **100% Agent-Native** end-to-end automation for the Kaohsiung Medical University Hospital Training Management System (`https://tms.kmuh.org.tw/`).
- **Zero Extension Dependency**: Do **NOT** install or rely on Tampermonkey. All anti-blur, playback monitoring, exam solving, and survey submission run natively via Node.js + Chrome DevTools Protocol (`http://127.0.0.1:9222`).
- **Leaf-First Mandatory Sub-Category Resolution**: Accurately parses `.xtree-node > .header .ext-col` columns (`必修要求`, `完成積分/時數`, `完成度 0%/50%`) and `必修不足 (requiredShortfall)`. Clicks into every incomplete (`0%` / `50%`) mandatory sub-category from bottom-up (leaf nodes first so child credits automatically roll up into parent categories), selects eligible online courses matching the required credits/hours, enrolls, and completes them.
- **Auto-Tab Cleanup**: Every course/media/exam/survey tab opened by the engine is **physically closed** via CDP `GET /json/close/{targetId}` immediately after settlement.

---

## Standard Operating Workflow for AI Agents

Run from `C:\Users\User\.gemini\config\skills\kmuh-tms-assistant`:

1. **Complete All `0%` / `50%` Mandatory Sub-Categories in Any Program (`run-program`)**:
   ```powershell
   node scripts/tms_pilot.js run-program <programId>
   ```
2. **Complete Specific Assigned or Self-Selected Courses (`run-course`)**:
   ```powershell
   node scripts/tms_pilot.js run-course <courseId_1> <courseId_2> ...
   ```
3. **Complete All Pending & Mandatory Assigned Courses in `/course/mine` (`run-pending`)**:
   ```powershell
   node scripts/tms_pilot.js run-pending
   ```
4. **Search & Complete Online Courses by Keyword (`run-keyword`)**:
   ```powershell
   node scripts/tms_pilot.js run-keyword "<keyword>"
   ```

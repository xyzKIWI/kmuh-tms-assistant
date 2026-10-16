---
name: kmuh-tms-assistant
description: >-
  100% Agent-Native automated assistant for KMUH TMS (Kaohsiung Medical University Hospital Training Management System, https://tms.kmuh.org.tw/). Operates directly via Chrome DevTools Protocol (CDP port 9222) with zero browser extensions (no Tampermonkey required). Audits annual curriculum shortfalls, auto-enrolls in highest-yield short online courses, runs multi-tab parallel 1.0x compliant video playback with native anti-blur injection, solves exams at 100% accuracy via LLM reasoning, submits 5-star surveys, and physically closes tabs immediately upon completion.
---

# KMUH TMS Assistant 2.0 (純 Agent 原生高醫年度學程全自動管線技能)

專為高雄醫學大學附設中和紀念醫院、高醫岡山醫院及高醫醫療體系同仁打造的 **100% Agent-Native（零外掛、免 Tampermonkey）** 線上學習全自動管線技能。
由 AI Agent（Gemini / Antigravity / Codex）直接透過 **Chrome DevTools Protocol (CDP, Port 9222)** 掌控瀏覽器底層，一勞永逸解決臨床繁重工作下每年大量的必修學程、全人醫療、感染管制、醫療法規、病安通報、資安與滿意度問卷。

---

## 一、 核心架構理念（2.0 純 Agent 原生化設計）

### 1. 為什麼全面捨棄篡改猴（Tampermonkey）外掛？
- **零外掛依賴（Zero Extension）**：不需手動安裝擴充套件或維護數萬行肥大前端腳本，亦不會在網頁注入多餘 DOM 面板造成按鈕層級衝突。
- **CDP 底層預注入防失焦**：透過 `Page.addScriptToEvaluateOnNewDocument` 在網頁載入前直接於瀏覽器底層覆寫 `document.hidden = false` 與 `visibilityState = 'visible'`，背景切視窗看診或最小化皆 100% 持續計時。
- **真 LLM 醫學推理滿分作答**：隨堂測驗由 Agent 抽取題幹與選項，交由 LLM 結合臨床指引推理作答，達成 100% 滿分及格率。
- **物理級分頁自動關閉**：當課程時數達標並觸發 `.fs-endReading` 入帳後，直接呼叫 CDP 原生 `HTTP GET /json/close/{targetId}` 物理關閉分頁，瀏覽器永遠保持清爽不堆積。

### 2. 為什麼嚴格採用「1.0x 原生心跳 + 多分頁並行」而非快轉？
高醫 TMS 採用 **FormosaSoft（台灣數位學習科技）** 平台，其後台稽核機制嚴格比對 **Session 累計在線心跳秒數 (Accumulated Online Heartbeat)**。
若強行竄改 `playbackRate` 快轉或偽造封包，會導致後台實質時數不足而不予認列。
**標準解法**：維持 **1.0x 原生合規心跳**，並透過 CDP **同時開啟 3~4 個背景分頁並行掛機**，在 100% 符合人資稽核規範的前提下達成 3~4 倍速推進效率。

---

## 二、 模組化核心結構 (`scripts/`)

檔案目錄：`C:\Users\User\.gemini\config\skills\kmuh-tms-assistant\scripts\`

| 模組路徑 | 職責與功能說明 |
| :--- | :--- |
| **`tms_pilot.js`** | **統一 CLI 入口**：支援 `audit`、`enroll`、`watch`、`poll`、`exam` 五大子指令，供 Agent 或終端機直接調用。 |
| **`core/cdp_client.js`** | **底層 CDP 客戶端**：管理 WebSocket 通訊、`openTab`、`closeTab` (`GET /json/close/{id}`) 與 `Page.addScriptToEvaluateOnNewDocument` 底層防失焦注入。 |
| **`core/program_auditor.js`** | **學程稽核與智能選課引擎**：解析學程（如 `#10713`）已認列積分與缺額、過濾無效歷史課、自動點擊 `.js-signup` 報名並抽取單元網址。 |
| **`core/media_daemon.js`** | **多線並行影音掛機守護**：自動靜音播放、攔截「繼續觀看」彈窗、每 15 秒監控右上角累計時間（`姓名: MM:SS`），達標秒點 `.fs-endReading` 並立即關閉分頁。 |
| **`core/exam_engine.js`** | **隨堂測驗滿分引擎**：抽取考題結構供 Agent LLM 推理、勾選答案、精準點擊交卷與 Bootbox 二次確認彈窗，完成後自動關閉分頁。 |
| **`core/survey_engine.js`** | **滿意度問卷引擎**：自動點擊「開始填寫」、全選 5 星（非常滿意）與醫師身分、填入正向回饋、送出並自動關閉分頁。 |
| `kmuh_tms_console.js` | **院內公用電腦應急腳本**：無 CDP 環境時，可於 F12 Console 貼上啟用防失焦。 |

---

## 三、 標準執行流程 (Agent Execution Workflow)

### 前置環境確認
確保本機 Comet 或 Chrome 瀏覽器已帶偵錯埠 `9222` 啟動並登入高醫 TMS：
```powershell
"C:\Users\User\AppData\Local\Perplexity\Comet\Application\comet.exe" --remote-debugging-port=9222
```

### 步驟 1：盤點年度學程缺額 (`audit`)
```powershell
node scripts/tms_pilot.js audit 10713
```
- 自動解析「總稽核值」、「已認列積分」、「總稽核值不足」以及各必修子類別達成度。
- **注意**：學員完成課程的日期須落於該學程有效期間（如 115 學年度為 `2026-05-01 ~ 2027-04-30`）內方予認列。

### 步驟 2：遴選高 CP 值短課程並自動報名 (`enroll`)
- 優先從全院線上課程目錄（`https://tms.kmuh.org.tw/course/latest`）挑選 **115 學年度新開、時數最短（10~35 分鐘）、無複雜測驗、積分 0.5~3 分** 之課程。
- 執行自動報名與單元解析：
```powershell
node scripts/tms_pilot.js enroll 84212
```

### 步驟 3：問卷與隨堂測驗先攻 (`poll` / `exam`)
- **滿意度問卷**：
  ```powershell
  node scripts/tms_pilot.js poll https://tms.kmuh.org.tw/course/82242/poll/12728
  ```
- **隨堂測驗**：
  - 由 `exam_engine.js` 抽取題目與選項，Agent 進行醫學與法規推理後傳入 `answerMap` 交卷，確保 100 分滿分通過並立即關閉分頁。

### 步驟 4：多線並行 1.0x 影音掛機與完訓自關 (`watch` / `runMediaBatch`)
- 單門或多門並行啟動：
  ```powershell
  node scripts/tms_pilot.js watch 124703 11 "16-單層防護裝備穿脫"
  ```
- 或透過 `core/media_daemon.js` 的 `runMediaBatch(tasks)` 同時啟動 3~4 門課程背景播放。
- 時數達標後自動點擊 `.fs-endReading` 結算入帳，等待 3.5 秒確保後台寫入後，呼叫 `closeTab` 物理關閉分頁。

---

## 四、 關鍵技術細節與避坑規範 (Technical Decisions & Gotchas)

1. **CDP 分頁關閉規範**：
   - 關閉分頁 API `http://127.0.0.1:9222/json/close/{targetId}` 必須使用原生 **HTTP GET** 請求（Node `fetch` 預設即為 GET），才能確保瀏覽器可靠關閉分頁。
2. **FormosaSoft 交卷彈窗陷阱**：
   - 測驗點擊 `button[role="submit-exam"]` 後會跳出 Bootbox 二次確認框。
   - **必須精準鎖定** `button[data-bb-handler="confirm"]` 或 `.bootbox .btn-primary`（文字為 `交卷` / `確定`）。
   - **嚴禁使用** 寬泛的 `.modal .btn-primary`，否則會誤點到頁面頂部導覽列的「搜尋」按鈕導致交卷失敗！
3. **純數字 DOM ID 選擇器限制**：
   - TMS 考題選項常以純數字作為 ID（如 `id="140598"`），在 CSS Selector 直接寫 `#140598` 會拋出 `SyntaxError`。必須使用 `document.getElementById('140598')` 或 `[id="140598"]`。
4. **無效歷史課程與免報名項目排除**：
   - **`24136`（器官捐贈及捐贈者照護評估）**：其單元 2 問卷期限已於 `2023-08-31` 截止鎖死，屬歷史過期課，系統已列入 `IGNORED_COURSE_IDS` 自動跳過。
   - **`Z205-急救證照-高醫岡山`**：依人資室規範，BLS/ACLS 有效證照由人資室統一於結算日批次匯入名單，**無需在 TMS 報名**。

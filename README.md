# KMUH TMS Assistant 3.1 (高醫體系員工學習管理系統 AI 原生全自動引擎 — LLM Intelligence Edition)

**100% Agent-Native、零瀏覽器外掛（No Tampermonkey Required）** 的高醫 TMS（`https://tms.kmuh.org.tw/`）V3.1 全自動引擎：整合 **Agent-in-the-Loop 大型語言模型（LLM）臨床與法規真實審題解題**、**動態 AJAX 單元解鎖與先測驗後問卷防呆**、**極致低功耗閱讀時鐘（Pause-and-Clock）**、以及 **由下而上（Leaf-First）非整數／多學分必修項目動態湊分與閉環重驗**。

---

## V3.1 核心進化與七大標準作業流程 (SOP)

1. **Agent-in-the-Loop 真實 LLM 臨床審題與知識庫快取 (`exam-extract` / `exam-solve` / `takeExamUntilPassed`)**：
   - **徹底告別純前端盲猜**：精準從 `.kques-item` 剝離 `.option-container`，萃取乾淨完整的考題題幹（`stem`）與選項結構化 JSON。
   - **方案 A（Agent LLM 即時審題）**：由 AI Agent（LLM）直接閱讀醫學、感染管制、資安、職安與醫院法規題意，推導出 100% 精準答案 Map（`{ [inputName]: value }`）後注入交卷。
   - **持久化滿分知識庫 (`data/exam_knowledge_base.json`)**：凡經 LLM 審題通過之考卷答案會自動寫入本機知識庫，後續同考卷直接 0 秒命中滿分交卷。
   - **自動重考閉環 (Auto-Retry Until Passed)**：若遇未快取測驗且單次未達及格標準（70/80 分），內建 `while (score < passScore)` 自動點擊「再次測驗／重考」並執行智慧語意輪替，直至及格才結案關頁。

2. **極致低功耗模式（Pause-and-Clock，影片暫停純走閱讀時鐘）**：
   - **底層機制**：高醫 TMS（FormosaSoft）認列時數僅依賴網頁頂部 `ReadingClock` 與伺服器 Session 心跳，與 HTML5 `<video>` 播放器的 `currentTime` 完全無關。
   - **零負載掛機**：進入課程分頁後立即執行 `vid.pause()` 暫停播放並靜音，徹底關閉高畫質 MP4/HLS 視訊串流解碼，**CPU / GPU 負載降至 0%、網路頻寬 0 消耗**，背景多開 6～8 堂課依然完全順暢。
   - 達標秒點「結束閱讀 (`.fs-endReading`)」入帳，並透過 CDP `GET /json/close/{id}` **物理關閉分頁**。

3. **逐欄精準拆解必修樹狀表 (`auditProgram`)**：
   - 讀取學程頁面每一個 `.xtree-node > .header .ext-col`（修正系統 DOM 將「必修要求 `1` + 完成積分 `0` + 完成度 `0%`」無空白並排黏合成 `"100%"` 的陷阱），精準抓出每一個 **`0%` / `50%` 未達標必修子項目** 與右上角 **`必修不足`** 數值。

4. **由下而上（Leaf-First）非整數／多學分動態湊分與自動選課 (`selectMandatoryCoursesForProgram`)**：
   - 優先點入最底層 `0%`／`50%` 的必修子項目連結（例如先點入 `5.1 醫事爭議`、`5.2 輻射防護`、`5.3 預防暴力`、`5.4 氣候風險` 各選 1 分線上課，完成後自動歸戶填滿父項目 `5. 危機管理 4分`）。
   - **支援非整數／多學分動態湊分（一堂或多堂累加）**：精準計算該子領域剩餘缺額（如 `0.5`、`1.5` 積分或 `5.0` 小時）。優先挑選單堂學分剛好等於缺額之課程；若無單堂匹配，則自動由短時數課程逐堂累加報名，直到滿足該領域缺額（`needed <= 0`）。
   - 自動過濾不符資格之角色限制課程（如 `僅 小港 角色`、`限NP`、`外包`、`志工`）。

5. **動態 AJAX 單元解析與順序依賴解鎖 (`checkPassPrevious` + Exam-Before-Survey)**：
   - **支援 `href="#"` 動態按鈕**：針對 TMS 特殊課程（如 TB 結核病系列）單元連結為 `href="#"` 並透過 jQuery `fs.post('/ajax/sys.pages.course/checkPassPrevious/...')` 動態派發網址之結構，引擎會自動攔截並解析出真實的 `/media/`、`/exam/`、`/poll/` URL。
   - **嚴格執行「先過測驗、後填問卷」**：解決 TMS「此課程內容須依序完成」之彈窗阻擋問題——強制先完成測驗並確認及格後，重新觸發 `checkPassPrevious` 解鎖問卷網址再送出滿意度。

6. **過期死課與面授課防呆退選 (`hasExpiredWarning` + `dropCourse`)**：
   - 自動攔截顯示「**因部分課程內容已經超過通過期限，此課程將無法完成**」之死課，以及標題含 `面授`、`視訊`、`實體`、`實作`、`演習` 之課程，選課時若誤觸立即透過 `dropCourse` 自動退選並換選下一堂。
   - 內建多視窗衝突 (`--:--:--`) 自動重整自癒與亂碼標題（如 `王品涵: 08:30` vs `總長度: 45:00`）精準防誤判。

7. **閉環重驗迴圈 (`Closed-Loop Re-Audit`)**：
   - 每批課程完訓後自動重新稽核學程頁面，驗證每個必修子領域實際入帳分數是否已達 100%；若仍有差額則自動補選下一堂課繼續執行，直至全數達標。

---

## 模組架構 (V3.1)

```text
kmuh-tms-assistant/
├── SKILL.md                          # AI Agent 技能定義與 V3.1 全場景標準作業程序 (SOP)
├── README.md                         # V3.1 專案架構與使用說明文件
├── data/
│   └── exam_knowledge_base.json      # 經 LLM 驗證之 100% 滿分測驗解答持久化知識庫
└── scripts/
    ├── tms_pilot.js                  # 統一 CLI 主控入口 (v3.1)
    ├── audit_summary.js              # 年度學程 (#10667 師培 & #10713 岡山) 快速總盤點工具
    ├── core/
    │   ├── cdp_client.js             # CDP WebSocket 通訊、原生防失焦注入與物理關頁
    │   ├── program_auditor.js        # 學程必修缺額精算、動態 AJAX 單元解析與退選 (dropCourse)
    │   ├── course_runner.js          # Leaf-First 動態湊分、先測驗後問卷順序控制與過期課自動退選
    │   ├── media_daemon.js           # 極致低功耗 (vid.pause + ReadingClock) 多分頁並行掛機引擎
    │   ├── exam_engine.js            # V3.1 Agent-in-the-Loop LLM 審題解題、知識庫快取與自動重考閉環
    │   └── survey_engine.js          # 課後問卷全自動 5 星非常滿意 + 醫師職類勾選送出
    └── legacy/                       # 舊版參考歸檔
```

---

## 快速上手與通用指令 (Quick Start)

### 1. 啟動瀏覽器偵錯埠 (Port 9222)
啟動 Comet 或 Chrome 並登入 `https://tms.kmuh.org.tw/`：
```powershell
"C:\Users\User\AppData\Local\Perplexity\Comet\Application\comet.exe" --remote-debugging-port=9222
```

### 2. Agent-in-the-Loop 真實 LLM 測驗解題流程
```powershell
# Step 1: 萃取考卷完整題幹與選項 JSON 供 Agent LLM 審題
node scripts/tms_pilot.js exam-extract "https://tms.kmuh.org.tw/course/84446/exam/28263"

# Step 2: 將 Agent LLM 推理出的標準答案注入交卷，並自動快取至知識庫
node scripts/tms_pilot.js exam-solve "https://tms.kmuh.org.tw/course/84446/exam/28263" '{"kques_option_183352":"0","kques_option_183353":"1"}'
```

### 3. 全自動學程必修項目 (`0%` / `50%`) 選課與完訓
```powershell
# 傳入任意學程 ID 或網址（自動處理「積分制」如 10713 與「小時制」如 10667）
node scripts/tms_pilot.js run-program 10713
node scripts/tms_pilot.js run-program 10667
```

### 4. 完成指定調訓課或待修清單
```powershell
# 指定一門或多門課程編號同時並行低功耗完訓
node scripts/tms_pilot.js run-course 83249 83285

# 掃描並完成 /course/mine 內所有待修與被調訓課程
node scripts/tms_pilot.js run-pending

# 一鍵退選誤選之面授課或過期無法完成之課程
node scripts/tms_pilot.js drop 84947 85974
```

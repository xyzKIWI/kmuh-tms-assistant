# KMUH TMS Assistant 2.2 (高醫體系員工學習管理系統 AI 原生全自動引擎)

**100% Agent-Native、零瀏覽器外掛（No Tampermonkey Required）** 的高醫 TMS（`https://tms.kmuh.org.tw/`）全自動必修子項目盤點、精準選課、調訓完訓、背景防失焦掛機、LLM 隨堂測驗滿分作答與滿意度問卷結案引擎。

---

## 核心標準作業流程：必修項目 (`0%` / `50%`) 自動選課與完訓 SOP

高醫 TMS 的學程稽核同時看 **「總稽核值（總積分／總時數）」** 與 **「必修不足（各子分類獨立要求）」**。本引擎採用 **由下而上（Leaf-First）必修項目消弭演算法**：

1. **逐欄精準拆解必修樹狀表 (`auditProgram`)**：
   - 讀取學程頁面每一個 `.xtree-node > .header .ext-col`（修正系統 DOM 將「必修要求 `1` + 完成積分 `0` + 完成度 `0%`」無空白並排黏合成 `"100%"` 的陷阱），精準抓出每一個 **`0%` / `50%` 未達標必修子項目** 與右上角 **`必修不足`** 數值。
2. **由下而上（子分類優先於父分類）動態湊分與自動選課 (`selectMandatoryCoursesForProgram`)**：
   - 優先點入最底層 `0%`／`50%` 的必修子項目連結（例如先點入 `5.1 醫事爭議`、`5.2 輻射防護`、`5.3 預防暴力`、`5.4 氣候風險` 各選 1 分線上課，完成後這 4 分會自動歸戶填滿父項目 `5. 危機管理 4分`；點入 `6.1 菸檳防制` 修完 1 分自動填滿 `6. 衛生醫療法令`）。
   - **支援非整數／多學分動態湊分（一堂或多堂累加）**：精準計算該子領域剩餘缺額（如 `0.5`、`1.5` 積分或 `5.0` 小時）。若該分類有「單堂學分剛好等於缺額」之課程（如缺 `1.5` 分時直接挑選 `1.5` 分課程）則優先選取；否則自動由短時數課程（如多堂 `0.5` 或 `1.0` 學分課）逐堂累加報名，直到滿足該領域缺額（`needed <= 0`）。
   - 自動過濾掉不符資格之角色限制課程（如 `僅 小港 角色`、`限NP`、`外包`、`志工`）。
3. **極致低功耗模式（Pause-and-Clock，影片暫停純走閱讀時鐘）**：
   - **核心機制**：高醫 TMS 平台（FormosaSoft）時數認列只依賴網頁頂部 `ReadingClock` 與伺服器 Session 心跳，與 HTML5 `<video>` 的播放狀態無關。
   - **零負載掛機**：進入課程分頁後立即執行 `vid.pause()` 暫停播放並靜音，彻底關閉高畫質 MP4/HLS 畫面解碼，**CPU/GPU 解碼負載降至 0%，網路頻寬 0 消耗**，電腦完全不發熱、不卡頓。
   - 達標秒點「結束閱讀 (`.fs-endReading`)」結案並透過 CDP `GET /json/close/{id}` **物理關閉分頁**。

4. **隨堂測驗自動重試閉環（Auto-Retry Until Passed）與智慧輪替**：
   - 針對 TMS 平台測驗未過（未達 70/80 分及格標準），內建 `takeExamUntilPassed` 自動重試迴圈：
     - **Attempt 1（高機率合規啟發）**：偏向「以上皆是」、「是/對/1」、正向法規選項。
     - **Attempt 2+（智慧選項反轉與輪替）**：若未達及格標準，自動點擊「再次測驗/重考」，是非題反轉為「否/非/X」、單選題輪替後續選項，或可交由 Agent LLM 進行題目正解推理。
     - 判定 `score >= passScore` 或頁面標記已通過後才結案關閉分頁，徹底杜絕「考一次沒過就棄坑」。

5. **多線並行完訓 + 問卷／測驗 + 閉環重驗監控 (`runProgramEndToEnd`)**：
   - 影片完成解鎖後，自動填妥 5 星滿意度問卷與隨堂測驗及格交卷並關閉分頁。
   - **閉環重驗迴圈 (Closed-Loop Re-Audit)**：每批課程完訓後自動重新稽核學程頁面，確認每個必修子領域實際入帳分數是否已達 100%；若仍有差額則自動補選下一堂課繼續執行，直至全數達標。

---

## 模組架構

```text
kmuh-tms-assistant/
├── SKILL.md                      # AI Agent 技能定義與全場景標準作業程序 (SOP)
├── README.md                     # 專案說明文件
└── scripts/
    ├── tms_pilot.js              # 統一 CLI 主控入口 (v2.2)
    ├── core/
    │   ├── cdp_client.js         # CDP WebSocket 通訊、Page.addScriptToEvaluateOnNewDocument 防失焦與自動關頁
    │   ├── program_auditor.js    # 學程 .ext-col 必修缺額精算 (積分/小時)、待修與調訓掃描、分類線上課爬蟲
    │   ├── course_runner.js      # 必修子項目 Leaf-First 自動選課 + 單課/多課/學程一條龍完訓編排器
    │   ├── media_daemon.js       # 多分頁並行 1.0x 原生心跳掛機、防閒置彈窗攔截、達標結算並關閉分頁
    │   ├── exam_engine.js        # 考題 DOM 抽取、LLM 推理答題、Bootbox 確認交卷與自動關頁
    │   └── survey_engine.js      # 課後問卷全自動 5 星非常滿意 + 醫師職類勾選送出與自動關頁
    └── legacy/                   # 舊版參考歸檔
```

---

## 四大通用使用情境 (Quick Start)

> **註**：以下 `<programId>` 與 `<courseId>` 皆為通用參數，可傳入**任何年度／非年度學程編號、院方調訓課程或自選課程**。

### 1. 啟動瀏覽器偵錯埠 (Port 9222)
啟動 Comet 或 Chrome 並登入 `https://tms.kmuh.org.tw/`：
```powershell
"C:\Users\User\AppData\Local\Perplexity\Comet\Application\comet.exe" --remote-debugging-port=9222
```

### 2. 情境 A：自動完成「學程內所有 `0%` / `50%` 必修項目選課與完訓」
自動掃描指定學程內所有未完成（`0%`／`50%`）的必修子分類，逐一點入該分類依缺額學分／時數選課報名，並一條龍跑完影片、問卷與測驗：
```powershell
# 傳入任意學程 ID 或網址（自動處理「積分制」如 10713 與「小時制」如 10667）
node scripts/tms_pilot.js run-program <programId>

# 範例：
node scripts/tms_pilot.js run-program 10713
node scripts/tms_pilot.js run-program 10667
```

### 3. 情境 B：自動完成「特殊專案調訓課程」（如家暴／性侵防治流程）
```powershell
# 方式 1：用關鍵字搜尋未完成的線上調訓課並一條龍跑完
node scripts/tms_pilot.js run-keyword "家庭暴力"

# 方式 2：直接傳入一門或多門課程編號／網址同時並行完訓
node scripts/tms_pilot.js run-course <courseId_1> <courseId_2>
```

### 4. 情境 C：你自己先選好課，交給引擎把「待修與被調訓清單」全部跑完
```powershell
# 盤點帳號下所有「待修課程」與「被調訓必修課」
node scripts/tms_pilot.js scan

# 一鍵把 /course/mine 清單內所有未完成課程全自動跑完
node scripts/tms_pilot.js run-pending
```

### 5. 情境 D：單步稽核與微調指令
```powershell
# 盤點學程各子項目 0%/50% 必修缺額明細
node scripts/tms_pilot.js audit <programId>

# 搜尋特定關鍵字或分類 (categoryId) 下的線上課程
node scripts/tms_pilot.js search <keyword> [categoryId]
```

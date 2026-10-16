# KMUH TMS Assistant 2.1 (高醫體系員工學習管理系統 AI 原生全自動引擎)

**100% Agent-Native、零瀏覽器外掛（No Tampermonkey Required）** 的高醫 TMS（`https://tms.kmuh.org.tw/`）全自動修課、學程盤點、調訓完訓、背景防失焦掛機、LLM 隨堂測驗滿分作答與滿意度問卷結案引擎。

---

## 核心特色 (v2.1 Universal Architecture)

- **零外掛依賴 (Zero Browser Extensions)**：無須安裝 Tampermonkey 或任何 `.user.js` 腳本，直接由 AI Agent 透過 Chrome DevTools Protocol (`CDP Port 9222`) 原生操控，並內建自動停用／移除頁面上殘留舊版插件面板之防護。
- **全場景通用編排 (`core/course_runner.js`)**：
  1. **任意學程自動完訓 (`run-program`)**：支援「積分制」（如 `#10713` 院內繼續教育 30 積分）與「小時制」（如 `#10667` 師資培育 5 小時）等任何學程，自動過濾院區／職類限制並挑課完訓。
  2. **院方特殊調訓／關鍵字完訓 (`run-keyword` / `run-course`)**：如「家庭暴力暨性侵害防治」（`83249`、`83285`）等強制調訓課程，一鍵完成未讀影音、問卷與測驗。
  3. **個人自選待修清單全清 (`run-pending`)**：你自己去網站點選報名放入「待修課程 (`/course/mine`)」的課，直接一鍵掃描並全自動跑完。
- **多線並行 1.0x 合規播放 + 完訓自動關頁**：遵守 1.0x 原生心跳，達標秒點「結束閱讀 (`.fs-endReading`)」並透過 `GET /json/close/{id}` **物理關閉分頁**。

---

## 模組架構

```text
kmuh-tms-assistant/
├── SKILL.md                      # AI Agent 技能定義與全場景標準作業程序 (SOP)
├── README.md                     # 專案說明文件
└── scripts/
    ├── tms_pilot.js              # 統一 CLI 主控入口
    ├── core/
    │   ├── cdp_client.js         # CDP WebSocket 通訊、Page.addScriptToEvaluateOnNewDocument 防失焦與自動關頁
    │   ├── program_auditor.js    # 通用學程缺額精算 (積分/小時)、待修與調訓掃描、關鍵字/分類線上課爬蟲
    │   ├── course_runner.js      # 單課 / 多課 / 學程 / 關鍵字 一條龍全自動完訓編排器
    │   ├── media_daemon.js       # 多分頁並行 1.0x 原生心跳掛機、防閒置彈窗攔截、達標結算並關閉分頁
    │   ├── exam_engine.js        # 考題 DOM 抽取、LLM 推理答題、Bootbox 確認交卷與自動關頁
    │   └── survey_engine.js      # 課後問卷全自動 5 星非常滿意 + 醫師職類勾選送出與自動關頁
    └── legacy/                   # 舊版參考歸檔
```

---

## 四大常見使用情境 (Quick Start)

> **註**：以下指令中的學程編號（如 `10713`、`10667`）與課程編號（如 `83249`）皆可替換為**任何你要修的學程或課程網址／ID**。

### 前置準備：啟動瀏覽器偵錯埠 (Port 9222)
啟動 Comet 或 Chrome 並登入 `https://tms.kmuh.org.tw/`：
```powershell
"C:\Users\User\AppData\Local\Perplexity\Comet\Application\comet.exe" --remote-debugging-port=9222
```

### 情境 A：跑完「任意年度／非年度學程」（如 `#10667` 師資培育學程、`#10713` 年度積分學程）
```powershell
# 自動盤點學程缺額（支援積分制與小時制）、自動挑課報名、跑完影片+問卷+測驗並關閉分頁
node scripts/tms_pilot.js run-program 10667
node scripts/tms_pilot.js run-program https://tms.kmuh.org.tw/program/showMy/10713
```

### 情境 B：跑完「特殊專案調訓課程」（如家暴／性侵防治、急救、感控調訓）
```powershell
# 方式 1：直接指定調訓課程編號或網址（可一次給多門課同時並行跑！）
node scripts/tms_pilot.js run-course 83249 83285

# 方式 2：用關鍵字自動搜尋全院未完成的線上課並一條龍跑完
node scripts/tms_pilot.js run-keyword "家庭暴力"
```

### 情境 C：你自己先在網站上選好課，交給引擎把「待修清單」全部跑完
```powershell
# 先查看目前帳號下「待修課程」與「被調訓必修課」清單
node scripts/tms_pilot.js scan

# 一鍵把所有待修與被調訓課程全自動跑完（自動略過已完成單元）
node scripts/tms_pilot.js run-pending
```

### 情境 D：單一單元微調指令（進階／單步控制）
```powershell
# 僅盤點學程狀態
node scripts/tms_pilot.js audit 10667

# 僅搜尋關鍵字或分類線上課程
node scripts/tms_pilot.js search "性侵害"

# 單獨掛機某支影片 (mediaId, 目標分鐘數, 顯示名稱)
node scripts/tms_pilot.js watch 122234 66 "家暴通報知能"

# 單獨填寫問卷或測驗
node scripts/tms_pilot.js poll https://tms.kmuh.org.tw/course/83249/poll/13049
node scripts/tms_pilot.js exam https://tms.kmuh.org.tw/course/80062/exam/xxxx
```

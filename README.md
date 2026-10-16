# KMUH TMS Assistant 2.0 (高醫年度學程全自動管線助手)

專為高醫醫療體系（附院、岡山、小港、大同、旗津）同仁打造的 **100% Agent-Native（免外掛、免 Tampermonkey）** 院內繼續教育訓練學程自動化解決方案。

透過 **Chrome DevTools Protocol (CDP, Port 9222)** 由 AI Agent（Gemini / Antigravity / Codex）直接控制瀏覽器底層，自動完成：**學程缺額精算 ➔ 高 CP 值短課遴選與報名 ➔ 多分頁背景 1.0x 合規掛機 ➔ LLM 隨堂測驗 100 分交卷 ➔ 5 星滿意度問卷送出 ➔ 完訓秒級關閉分頁**。

---

## 核心特色

1. **零擴充套件依賴（No Tampermonkey）**：
   - 不需在瀏覽器安裝任何油猴外掛，完全透過 CDP `Page.addScriptToEvaluateOnNewDocument` 於網頁載入前底層注入防失焦（`document.hidden = false`）。
   - 不注入任何前端懸浮面板，避免與 FormosaSoft / Bootstrap Modal 發生點擊衝突。
2. **100% 合規心跳 + 多分頁並行**：
   - 遵循 FormosaSoft 後台「Session 累計在線心跳秒數」稽核機制，維持 **1.0x 原生心跳速度**，同時開啟 3~4 個背景分頁並行播放，安全且高效。
3. **LLM 智能滿分答題**：
   - 隨堂測驗直接由 Agent 抽取題幹與選項，透過醫學與法規模型推理作答，精準點擊 Bootbox 二次確認彈窗，達成 100% 滿分通過率。
4. **完訓自動結算與物理級關頁**：
   - 監控畫面右上角累計時間（`姓名: MM:SS`），達標瞬間點擊 `.fs-endReading`（結束閱讀）入帳，並立即呼叫 CDP `GET /json/close/{id}` 物理關閉分頁，絕不殘留多餘分頁。

---

## 架構與模組 (`scripts/`)

```text
kmuh-tms-assistant/
├── SKILL.md                      # AI Agent 技能規範與避坑指南
├── README.md                     # 專案說明與 CLI 操作手冊
└── scripts/
    ├── tms_pilot.js              # 統一 CLI 主控入口
    ├── core/
    │   ├── cdp_client.js         # 底層 CDP 連線、分頁控制與防失焦注入
    │   ├── program_auditor.js    # 學程稽核、缺額精算、自動選課與單元抽取
    │   ├── media_daemon.js       # 多線並行 1.0x 影音掛機守護與達標自關
    │   ├── exam_engine.js        # 隨堂測驗題目抽取、LLM 作答與交卷引擎
    │   └── survey_engine.js      # 5 星滿意度問卷自動填寫與送出引擎
    └── kmuh_tms_console.js       # 院內公用電腦無 CDP 時之 F12 應急腳本
```

---

## 快速開始 (Quick Start)

### 1. 啟動瀏覽器偵錯埠 (Port 9222)
啟動 Comet 或 Chrome 並登入 `https://tms.kmuh.org.tw/`：
```powershell
"C:\Users\User\AppData\Local\Perplexity\Comet\Application\comet.exe" --remote-debugging-port=9222
```

### 2. 使用 CLI 或交由 AI Agent 全自動執行
```powershell
# 1. 盤點年度學程 (預設 #10713 高醫岡山 115 學年度學程)
node scripts/tms_pilot.js audit 10713

# 2. 自動報名指定課程並解析所有教材/測驗/問卷網址
node scripts/tms_pilot.js enroll 84212

# 3. 啟動背景 1.0x 影音掛機 (達標自動點結束閱讀並關閉分頁)
node scripts/tms_pilot.js watch 124703 11 "16-單層防護裝備穿脫"

# 4. 自動完成 5 星滿意度問卷並關閉分頁
node scripts/tms_pilot.js poll https://tms.kmuh.org.tw/course/82242/poll/12728

# 5. 自動完成隨堂測驗並關閉分頁
node scripts/tms_pilot.js exam https://tms.kmuh.org.tw/course/80062/exam/xxxx
```

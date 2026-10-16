/**
 * KMUH TMS Assistant 2.0 - Exam Engine
 * Extracts exam questions for Agent LLM reasoning, submits answers,
 * handles FormosaSoft Bootbox confirmation modals, and closes the tab.
 */

const { openTab, closeTab, evalTab } = require('./cdp_client');

async function extractExamQuestions(examUrl) {
  const tab = await openTab(examUrl, 3500);
  const wsUrl = tab.webSocketDebuggerUrl;

  // Click start exam button if on intro page
  const started = await evalTab(
    wsUrl,
    `(() => {
      const startBtn = Array.from(document.querySelectorAll('button, a')).find(b =>
        /開始測驗|進行測驗|再次測驗|重考|開始作答/.test(b.innerText || '')
      );
      if (startBtn) {
        startBtn.click();
        return true;
      }
      return false;
    })()`
  );

  if (started) {
    await new Promise((r) => setTimeout(r, 2500));
    await evalTab(
      wsUrl,
      `(() => {
        const confirmBtn = document.querySelector('button[data-bb-handler="confirm"], .bootbox .btn-primary');
        if (confirmBtn) confirmBtn.click();
      })()`
    );
    await new Promise((r) => setTimeout(r, 3000));
  }

  const questions = await evalTab(
    wsUrl,
    `(() => {
      const items = Array.from(document.querySelectorAll('.question-item, .exam-question, .fs-question, .panel, [class*="question"]'));
      const radioGroups = {};
      document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
        if (!input.name) return;
        if (!radioGroups[input.name]) {
          const container = input.closest('.panel, .question-item, li, tr, div.form-group') || input.parentElement?.parentElement;
          radioGroups[input.name] = {
            name: input.name,
            type: input.type,
            stem: container ? container.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400) : '',
            options: []
          };
        }
        const label = input.closest('label') || input.parentElement;
        radioGroups[input.name].options.push({
          value: input.value,
          text: label ? label.innerText.replace(/\\s+/g, ' ').trim() : input.value
        });
      });
      return Object.values(radioGroups);
    })()`
  );

  return { tab, wsUrl, questions };
}

/**
 * Submits an exam given a map of { [inputName]: selectedValueOrIndex }
 * If no answerMap is provided, applies clinical compliance heuristics.
 */
async function submitExamAnswers(tab, answerMap = {}) {
  const wsUrl = tab.webSocketDebuggerUrl;

  const submitRes = await evalTab(
    wsUrl,
    `((ansMap) => {
      const groups = {};
      document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
        if (!input.name) return;
        if (!groups[input.name]) groups[input.name] = [];
        groups[input.name].push(input);
      });

      let answered = 0;
      for (const [name, inputs] of Object.entries(groups)) {
        let chosen = null;
        const explicit = ansMap[name];

        if (explicit !== undefined) {
          chosen = inputs.find(i => i.value === String(explicit)) || inputs[Number(explicit)];
        }

        if (!chosen) {
          // Heuristic fallback: prefer "以上皆是" or positive clinical compliance option
          chosen =
            inputs.find(i => /以上皆是|皆正確|皆對/.test(i.closest('label')?.innerText || i.parentElement?.innerText || '')) ||
            inputs.find(i => /^1$|^true$|^O$|是|對/.test((i.closest('label')?.innerText || '').trim())) ||
            inputs[0];
        }

        if (chosen) {
          chosen.checked = true;
          chosen.click();
          chosen.dispatchEvent(new Event('change', { bubbles: true }));
          answered++;
        }
      }

      const submitBtn =
        document.querySelector('button[role="submit-exam"]') ||
        Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]')).find(
          b => (b.innerText || b.value || '').trim() === '交卷'
        );

      if (submitBtn) {
        submitBtn.click();
        return { answered, clickedSubmit: true };
      }
      return { answered, clickedSubmit: false };
    })(${JSON.stringify(answerMap)})`
  );

  if (submitRes?.clickedSubmit) {
    await new Promise((r) => setTimeout(r, 2000));
    // Strictly target Bootbox confirm button to avoid clicking navbar search button
    await evalTab(
      wsUrl,
      `(() => {
        const confirmBtn =
          document.querySelector('button[data-bb-handler="confirm"], .bootbox .btn-primary') ||
          Array.from(document.querySelectorAll('.bootbox button, .modal.in button')).find(
            b => (b.innerText || '').trim() === '交卷' || (b.innerText || '').trim() === '確定'
          );
        if (confirmBtn) confirmBtn.click();
      })()`
    );
    await new Promise((r) => setTimeout(r, 3000));
  }

  const finalCheck = await evalTab(
    wsUrl,
    `(() => {
      const text = document.body.innerText || '';
      const scoreMatch = text.match(/(?:得分|成績|分數)[：:\\s]*(\\d+)/);
      return {
        score: scoreMatch ? Number(scoreMatch[1]) : null,
        snippet: text.replace(/\\s+/g, ' ').slice(0, 300)
      };
    })()`
  );

  await closeTab(tab.id);
  console.log(`✅ [ExamEngine] Submitted and closed tab. Score: ${finalCheck?.score ?? 'Recorded'}`);
  return finalCheck;
}

module.exports = {
  extractExamQuestions,
  submitExamAnswers
};

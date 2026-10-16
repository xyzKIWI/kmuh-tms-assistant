/**
 * KMUH TMS Assistant 2.2 - Exam Engine
 * Features:
 * 1. Automatic retry loop until passing score is achieved (while score < passScore).
 * 2. Smart answer rotation on retry (flips True/False, rotates Multiple-Choice options).
 * 3. Handles FormosaSoft Bootbox confirmation dialogs seamlessly.
 */

const { openTab, closeTab, evalTab } = require('./cdp_client');

/**
 * Extracts exam questions for inspection or external LLM reasoning.
 */
async function extractExamQuestions(examUrl) {
  const tab = await openTab(examUrl, 3500);
  const wsUrl = tab.webSocketDebuggerUrl;

  const started = await evalTab(
    wsUrl,
    `(() => {
      const startBtn = Array.from(document.querySelectorAll('button, a')).find(b =>
        /開始測驗|進行測驗|再次測驗|重考|開始作答|繼續測驗/.test(b.innerText || '')
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
 * Executes an exam and automatically repeats until passing score is achieved.
 * If score is below passing standard, clicks "再次測驗" / "重考" and rotates answers.
 */
async function takeExamUntilPassed(examUrl, { maxRetries = 5, defaultPassScore = 70 } = {}) {
  const tab = await openTab(examUrl, 3500);
  const wsUrl = tab.webSocketDebuggerUrl;

  let attempt = 0;
  let passed = false;
  let finalResult = null;

  try {
    while (attempt < maxRetries && !passed) {
      attempt++;
      console.log(`📝 [ExamEngine] Attempt #${attempt}/${maxRetries} for exam: ${examUrl}`);

      // Step 1: Click start or retry button
      const clickedStart = await evalTab(
        wsUrl,
        `(() => {
          const btn = Array.from(document.querySelectorAll('button, a')).find(b =>
            /開始測驗|進行測驗|再次測驗|重考|開始作答|繼續測驗/.test(b.innerText || '')
          );
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        })()`
      );

      if (clickedStart) {
        await new Promise((r) => setTimeout(r, 2000));
        await evalTab(
          wsUrl,
          `(() => {
            const confirmBtn = document.querySelector('button[data-bb-handler="confirm"], .bootbox .btn-primary');
            if (confirmBtn) confirmBtn.click();
          })()`
        );
        await new Promise((r) => setTimeout(r, 3000));
      }

      // Step 2: Fill answers with progressive attempt rotation
      const answerRes = await evalTab(
        wsUrl,
        `((attemptNum) => {
          const groups = {};
          document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
            if (!input.name) return;
            if (!groups[input.name]) groups[input.name] = [];
            groups[input.name].push(input);
          });

          let answered = 0;
          for (const [name, inputs] of Object.entries(groups)) {
            let chosen = null;
            const isTF = inputs.length === 2 && inputs.some(i => /是|對|O|否|非|X/i.test(i.closest('label')?.innerText || ''));

            if (attemptNum === 1) {
              // Attempt 1: High-probability compliance bias
              chosen =
                inputs.find(i => /以上皆是|皆正確|皆對/.test(i.closest('label')?.innerText || i.parentElement?.innerText || '')) ||
                inputs.find(i => /^1$|^true$|^O$|是|對/.test((i.closest('label')?.innerText || '').trim())) ||
                inputs[0];
            } else if (attemptNum === 2) {
              // Attempt 2: Invert True/False, shift Multiple-Choice
              if (isTF) {
                chosen = inputs.find(i => /否|非|X|^0$|^false$/i.test((i.closest('label')?.innerText || '').trim())) || inputs[1] || inputs[0];
              } else {
                chosen = inputs[1 % inputs.length];
              }
            } else {
              // Attempt 3+: Round-robin shift based on attempt number
              const idx = (attemptNum - 1) % inputs.length;
              chosen = inputs[idx];
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
        })(${attempt})`
      );

      if (answerRes?.clickedSubmit) {
        await new Promise((r) => setTimeout(r, 2000));
        // Confirm submit in Bootbox modal
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
        await new Promise((r) => setTimeout(r, 3500));
      }

      // Step 3: Inspect result score and pass status
      const check = await evalTab(
        wsUrl,
        `(() => {
          const text = document.body.innerText || '';
          const scoreMatch = text.match(/(?:得分|成績|分數)[：:\\s]*(\\d+)/);
          const passMatch = text.match(/(?:及格標準|及格分數|通過標準)[：:\\s]*(\\d+)/);
          const hasPassedText = /及格|通過/.test(text) && !/不及格|未通過/.test(text);
          return {
            score: scoreMatch ? Number(scoreMatch[1]) : null,
            requiredScore: passMatch ? Number(passMatch[1]) : null,
            hasPassedText,
            snippet: text.replace(/\\s+/g, ' ').slice(0, 300)
          };
        })()`
      );

      const actualScore = check?.score;
      const targetScore = check?.requiredScore || defaultPassScore;
      passed = (actualScore !== null ? actualScore >= targetScore : check?.hasPassedText) || false;
      finalResult = { score: actualScore, targetScore, passed, attempt };

      console.log(
        `📊 [ExamEngine] Attempt #${attempt} result: Score=${actualScore ?? 'N/A'}/${targetScore}, Passed=${passed}`
      );

      if (passed) {
        console.log(`🎉 [ExamEngine] Exam PASSED on attempt #${attempt}! Score: ${actualScore ?? 'OK'}`);
        break;
      } else {
        console.warn(`⚠️ [ExamEngine] Attempt #${attempt} failed (Score: ${actualScore ?? 'N/A'}/${targetScore}). Retrying...`);
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  } finally {
    await closeTab(tab.id);
  }

  return finalResult;
}

/**
 * Backward compatibility helper for single submission
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
  submitExamAnswers,
  takeExamUntilPassed
};


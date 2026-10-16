const DEFAULT_PORT = 9222;

async function getTabs() {
  const res = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/json`);
  return await res.json();
}

function evalTab(wsUrl, expression, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const reqId = Math.floor(Math.random() * 1000000);
    const ws = new WebSocket(wsUrl);

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { ws.close(); } catch (e) {}
        reject(new Error(`evalTab timed out after ${timeoutMs}ms for: ${expression.slice(0, 50)}`));
      }
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: reqId,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id === reqId) {
          resolved = true;
          clearTimeout(timer);
          try { ws.close(); } catch (e) {}
          if (data.result && data.result.result) {
            resolve(data.result.result.value);
          } else {
            resolve(data);
          }
        }
      } catch (e) {
        // ignore other CDP events
      }
    };

    ws.onerror = (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(err);
      }
    };
  });
}

module.exports = { getTabs, evalTab, DEFAULT_PORT };

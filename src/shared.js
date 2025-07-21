export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function retry(fn, {
  attempts = 50,
  delay = 100
} = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(delay);
    }
  }
  throw lastErr || new Error("Retry attempts exhausted");
}

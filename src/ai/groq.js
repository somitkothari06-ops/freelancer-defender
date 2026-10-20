// Thin wrapper around Groq's OpenAI-compatible chat API.
//
// Why not an SDK? One fetch call is easier to read than a library, and we
// need direct access to the rate-limit headers: Groq's free tier allows
// only ~8,000 tokens per minute, so we pace calls ourselves instead of
// crashing into 429 errors in the middle of a demo.
const config = require('../config');

// Rate-limit state learned from Groq's response headers.
// Groq's tokens-per-minute budget refills continuously (limit / 60 seconds per second).
const budget = {
  limit: Infinity, // tokens per minute
  remaining: Infinity, // tokens left when we last heard from Groq
  seenAt: 0, // when we last heard from Groq
};

// How many tokens are probably available right now.
function available() {
  const refilled = ((Date.now() - budget.seenAt) / 60000) * budget.limit;
  return Math.min(budget.limit, budget.remaining + refilled);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rough token estimate (≈4 characters per token) used only for pacing.
function estimateTokens(body) {
  // Count the prompt plus a typical answer length rather than the maximum, so we don't over-wait.
  return Math.ceil(JSON.stringify(body.messages).length / 4) + Math.min(body.max_completion_tokens || 1000, 1500);
}

/**
 * Call Groq chat completions.
 * @param {object} body     OpenAI-style request body (messages, tools, response_format...)
 * @param {object} [opts]
 * @param {function} [opts.onWait]  called with (ms, reason) when we pause for rate limits
 * @returns {Promise<{message: object, usage: object}>}
 */
async function chat(body, { onWait } = {}) {
  const request = { model: config.groq.model, ...body };
  const needed = estimateTokens(request);

  for (let attempt = 1; attempt <= 5; attempt++) {
    // Wait just long enough for the per-minute token budget to refill if this call won't fit.
    const want = Math.min(needed, budget.limit);
    if (want > available()) {
      const wait = Math.ceil(((want - available()) / budget.limit) * 60000) + 250;
      onWait?.(wait, 'free-tier token budget');
      await sleep(wait);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (config.groq.apiKey) headers.Authorization = `Bearer ${config.groq.apiKey}`;

    const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    const limit = Number(res.headers.get('x-ratelimit-limit-tokens'));
    const remaining = Number(res.headers.get('x-ratelimit-remaining-tokens'));
    if (limit && !Number.isNaN(remaining)) {
      budget.limit = limit;
      budget.remaining = remaining;
      budget.seenAt = Date.now();
    }

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = retryAfter ? retryAfter * 1000 : Math.min(30000, 2000 * 2 ** attempt);
      onWait?.(wait, res.status === 429 ? 'rate limit' : 'Groq server error');
      await sleep(wait);
      continue;
    }

    const data = await res.json();
    // gpt-oss occasionally produces a tool call Groq can't parse; simply asking again fixes it.
    const flaky = ['output_parse_failed', 'tool_use_failed'].includes(data?.error?.code);
    if (flaky && attempt < 3) {
      onWait?.(500, 'model output glitch, retrying');
      continue;
    }
    if (!res.ok) {
      const err = new Error(`Groq ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
      err.status = res.status;
      err.groq = data?.error;
      throw err;
    }
    return { message: data.choices[0].message, usage: data.usage };
  }
  throw new Error('Groq: gave up after repeated rate-limit / server errors');
}

/**
 * Ask for a JSON object matching a JSON Schema (Groq "structured outputs").
 * Retries once if the model returns something that fails to parse.
 */
async function chatJSON({ messages, schema, name, maxTokens = 3000, reasoningEffort = 'medium' }, opts) {
  const body = {
    messages,
    max_completion_tokens: maxTokens,
    reasoning_effort: reasoningEffort,
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
  };
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      const { message, usage } = await chat(body, opts);
      return { data: JSON.parse(message.content), usage, reasoning: message.reasoning || '' };
    } catch (err) {
      lastErr = err;
      // A schema-validation failure on Groq's side comes back as a 400; retry once.
      if (err.status && err.status !== 400) throw err;
      // If the answer was cut off, give the retry more room.
      if (err.groq?.code === 'json_validate_failed') body.max_completion_tokens = Math.round(body.max_completion_tokens * 1.5);
    }
  }
  throw lastErr;
}

module.exports = { chat, chatJSON };

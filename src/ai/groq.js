// Thin wrapper around Groq's OpenAI-compatible chat API.
//
// Why not an SDK? One fetch call is easier to read than a library, and we
// need direct access to the rate-limit headers: Groq's free tier allows
// only ~8,000 tokens per minute, so we pace calls ourselves instead of
// crashing into 429 errors in the middle of a demo.
const config = require('../config');

// Rate-limit state learned from Groq's response headers, kept per model: different models
// have different tokens-per-minute budgets, and a single shared tracker would apply one
// model's learned pacing to another, either waiting too long or not long enough.
// Groq's tokens-per-minute budget refills continuously (limit / 60 seconds per second).
const budgets = new Map();
function budgetFor(model) {
  if (!budgets.has(model)) budgets.set(model, { limit: Infinity, remaining: Infinity, seenAt: 0 });
  return budgets.get(model);
}

// How many tokens are probably available right now.
function available(budget) {
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
  const budget = budgetFor(request.model);
  const needed = estimateTokens(request);

  for (let attempt = 1; attempt <= 6; attempt++) {
    // Wait just long enough for the per-minute token budget to refill if this call won't fit.
    const want = Math.min(needed, budget.limit);
    if (want > available(budget)) {
      const wait = Math.ceil(((want - available(budget)) / budget.limit) * 60000) + 250;
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
      // A long wait means the daily token quota is used up: fail fast with a clear message
      // instead of leaving the dashboard hanging for many minutes. Unattended recording
      // (scripts/run-one.js with GROQ_WAIT_FOR_DAILY=1) waits it out instead, so a run that
      // hits the limit halfway doesn't waste the tokens it already used.
      if (wait > 90_000 && !process.env.GROQ_WAIT_FOR_DAILY) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(
          `Groq's free-tier daily token limit is used up (${body?.error?.message?.match(/Limit \d+/)?.[0] || 'tokens per day'}). ` +
            `Live runs resume in about ${Math.ceil(wait / 60000)} min. Use "Replay a recorded run" meanwhile.`
        );
        err.status = 429;
        err.code = 'DAILY_LIMIT';
        throw err;
      }
      onWait?.(wait, res.status === 429 ? 'rate limit' : 'Groq server error');
      await sleep(wait);
      continue;
    }

    const data = await res.json();
    // gpt-oss occasionally produces a tool call Groq can't parse, or (on AG Studio's larger,
    // more complex tool schemas) one with the wrong shape entirely; simply asking again -
    // a fresh resample, not a replan - fixes it often enough to be worth several tries.
    const flaky = ['output_parse_failed', 'tool_use_failed'].includes(data?.error?.code);
    if (flaky && attempt < 6) {
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
      // An empty or incomplete answer (e.g. the model spent its budget reasoning) is treated
      // like a cut-off answer: retry once with more room.
      const data = salvage(message.content, schema);
      if (!data) throw Object.assign(new Error(`Groq returned an empty or incomplete ${name} answer.`), { groq: { code: 'json_validate_failed' } });
      return { data, usage, reasoning: message.reasoning || '' };
    } catch (err) {
      lastErr = err;
      // Groq sometimes rejects an answer that is actually fine. If the rejected text parses
      // and matches our schema, use it.
      const salvaged = salvage(err.groq?.failed_generation, schema);
      if (salvaged) return { data: salvaged, usage: null, reasoning: '' };
      // A schema-validation failure on Groq's side comes back as a 400; retry once.
      if (err.status && err.status !== 400) throw err;
      // If the answer was cut off, give the retry more room.
      if (err.groq?.code === 'json_validate_failed') body.max_completion_tokens = Math.round(body.max_completion_tokens * 1.5);
    }
  }
  throw lastErr;
}

// Parse text and check it against the JSON Schema subset we use (object/array/string/integer/enum).
function salvage(text, schema) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return fitsSchema(value, schema) ? value : null;
  } catch {
    return null;
  }
}

function fitsSchema(v, s) {
  if (s.enum && !s.enum.includes(v)) return false;
  if (s.type === 'string') return typeof v === 'string';
  if (s.type === 'integer') return Number.isInteger(v);
  if (s.type === 'array') return Array.isArray(v) && v.every((x) => fitsSchema(x, s.items));
  if (s.type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    return (s.required || []).every((k) => k in v && fitsSchema(v[k], s.properties[k]));
  }
  return true;
}

module.exports = { chat, chatJSON, fitsSchema };

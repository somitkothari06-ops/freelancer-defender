// AG Studio: "Ask about your disputes" - a natural-language panel on the dispute
// queue. Lets anyone type a question ("which dispute has the weakest evidence?")
// and watch AG Studio's built-in agents build a live widget answering it, using
// the same dispute data already shown in the AG Grid queue.
//
// Studio's AI adapter contract (AgLlmAdapter.executeTurn) expects a live, streamed
// response. We don't stream: this calls our own /api/studio/chat proxy (which
// reuses src/ai/groq.js's tested pacing/retry logic), waits for the full answer,
// then emits it to Studio as one complete burst instead of token-by-token. The
// trade-off is visible: the panel's answer "pops in" rather than typing itself
// out. Everything else - the agents, the tool calls, the widgets they build -
// works the same either way.
'use strict';

let callCounter = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(callCounter++).toString(36)}`;

// AG Studio Shape schemas use JSON Schema 2020-12. Adapt the supported subset
// to strict tool schemas, following AG Studio's reference OpenAI adapter.
const isSchema = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unsupportedKeywords = ['allOf', 'not', 'oneOf', 'if', 'then', 'else', 'prefixItems', 'patternProperties', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'dependentSchemas', 'dependentRequired', 'contains'];

function makeNullable(schema, rootDefs, resolving) {
  // Wrap enums too: adding null to type alone would still reject null via enum.
  if (schema.type === 'null') return schema;
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((b) => b.type === 'null') ? schema : { anyOf: [...schema.anyOf, { type: 'null' }] };
  }
  if (schema.$ref) {
    // A $ref that resolves to a plain string enum (e.g. AgExpressionOperator) must be inlined
    // as {type, enum} alongside null - Groq won't treat a bare $ref next to null as
    // disambiguated the way it treats an inline enum next to null.
    const enumValues = asStringEnum(schema, rootDefs, 0, resolving);
    if (enumValues) return { anyOf: [{ type: 'string', enum: enumValues }, { type: 'null' }] };
    // Most other $ref properties (including an ordinary self-referential one, e.g. a tree
    // node's "next") are fine left as a bare ref alongside null - Groq handles that shape
    // without issue. Only resolve it when what it points to is itself a bare anyOf (e.g.
    // AgApiFilter, which is its own undiscriminated union): wrapping THAT in another anyOf
    // would nest an anyOf directly inside an anyOf, which Groq's strict validator rejects - so
    // splice its branches in instead. Anything else resolved to isn't worth the expansion.
    const resolved = resolveRef(schema, rootDefs, resolving);
    if (isSchema(resolved) && Array.isArray(resolved.anyOf) && Object.keys(resolved).every((k) => k === 'anyOf' || k === 'description')) {
      return { anyOf: [...resolved.anyOf, { type: 'null' }] };
    }
  }
  return { anyOf: [schema, { type: 'null' }] };
}

// AG Studio's Shape schemas often union several typed-field references purely via
// `$ref`s to plain string enums (e.g. "pick a string field OR a datetime field" for a
// query's field id) - a bare anyOf of enums, no shared discriminator key. Groq's strict
// validator rejects that ("anyOf branches must be disambiguated..."). It's semantically
// just "one of these allowed id strings", so merge same-shape string-enum branches into
// one flat enum rather than leaving them as an undiscriminated union. This only ever
// widens what the model may send; real field validity is still checked by Studio itself
// when the tool call actually runs, so a merged enum can't let anything invalid through.
function refName(ref) {
  const m = /^#\/\$defs\/(.+)$/.exec(ref || '');
  return m ? m[1] : null;
}

// Groq evidently dereferences a bare $ref when checking whether an anyOf's branches are
// disambiguated, so a branch like {$ref: 'FieldRefString'} must be judged on the object it
// points to, not left opaque. Resolve it fully via transformSchema - but a definition that
// (directly or through another def) refers back to itself would otherwise resolve forever, so
// `resolving` tracks def names already being expanded in this call chain and leaves a repeat
// as a bare $ref instead of recursing into it again.
function resolveRef(branch, rootDefs, resolving) {
  if (!isSchema(branch) || !branch.$ref) return branch;
  const name = refName(branch.$ref);
  const def = rootDefs[name];
  if (!def || resolving.has(name)) return branch;
  resolving.add(name);
  try {
    return transformSchema(def, rootDefs, resolving);
  } finally {
    resolving.delete(name);
  }
}

function asStringEnum(node, rootDefs, depth, resolving = new Set()) {
  if (depth > 20 || !isSchema(node)) return null; // depth guard against a cyclic $ref
  if (node.$ref) {
    const name = refName(node.$ref);
    const def = rootDefs[name];
    // Share the cycle guard with resolveRef/transformSchema: without it, this resolution path
    // rebuilds a self-referential definition from scratch on every hop, independently of any
    // cycle tracking happening in the call chain that got us here, and the stack overflows.
    if (!def || resolving.has(name)) return null;
    resolving.add(name);
    try {
      return asStringEnum(transformSchema(def, rootDefs, resolving), rootDefs, depth + 1, resolving);
    } finally {
      resolving.delete(name);
    }
  }
  const keys = Object.keys(node);
  // AG Studio's own field-id enum defs carry a `description` alongside type/enum - allow it
  // through (Groq drops/ignores it on a plain enum) rather than treating it as "not an enum".
  return node.type === 'string' && Array.isArray(node.enum) && keys.every((k) => k === 'type' || k === 'enum' || k === 'description') ? node.enum : null;
}

// Only plain primitive alternatives may lose format: Studio validates the actual
// call, while Groq cannot distinguish strings by date-time format. An unconstrained
// branch subsumes an enum branch; never accidentally narrow it to that enum.
function mergePrimitives(branches) {
  const groups = new Map();
  for (const branch of branches) {
    if (!['string', 'number', 'integer', 'boolean', 'null'].includes(branch.type) ||
        !Object.keys(branch).every((k) => ['type', 'enum', 'format', 'description'].includes(k))) continue;
    const group = groups.get(branch.type) || [];
    group.push(branch);
    groups.set(branch.type, group);
  }
  return branches.flatMap((branch) => {
    const group = groups.get(branch.type);
    if (!group?.includes(branch) || group.length < 2) return [branch];
    if (branch !== group[0]) return [];
    return [{ type: branch.type, ...(group.every((b) => Array.isArray(b.enum)) ?
      { enum: [...new Set(group.flatMap((b) => b.enum))] } : {}) }];
  });
}

// AG Studio's own schemas sometimes nest a bare anyOf directly as a branch of another anyOf
// (not something we introduce - Studio emits it shaped that way, e.g. AgApiExpression). Groq's
// strict validator rejects a bare anyOf used as a branch of another anyOf, so splice its
// sub-branches into the parent instead of leaving it nested.
function flattenNestedAnyOf(branches) {
  const isBareAnyOf = (b) => isSchema(b) && Array.isArray(b.anyOf) && Object.keys(b).every((k) => k === 'anyOf' || k === 'description');
  let result = branches;
  while (result.some(isBareAnyOf)) {
    result = result.flatMap((b) => (isBareAnyOf(b) ? b.anyOf : [b]));
  }
  return result;
}

function objectsAreDisjoint(branches, rootDefs, resolving) {
  // Groq's discriminator inference always reaches for a common required enum property first.
  // With exactly one such candidate, the branches are only disjoint if it fully separates them;
  // with more than one, Groq bails outright ("multiple candidate properties") rather than trying
  // each in turn. Either way, it never falls back to key-set exclusion once a candidate exists -
  // that fallback only applies when there is no common required enum property at all.
  const candidates = Object.keys(branches[0].properties || {}).filter((key) =>
    branches.every((b) => (b.required || []).includes(key) && (asStringEnum(b.properties?.[key], rootDefs, 0, resolving) || Array.isArray(b.properties?.[key]?.enum))));
  if (candidates.length > 1) return false;
  if (candidates.length === 1) {
    const key = candidates[0];
    const values = branches.map((b) => asStringEnum(b.properties[key], rootDefs, 0, resolving) || b.properties[key].enum);
    return values.every((v, i) => values.slice(i + 1).every((other) => !v.some((value) => other.includes(value))));
  }
  // No common required enum property: every pair must exclude each other by a required, forbidden key.
  return branches.every((a, i) => branches.slice(i + 1).every((b) =>
    (a.required || []).some((key) => !(key in (b.properties || {}))) ||
    (b.required || []).some((key) => !(key in (a.properties || {})))));
}

function allPlainObjects(branches) {
  return branches.every((b) => b.type === 'object' && b.additionalProperties === false &&
    Object.keys(b).every((k) => ['type', 'properties', 'required', 'additionalProperties', 'description'].includes(k)));
}

function flattenObjects(branches, rootDefs, resolving) {
  const keys = [...new Set(branches.flatMap((b) => Object.keys(b.properties || {})))];
  // This widens field/aggregation combinations, which Groq cannot discriminate.
  // Studio still checks the real tool call. Missing branch properties become
  // nullable through the usual strict-schema optional-property conversion below.
  return {
    type: 'object',
    properties: Object.fromEntries(keys.map((key) => {
      const variants = branches.filter((b) => key in (b.properties || {})).map((b) => b.properties[key]);
      const unique = [...new Map(variants.map((v) => [JSON.stringify(v), v])).values()];
      return [key, unique.length === 1 ? unique[0] : transformSchema({ anyOf: unique }, rootDefs, resolving)];
    })),
    required: keys.filter((key) => branches.every((b) => (b.required || []).includes(key))),
    additionalProperties: false,
  };
}

function transformSchema(schema, rootDefs = {}, resolving = new Set()) {
  if (!isSchema(schema)) throw new Error('Studio requires an object JSON Schema.');
  let out = { ...schema };
  if (Array.isArray(out.anyOf)) {
    const branches = out.anyOf.filter((b) => !(isSchema(b) && Object.keys(b).length === 1 && isSchema(b.not) && Object.keys(b.not).length === 0));
    if (!branches.length) throw new Error('Studio schema contains only undefined.');
    if (branches.length === 1) {
      delete out.anyOf;
      out = { ...branches[0], ...out };
    } else out.anyOf = branches;
  }
  for (const key of unsupportedKeywords) {
    if (key in out) throw new Error(`Studio schema keyword '${key}' is unsupported.`);
  }
  if ('const' in out) {
    const value = out.const;
    delete out.const;
    out.enum = [value];
    if (!out.type) out.type = value === null ? 'null' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value;
  }
  if (out.$defs) out.$defs = Object.fromEntries(Object.entries(out.$defs).map(([key, value]) => [key, transformSchema(value, rootDefs, resolving)]));
  if (out.$ref) return { $ref: out.$ref, ...(out.$defs ? { $defs: out.$defs } : {}) };
  if (out.anyOf) {
    let transformed = mergePrimitives(flattenNestedAnyOf(out.anyOf.map((b) => transformSchema(b, rootDefs, resolving))));
    const enums = transformed.map((b) => asStringEnum(b, rootDefs, 0, resolving));
    if (enums.every(Boolean)) {
      delete out.anyOf;
      out.type = 'string';
      out.enum = [...new Set(enums.flat())];
    } else if (transformed.length === 1) {
      delete out.anyOf;
      out = { ...transformed[0], ...out };
    } else {
      // Groq requires every variant of an anyOf it treats as an object-discriminated union to be
      // fully inline, never a bare $ref - even one that would otherwise cleanly key-exclude the
      // others - or it fails with "properties must be present". Resolve any $ref branch to what
      // it points to, then re-flatten: the thing it resolves to (e.g. AgApiFilter) can itself be
      // a bare anyOf, which must be spliced in rather than left nested. A branch that's already
      // mid-resolution higher up the call chain (a cycle) is left as a bare $ref instead.
      transformed = flattenNestedAnyOf(transformed.map((b) => resolveRef(b, rootDefs, resolving)));
      if (transformed.length === 1) {
        delete out.anyOf;
        out = { ...transformed[0], ...out };
      } else if (allPlainObjects(transformed) && !objectsAreDisjoint(transformed, rootDefs, resolving)) {
        delete out.anyOf;
        out = { ...flattenObjects(transformed, rootDefs, resolving), ...out };
      } else {
        out.anyOf = transformed;
      }
    }
  }
  if (out.type === 'object' || isSchema(out.properties)) {
    if ('additionalProperties' in out && out.additionalProperties !== false) throw new Error('Studio open-ended object schemas are unsupported.');
    const required = new Set(out.required || []);
    out.properties = Object.fromEntries(Object.entries(out.properties || {}).map(([key, value]) => {
      const prop = transformSchema(value, rootDefs, resolving);
      return [key, required.has(key) ? prop : makeNullable(prop, rootDefs, resolving)];
    }));
    const keys = Object.keys(out.properties);
    if (keys.length) {
      out.required = keys;
    } else {
      // Groq treats empty properties as missing, then rejects even required: [].
      delete out.properties;
      delete out.required;
    }
    out.additionalProperties = false;
  }
  if (isSchema(out.items)) out.items = transformSchema(out.items, rootDefs, resolving);
  return out;
}

function toOpenAiSchema(schema) {
  if (schema.anyOf && schema.type !== 'object' && !isSchema(schema.properties)) throw new Error('Studio root schema must be an object.');
  return transformSchema(schema, schema.$defs || {});
}

// Remove synthetic null object properties, while preserving null array entries.
function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (isSchema(value)) return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null).map(([key, v]) => [key, stripNulls(v)]));
  return value;
}

function stripNullsFromToolArgs(args) {
  try { return JSON.stringify(stripNulls(JSON.parse(args))); }
  catch { return args; } // Let Studio report malformed arguments itself.
}

// ---- Studio conversation items -> our proxy's OpenAI-chat-shaped body -----------

function encodeContent(parts) {
  return (parts || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function encodeInput(items, instructions) {
  const messages = [];
  if (typeof instructions === 'string' && instructions.trim()) {
    messages.push({ role: 'system', content: instructions });
  }
  for (const item of items) {
    if (item.kind === 'input' && item.type === 'message') {
      messages.push({ role: item.role, content: encodeContent(item.content) });
    } else if (item.kind === 'output' && item.type === 'message') {
      messages.push({ role: 'assistant', content: encodeContent(item.content) });
    } else if (item.kind === 'output' && item.type === 'function_call') {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: item.callId, type: 'function', function: { name: item.name, arguments: item.arguments } }],
      });
    } else if (item.type === 'function_call_output') {
      messages.push({ role: 'tool', tool_call_id: item.callId, content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output) });
    }
    // Reasoning items and image/file content aren't sent - this panel is text-only.
  }
  return messages;
}

function encodeTools(tools) {
  return (tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toOpenAiSchema(t.parameters), strict: true } }));
}

function encodeToolChoice(toolChoice) {
  if (!toolChoice || toolChoice === 'auto') return 'auto';
  if (toolChoice === 'none' || toolChoice === 'required') return toolChoice;
  return { type: 'function', function: { name: toolChoice.name } };
}

function encodeResponseFormat(format) {
  if (!format || format.type === 'text') return undefined;
  return { type: 'json_schema', json_schema: { name: format.name || 'response', strict: true, schema: toOpenAiSchema(format.schema) } };
}

// ---- Groq's reply -> Studio's AgLlmResponse / stream events --------------------

function decodeToResponseAndEvents(message) {
  const events = [];
  const output = [];
  const calls = message.tool_calls || [];

  if (calls.length) {
    for (const call of calls) {
      const id = nextId('fc');
      const args = stripNullsFromToolArgs(call.function.arguments || '{}');
      events.push({ type: 'TOOL_CALL_START', toolCallId: call.id, toolCallName: call.function.name });
      events.push({ type: 'TOOL_CALL_ARGS', toolCallId: call.id, delta: args });
      events.push({ type: 'TOOL_CALL_END', toolCallId: call.id });
      output.push({ id, kind: 'output', type: 'function_call', callId: call.id, name: call.function.name, arguments: args, status: 'completed' });
    }
  } else {
    const id = nextId('msg');
    const text = message.content || '';
    events.push({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' });
    events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: text });
    events.push({ type: 'TEXT_MESSAGE_END', messageId: id });
    output.push({ id, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });
  }
  return { output, events };
}

// ---- The adapter ----------------------------------------------------------------

function groqAdapter() {
  return {
    executeTurn(request, options) {
      let resolveComplete;
      let rejectComplete;
      const complete = new Promise((resolve, reject) => {
        resolveComplete = resolve;
        rejectComplete = reject;
      });
      complete.catch(() => {}); // observed even if nothing awaits it

      async function* run() {
        try {
          const body = {
            messages: encodeInput(request.input, request.instructions),
            tools: encodeTools(request.tools),
            tool_choice: encodeToolChoice(request.toolChoice),
            response_format: encodeResponseFormat(request.responseFormat),
          };
          const res = await fetch('/api/studio/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: options?.signal,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const e = new Error(data.error || `HTTP ${res.status}`);
            throw e;
          }
          if (!isSchema(data.message)) throw new Error('Studio received an invalid chat response.');
          const { output, events } = decodeToResponseAndEvents(data.message);
          for (const ev of events) yield ev;
          resolveComplete({
            id: nextId('resp'),
            createdAt: Date.now(),
            status: 'completed',
            output,
            usage: data.usage
              ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
              : undefined,
          });
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          rejectComplete(e);
          throw e;
        }
      }

      const iterator = run();
      return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
    },
  };
}

window.freelancerDefenderStudio = { groqAdapter };

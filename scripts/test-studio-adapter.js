// Isolated adapter contract tests; no credentials, network, or Groq quota used.
// Run: node --test scripts/test-studio-adapter.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function adapter(fetch) {
  const context = vm.createContext({ window: {}, fetch });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/studio.js'), 'utf8'), context);
  return context.window.freelancerDefenderStudio.groqAdapter();
}
const input = [{ kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text: 'Which dispute has the largest amount?' }] }];
const schema = {
  type: 'object', properties: {
    query: { type: 'object', properties: {
      table: { const: 'disputes' },
      limit: { anyOf: [{ type: 'integer' }, { not: {} }] },
      mode: { type: 'string', enum: ['select', 'aggregate'] },
      bounds: { type: 'array', items: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
    }, required: ['table'], additionalProperties: false },
  }, required: ['query'], additionalProperties: false,
};
const json = (v) => JSON.parse(JSON.stringify(v));
async function consume(turn) {
  const events = [];
  for await (const event of turn.stream) events.push(event);
  return { events, response: await turn.complete };
}

test('prepends turn instructions as a system message before conversation history', async () => {
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  const history = [...input, { kind: 'output', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Checking disputes.' }] }];
  await consume(a.executeTurn({ input: history, instructions: 'some system guidance' }));
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'some system guidance' },
    { role: 'user', content: 'Which dispute has the largest amount?' },
    { role: 'assistant', content: 'Checking disputes.' },
  ]);
});

test('keeps the first conversation message unchanged when instructions are omitted', async () => {
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  await consume(a.executeTurn({ input }));
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Which dispute has the largest amount?' }]);
});

test('ignores empty, whitespace-only, and non-string instructions', async () => {
  const a = adapter(async (_, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Which dispute has the largest amount?' }]);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  for (const instructions of ['', ' \n\t ', null, false, 42, {}, ['guidance']]) {
    await consume(a.executeTurn({ input, instructions }));
  }
});

test('encodes nested optional Shape fields and structured response formats without mutating schemas', async () => {
  const original = JSON.stringify(schema);
  let body;
  const a = adapter(async (url, init) => {
    assert.equal(url, '/api/studio/chat');
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  await consume(a.executeTurn({ input, tools: [{ name: 'execute_query', parameters: schema }], responseFormat: { type: 'json_schema', schema } }));
  const tool = body.tools[0].function;
  assert.equal(tool.strict, true);
  assert.deepEqual(tool.parameters, body.response_format.json_schema.schema);
  const query = tool.parameters.properties.query;
  assert.deepEqual(query.required, ['table', 'limit', 'mode', 'bounds']);
  assert.deepEqual(query.properties.table, { type: 'string', enum: ['disputes'] });
  assert.deepEqual(query.properties.limit, { anyOf: [{ type: 'integer' }, { type: 'null' }] });
  assert.deepEqual(query.properties.mode.anyOf[1], { type: 'null' });
  assert.deepEqual(query.properties.bounds.anyOf[0].items.anyOf[1], { type: 'null' });
  assert.equal(JSON.stringify(schema), original);
});

test('omits empty properties and required for the zero-argument view_schema tool', async () => {
  const parameters = { type: 'object', properties: {}, required: [], additionalProperties: false };
  const original = JSON.stringify(parameters);
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { tool_calls: [{
      id: 'view1', function: { name: 'view_schema', arguments: '{}' },
    }] } }) };
  });
  const { response } = await consume(a.executeTurn({
    input, tools: [{ name: 'view_schema', parameters }],
    responseFormat: { type: 'json_schema', schema: parameters },
  }));
  const expected = { type: 'object', additionalProperties: false };
  assert.deepEqual(body.tools[0].function.parameters, expected);
  assert.deepEqual(body.response_format.json_schema.schema, expected);
  assert.equal(response.output[0].arguments, '{}');
  assert.equal(JSON.stringify(parameters), original);
});

test('merges an undiscriminated anyOf of $ref string enums into one flat enum', async () => {
  // AG Studio's own shape for "pick a field of one of several allowed types": a bare
  // anyOf of two $refs, each resolving to a plain string enum, no shared discriminator.
  // Groq's strict validator rejects that outright - this is the real failure this
  // merge exists to fix, reproduced from an actual captured request.
  const parameters = {
    type: 'object',
    properties: {
      id: { anyOf: [{ $ref: '#/$defs/StringFields' }, { $ref: '#/$defs/DateFields' }] },
    },
    required: ['id'],
    additionalProperties: false,
    $defs: {
      StringFields: { type: 'string', enum: ['client', 'reason'] },
      DateFields: { type: 'string', enum: ['due', 'created'] },
    },
  };
  const original = JSON.stringify(parameters);
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  await consume(a.executeTurn({ input, tools: [{ name: 'execute_query', parameters }] }));
  const id = body.tools[0].function.parameters.properties.id;
  assert.equal(id.anyOf, undefined);
  assert.equal(id.type, 'string');
  assert.deepEqual([...id.enum].sort(), ['client', 'created', 'due', 'reason']);
  assert.equal(JSON.stringify(parameters), original);
});

test('merges anyOf-of-$ref string enums even when the enum defs carry a description', async () => {
  // Reproduces an actual captured failure: AG Studio's real FieldIds* defs are
  // {type, enum, description}, not the bare {type, enum} used above. The merge must
  // still recognize these as plain string enums, or the anyOf is left undiscriminated
  // and Groq rejects it exactly as it did here.
  const parameters = {
    type: 'object',
    properties: {
      id: { anyOf: [{ $ref: '#/$defs/StringFields' }, { $ref: '#/$defs/DateFields' }] },
    },
    required: ['id'],
    additionalProperties: false,
    $defs: {
      StringFields: { type: 'string', enum: ['client', 'reason'], description: 'A string-valued field.' },
      DateFields: { type: 'string', enum: ['due', 'created'], description: 'A datetime-valued field.' },
    },
  };
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  await consume(a.executeTurn({ input, tools: [{ name: 'execute_query', parameters }] }));
  const id = body.tools[0].function.parameters.properties.id;
  assert.equal(id.anyOf, undefined);
  assert.equal(id.type, 'string');
  assert.deepEqual([...id.enum].sort(), ['client', 'created', 'due', 'reason']);
});

test('merges a single-branch anyOf wrapping an object whose own property is an undiscriminated anyOf', async () => {
  // AG Studio wraps even a single alternative in anyOf (e.g. FieldRefDimensionNoAgg:
  // {anyOf: [{type:'object', properties:{id: {anyOf: [...refs]}}, ...}]}). The outer
  // single-branch anyOf unwraps into the object - which must then still get its own
  // properties (here `id`) recursively transformed and merged.
  const parameters = {
    type: 'object',
    properties: { ref: { $ref: '#/$defs/FieldRefDimensionNoAgg' } },
    required: ['ref'],
    additionalProperties: false,
    $defs: {
      FieldRefDimensionNoAgg: {
        anyOf: [{
          type: 'object',
          properties: { id: { anyOf: [{ $ref: '#/$defs/StringFields' }, { $ref: '#/$defs/DateFields' }] } },
          required: ['id'],
          additionalProperties: false,
        }],
      },
      StringFields: { type: 'string', enum: ['client', 'reason'], description: 'A string-valued field.' },
      DateFields: { type: 'string', enum: ['due', 'created'], description: 'A datetime-valued field.' },
    },
  };
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  await consume(a.executeTurn({ input, tools: [{ name: 'execute_query', parameters }] }));
  const fieldRef = body.tools[0].function.parameters.$defs.FieldRefDimensionNoAgg;
  assert.equal(fieldRef.anyOf, undefined);
  assert.equal(fieldRef.type, 'object');
  const id = fieldRef.properties.id;
  assert.equal(id.anyOf, undefined);
  assert.equal(id.type, 'string');
  assert.deepEqual([...id.enum].sort(), ['client', 'created', 'due', 'reason']);
});

test('leaves a genuine type union (e.g. optional-as-nullable) as a real anyOf, not merged', async () => {
  // A string-enum branch next to {type:'null'} must NOT be merged away - that would
  // make a required field silently accept null, which is a different, real union.
  const parameters = {
    type: 'object',
    properties: { status: { anyOf: [{ type: 'string', enum: ['open', 'closed'] }, { type: 'null' }] } },
    required: ['status'],
    additionalProperties: false,
  };
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  await consume(a.executeTurn({ input, tools: [{ name: 'x', parameters }] }));
  const status = body.tools[0].function.parameters.properties.status;
  assert.deepEqual(status.anyOf, [{ type: 'string', enum: ['open', 'closed'] }, { type: 'null' }]);
});

test('transforms definitions under root refs, including recursive refs', async () => {
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  const parameters = { $ref: '#/$defs/node', $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } } };
  await consume(a.executeTurn({ input, tools: [{ name: 'tree', parameters }] }));
  const result = body.tools[0].function.parameters;
  assert.equal(result.$ref, '#/$defs/node');
  assert.deepEqual(result.$defs.node.required, ['next']);
  assert.equal(result.$defs.node.additionalProperties, false);
  assert.equal(result.$defs.node.properties.next.anyOf[0].$ref, '#/$defs/node');
});

test('emits identical cleaned arguments to events and completion, retaining null array entries', async () => {
  const a = adapter(async () => ({ ok: true, json: async () => ({ message: { tool_calls: [{
    id: 'call1', function: { name: 'execute_query', arguments: '{"query":{"table":"disputes","limit":null,"bounds":[10,null],"nested":{"unused":null}}}' },
  }] }, usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }) }));
  const { events, response } = await consume(a.executeTurn({ input }));
  assert.deepEqual(events.map((e) => e.type), ['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END']);
  assert.equal(events[1].delta, response.output[0].arguments);
  assert.deepEqual(JSON.parse(events[1].delta), { query: { table: 'disputes', bounds: [10, null], nested: {} } });
  assert.deepEqual(json(response.usage), { inputTokens: 12, outputTokens: 3, totalTokens: 15 });
});

test('keeps malformed arguments for Studio validation', async () => {
  const a = adapter(async () => ({ ok: true, json: async () => ({ message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{broken' } }] } }) }));
  const { response } = await consume(a.executeTurn({ input }));
  assert.equal(response.output[0].arguments, '{broken');
});

test('text is emitted verbatim as data, never inserted into HTML by this adapter', async () => {
  const text = '<img src=x onerror=alert(1)>';
  const a = adapter(async () => ({ ok: true, json: async () => ({ message: { content: text } }) }));
  const { events, response } = await consume(a.executeTurn({ input }));
  assert.equal(events[1].delta, text);
  assert.equal(response.output[0].content[0].text, text);
});

for (const [label, fetch, request, pattern] of [
  ['unsupported schema', async () => assert.fail('must fail before fetch'), { input, tools: [{ name: 'x', parameters: { type: 'object', additionalProperties: { type: 'string' } } }] }, /open-ended/],
  ['HTTP error', async () => ({ ok: false, status: 400, json: async () => ({ error: 'validation failed' }) }), { input }, /validation failed/],
  ['network error', async () => { throw new Error('connection lost'); }, { input }, /connection lost/],
  ['aborted fetch', async (_, init) => { assert.equal(init.signal.aborted, true); throw new Error('aborted'); }, { input }, /aborted/],
  ['invalid response', async () => ({ ok: true, json: async () => ({}) }), { input }, /invalid chat response/],
]) {
  test(`${label} rejects both stream and completion rather than hanging`, async () => {
    const turn = adapter(fetch).executeTurn(request, { signal: { aborted: true } });
    const completion = assert.rejects(turn.complete, pattern);
    await assert.rejects(async () => { for await (const event of turn.stream) void event; }, pattern);
    await completion;
  });
}

async function encodedSchema(parameters) {
  let body;
  const a = adapter(async (_, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ message: { content: 'Done' } }) };
  });
  await consume(a.executeTurn({ input, tools: [{ name: 'execute_query', parameters }] }));
  return body.tools[0].function.parameters;
}

test('collapses duplicate strings in the captured AgApiExpression.literal shape', async () => {
  const literal = { anyOf: [
    { type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'string', format: 'date-time' },
  ] };
  const parameters = {
    type: 'object', properties: { expression: { $ref: '#/$defs/AgApiExpression' } }, required: ['expression'], additionalProperties: false,
    $defs: { AgApiExpression: { anyOf: [{ type: 'object', properties: { literal }, required: ['literal'], additionalProperties: false }] } },
  };
  const original = JSON.stringify(parameters);
  const result = await encodedSchema(parameters);
  assert.deepEqual(result.$defs.AgApiExpression.properties.literal, {
    anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
  });
  assert.equal(JSON.stringify(parameters), original);
});

test('flattens the captured four-branch FieldRef with overlapping id and aggregation enums', async () => {
  // Exact captured FieldRef structure and definition names. The capture supplied
  // example field names rather than full enum contents; all defs retain description.
  const FieldRef = { anyOf: [
    { type: 'object', properties: {
      id: { anyOf: [
        { $ref: '#/$defs/FieldIdsStringRolesCategoryAggCountCountdFirstLast' },
        { $ref: '#/$defs/FieldIdsDatetimeRolesCategoryNumericTemporalAggCountCountdFirstLast' },
      ] },
      aggregation: { type: 'string', enum: ['count', 'countd', 'first', 'last'] },
    }, required: ['id', 'aggregation'], additionalProperties: false },
    { type: 'object', properties: {
      id: { $ref: '#/$defs/FieldIdsNumberRolesCategoryNumericAggAvgCountCountdFirstLastMaxMinSum' },
      aggregation: { type: 'string', enum: ['avg', 'count', 'countd', 'first', 'last', 'max', 'min', 'sum'] },
    }, required: ['id', 'aggregation'], additionalProperties: false },
    { type: 'object', properties: {
      id: { $ref: '#/$defs/FieldIdsBooleanRolesCategoryAggCountCountd' },
      aggregation: { type: 'string', enum: ['count', 'countd'] },
    }, required: ['id', 'aggregation'], additionalProperties: false },
    { type: 'object', properties: {
      id: { anyOf: [
        { $ref: '#/$defs/FieldIdsStringRolesCategoryAggCountCountdFirstLast' },
        { $ref: '#/$defs/FieldIdsNumberRolesCategoryNumericAggAvgCountCountdFirstLastMaxMinSum' },
        { $ref: '#/$defs/FieldIdsDatetimeRolesCategoryNumericTemporalAggCountCountdFirstLast' },
        { $ref: '#/$defs/FieldIdsBooleanRolesCategoryAggCountCountd' },
      ] },
    }, required: ['id'], additionalProperties: false },
  ] };
  const parameters = {
    type: 'object', properties: { field: { $ref: '#/$defs/FieldRef' } }, required: ['field'], additionalProperties: false,
    $defs: {
      FieldRef,
      FieldIdsStringRolesCategoryAggCountCountdFirstLast: { type: 'string', enum: ['disputes.channel', 'disputes.client'], description: 'String fields.' },
      FieldIdsDatetimeRolesCategoryNumericTemporalAggCountCountdFirstLast: { type: 'string', enum: ['disputes.created'], description: 'Datetime fields.' },
      FieldIdsNumberRolesCategoryNumericAggAvgCountCountdFirstLastMaxMinSum: { type: 'string', enum: ['disputes.amount'], description: 'Number fields.' },
      FieldIdsBooleanRolesCategoryAggCountCountd: { type: 'string', enum: ['disputes.open'], description: 'Boolean fields.' },
    },
  };
  const original = JSON.stringify(parameters);
  const result = (await encodedSchema(parameters)).$defs.FieldRef;
  assert.equal(result.anyOf, undefined);
  assert.equal(result.type, 'object');
  assert.equal(result.additionalProperties, false);
  // Strict tools require every key; null represents the absent aggregation.
  assert.deepEqual(result.required, ['id', 'aggregation']);
  assert.deepEqual(result.properties.id, { type: 'string', enum: [
    'disputes.channel', 'disputes.client', 'disputes.created', 'disputes.amount', 'disputes.open',
  ] });
  assert.deepEqual(result.properties.aggregation, { anyOf: [
    { type: 'string', enum: ['count', 'countd', 'first', 'last', 'avg', 'max', 'min', 'sum'] }, { type: 'null' },
  ] });
  assert.equal(JSON.stringify(parameters), original);
});

test('plain primitive branches subsume enums but significant constraints remain intact', async () => {
  const variants = [
    { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'string', format: 'date-time' }] },
    { anyOf: [{ type: 'number', enum: [1] }, { type: 'number', enum: [2] }] },
    { anyOf: [{ type: 'string', minLength: 3 }, { type: 'string', format: 'date-time' }] },
  ];
  for (const [i, value] of variants.entries()) {
    const result = await encodedSchema({ type: 'object', properties: { value }, required: ['value'], additionalProperties: false });
    assert.deepEqual(result.properties.value, [
      { type: 'string' }, { type: 'number', enum: [1, 2] }, variants[2],
    ][i]);
  }
});

test('preserves discriminated objects, key-exclusive objects, and object/null unions', async () => {
  const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
  const variants = [
    { anyOf: [object({ kind: { type: 'string', enum: ['a'] } }), object({ kind: { type: 'string', enum: ['b'] } })] },
    { anyOf: [object({ a: { type: 'string' } }), object({ b: { type: 'number' } })] },
    { anyOf: [object({ id: { type: 'string' } }), { type: 'null' }] },
  ];
  for (const value of variants) {
    const result = await encodedSchema({ type: 'object', properties: { value }, required: ['value'], additionalProperties: false });
    assert.deepEqual(result.properties.value, value);
  }
});

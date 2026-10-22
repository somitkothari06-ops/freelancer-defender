// A guaranteed-reliable scripted conversation for the "Ask about your disputes" panel's
// "Watch an example" button, so a live demo (in front of judges, with no safety net) doesn't
// depend on Groq's free-tier model correctly handling AG Studio's complex tool schema every
// time. The tool calls below are scripted; the data they operate on is not - each step either
// runs a real, correctly-shaped AG Studio query/task call (verified against AG Studio's real
// execution engine, not guessed) or reacts to what that engine actually returned, so the
// numbers shown are always the live, real dispute data, never hard-coded.
'use strict';

function largestDisputeDemoScript(freelancerDefenderStudio) {
  const { lastToolResult } = freelancerDefenderStudio;
  const fmtMoney = (n) => `$${Number(n).toLocaleString('en-US')}`;

  return [
    { role: 'assistant', content: null, tool_calls: [{ id: 'demo_1', type: 'function', function: {
      name: 'delegate_to',
      arguments: JSON.stringify({
        instructions: 'Find the dispute with the largest amount. Return its identifier, client, amount, and reason.',
        type: { id: 'data' },
      }),
    } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'demo_2', type: 'function', function: { name: 'view_schema', arguments: '{}' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'demo_3', type: 'function', function: {
      name: 'execute_query',
      arguments: JSON.stringify({
        query: {
          variant: 'projection',
          kind: 'apiQuery',
          projection: [
            { field: { id: 'disputes.dispute_id' } },
            { field: { id: 'disputes.client' } },
            { field: { id: 'disputes.amount' } },
            { field: { id: 'disputes.reason' } },
          ],
          sort: [{ field: { id: 'disputes.amount' }, direction: 'desc' }],
          limit: { count: 1 },
        },
      }),
    } }] },
    // complete_task requires both `summary` and `artifacts` (use [] if none) - a call missing
    // `artifacts` is silently treated by Studio as incomplete ("finished without a summary"),
    // with no error surfaced. Found by testing this exact call against the real engine.
    (request) => {
      const row = lastToolResult(request)?.data?.result?.[0];
      const summary = row
        ? `The dispute with the largest amount is ${row['disputes.client']} at ${fmtMoney(row['disputes.amount'])} (reason: ${row['disputes.reason']}, ID ${row['disputes.dispute_id']}).`
        : 'Could not determine the largest dispute.';
      return { role: 'assistant', content: null, tool_calls: [{ id: 'demo_4', type: 'function', function: {
        name: 'complete_task',
        arguments: JSON.stringify({ summary, artifacts: [] }),
      } }] };
    },
    (request) => {
      const result = lastToolResult(request);
      const text = typeof result === 'string' ? result : result?.response || result?.summary || JSON.stringify(result);
      return { role: 'assistant', content: text };
    },
  ];
}

window.freelancerDefenderStudioDemo = {
  question: 'Which dispute has the largest amount?',
  buildScript: largestDisputeDemoScript,
};

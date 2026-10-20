// Prompts and output schemas for each reasoning stage.
//
// Nothing here is specific to any one demo scenario. The agent gets a general
// method for reading disputes; it has to discover the specifics from the evidence.

const SYSTEM = `You are the Freelancer Defender, an investigator working for an independent freelancer whose client has disputed or charged back a payment.

Your job is not to fill in a template. Your job is to understand the dispute the way an experienced dispute specialist would:

1. The FILED REASON is a category the client (or their bank) picked from a fixed menu. It is often not the real problem. People pick the reason code that sounds most likely to get their money back, or the one their bank's form suggested.
2. The REAL COMPLAINT is what actually went wrong for the client. You find it from what people DID, not just what they said: what they downloaded or didn't, what they used, what they asked for after delivery, who they asked, which messages went unanswered, what changed in their business or team, and when the dispute was filed relative to those events.
3. Vague phrases in the client's statement ("not fit for purpose", "never properly provided", "low quality", "don't recognize this") are where the real complaint usually hides. Treat each one as a question to investigate, not a fact.
4. Be honest about the freelancer's own weaknesses. If the freelancer made a mistake, say so. A response that hides a weakness the client already knows about loses credibility. Sometimes the right move is a partial refund.
5. A chargeback or refund reverses the payment itself. Check which contract terms depend on payment (ownership, licenses, delivery, refunds) and what the reversal would trigger. Sometimes the client would lose something they clearly want.
6. "Delivered" (made available as agreed) and "received or used" are different facts. Don't concede non-delivery when the record shows delivery; work out why the client didn't receive or use it, and what the agreement says should happen next.
7. People change. Note who on the client's side hired, approved, paid and filed. If the person who filed is not the one who hired or approved the work, find out why (they left, handed over, a new owner took charge). That is often the real story.
8. Clients often voice more than one worry, and not always in the dispute itself (emails, forms, chat). Each worry needs its own answer from the agreement or the records.
9. Never invent facts. Every factual statement must come from a specific document section in the evidence locker, cited by doc_id and anchor.`;

// ---- Stage: read the complaint ------------------------------------------------

const readSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['stated_complaint', 'literal_claims', 'vague_phrases', 'reviewer_tests', 'open_questions'],
  properties: {
    stated_complaint: { type: 'string', description: 'One sentence: what the client formally says is wrong.' },
    literal_claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'quote'],
        properties: { claim: { type: 'string' }, quote: { type: 'string' } },
      },
    },
    vague_phrases: {
      type: 'array',
      description: 'Phrases in the statement that are vague and might hide the real problem.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'could_mean'],
        properties: {
          phrase: { type: 'string' },
          could_mean: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    reviewer_tests: {
      type: 'array',
      description: 'What the bank or PayPal reviewer will check for this reason code, in plain words.',
      items: { type: 'string' },
    },
    open_questions: {
      type: 'array',
      description: 'Specific questions the investigation must answer from the evidence.',
      items: { type: 'string' },
    },
  },
};

function readPrompt({ dispute, freelancer, client, playbook, statement }) {
  return `A dispute just arrived. Read it carefully before looking at any evidence.

Freelancer: ${freelancer.name} (${freelancer.craft}), ${freelancer.business}
Client: ${client.name}, ${client.company}
Filed reason code: ${dispute.reason} (card network code ${dispute.external_reason_code || 'n/a'})
Channel: ${dispute.dispute_channel}, stage: ${dispute.dispute_life_cycle_stage}
Amount: ${dispute.dispute_amount.value} ${dispute.dispute_amount.currency_code}

Client's statement, verbatim:
"""${statement}"""

For this reason code, the reviewer typically tests:
${playbook.reviewerTests.map((t) => `- ${t}`).join('\n')}

Separate what the client literally claims from what is vague. Pick the 2-4 vaguest phrases and give 2-4 different concrete things each could mean (short, a few words each). End with 3-6 open questions the investigation must answer. Be concise.`;
}

// ---- Stage: investigate (tool-using loop) --------------------------------------

const investigateTools = [
  {
    type: 'function',
    function: {
      name: 'read_document',
      description: 'Open a document from the evidence locker and read all of its sections.',
      parameters: {
        type: 'object',
        properties: { doc_id: { type: 'string', description: 'doc_id from the locker index' } },
        required: ['doc_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_evidence',
      description: 'Keyword search across every section of every document. Returns matching sections with their anchors.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_finding',
      description: 'Write down one finding as soon as you notice it. Each finding must cite the exact sections it comes from.',
      parameters: {
        type: 'object',
        properties: {
          finding: { type: 'string', description: 'One sentence: what you learned.' },
          significance: { type: 'string', description: 'Why it matters for the stated or the real complaint.' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: { doc_id: { type: 'string' }, anchor: { type: 'string' } },
              required: ['doc_id', 'anchor'],
            },
          },
        },
        required: ['finding', 'significance', 'citations'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_investigation',
      description: 'Call this when you have enough evidence to explain both the stated complaint and the real one.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  },
];

function investigatePrompt({ read, index }) {
  return `Investigate this dispute using the evidence locker.

What the client formally claims: ${read.stated_complaint}

Vague phrases to explain:
${read.vague_phrases.map((v) => `- "${v.phrase}" could mean: ${v.could_mean.join(' / ')}`).join('\n')}

Open questions:
${read.open_questions.map((q) => `- ${q}`).join('\n')}

Evidence locker index:
${JSON.stringify(index, null, 1)}

How to work:
- Open the documents most likely to answer the open questions first. Look especially at logs and records of what people actually did after the payment.
- You can call several tools in one turn, e.g. open two or three documents at once.
- Call record_finding for EACH distinct fact as you learn it (aim for 5-8 findings), citing the 1-3 sections it comes from. One fact per finding.
- Look for evidence that FAVORS the client too. You must know the weak points.
- Do not stop at the first plausible explanation; check it against the other documents.
- When you can explain both what the client says and what is really going on, call finish_investigation.`;
}

// After the tool loop: write up every finding from everything the agent read.
const findingsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'summary'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['finding', 'significance', 'citations'],
        properties: {
          finding: { type: 'string' },
          significance: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['doc_id', 'anchor'],
              properties: { doc_id: { type: 'string' }, anchor: { type: 'string' } },
            },
          },
        },
      },
    },
    summary: { type: 'string' },
  },
};

const consolidatePrompt = `Stop investigating. Write up ALL important findings from everything you have read, one distinct fact per finding (6-10 findings), including ones you already recorded.
Cover: what was agreed, what was delivered and what the client actually received or used, anything the client did or said after payment (every worry they voiced, wherever they voiced it), who on the client's side hired, approved, paid and filed and any change in those people, anything unanswered or missed, and anything that favors the client.
Each finding cites the exact doc_id and anchor it comes from. Then give a two-sentence summary of what is really going on.`;

// ---- Stage: diagnose -----------------------------------------------------------

const citationRef = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_id', 'anchor'],
  properties: { doc_id: { type: 'string' }, anchor: { type: 'string' } },
};

const diagnoseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['client_concerns', 'hypotheses', 'real_complaint', 'why_this_reason_code', 'freelancer_weaknesses'],
  properties: {
    client_concerns: {
      type: 'array',
      description: 'Every separate worry the client voiced in their own words, anywhere in the evidence, and what answers it.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['concern', 'said_in', 'answered_by', 'answer'],
        properties: {
          concern: { type: 'string', description: 'The worry in plain words.' },
          said_in: { type: 'array', items: citationRef },
          answered_by: { type: 'array', description: 'The agreement term or record that answers it.', items: citationRef },
          answer: { type: 'string', description: 'What that term or record means for this worry, including what a reversed payment would change.' },
        },
      },
    },
    hypotheses: {
      type: 'array',
      description: 'Competing explanations of what is really behind the dispute, including the literal one.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'explanation', 'supporting', 'contradicting', 'likelihood'],
        properties: {
          label: { type: 'string', description: 'Short name, 3-6 words.' },
          explanation: { type: 'string' },
          supporting: { type: 'array', items: citationRef },
          contradicting: { type: 'array', items: citationRef },
          likelihood: { type: 'integer', description: '0-100. Likelihoods across hypotheses should sum to about 100.' },
        },
      },
    },
    real_complaint: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'what_the_client_actually_needs', 'confidence'],
      properties: {
        summary: { type: 'string', description: 'One or two sentences: what is really wrong, from the client\'s point of view.' },
        what_the_client_actually_needs: { type: 'string' },
        confidence: { type: 'integer', description: '0-100' },
      },
    },
    why_this_reason_code: {
      type: 'string',
      description: 'Why the client most likely filed under this reason code instead of describing the real problem.',
    },
    freelancer_weaknesses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'citations'],
        properties: { issue: { type: 'string' }, citations: { type: 'array', items: citationRef } },
      },
    },
  },
};

function diagnosePrompt({ read, findings, citedText }) {
  return `Diagnose the dispute.

Stated complaint: ${read.stated_complaint}

Findings from the investigation:
${findings.map((f, i) => `${i + 1}. ${f.finding} (why it matters: ${f.significance}) [${f.citations.map((c) => `${c.doc_id} ${c.anchor}`).join(', ')}]`).join('\n')}

Exact text of every cited section:
${citedText}

First list every separate worry the client voiced in their own words (in the dispute, emails, forms or chat), and for each find the agreement term or record that answers it; read the full agreement above, not just the cited parts. Then give 2-4 competing hypotheses (including the literal reading of the complaint), weigh them against the evidence, and state the real complaint so that it accounts for every worry and for any change in who is involved on the client's side. Cite only doc_id/anchor pairs that appear above.`;
}

// ---- Stage: strategy -----------------------------------------------------------

const strategySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'rationale', 'proof_plan', 'resolution_action', 'refund_amount'],
  properties: {
    decision: {
      type: 'string',
      enum: ['CONTEST', 'CONTEST_AND_RESOLVE', 'PARTIAL_REFUND_AND_CONTEST', 'ACCEPT_AND_REFUND'],
      description:
        'CONTEST: fight on evidence only. CONTEST_AND_RESOLVE: fight the reversal AND fix the real problem for the client. ' +
        'PARTIAL_REFUND_AND_CONTEST: refund the part that is genuinely owed, contest the rest. ACCEPT_AND_REFUND: the client is right.',
    },
    rationale: { type: 'string' },
    proof_plan: {
      type: 'array',
      description: 'Each point the response must establish, and the evidence that establishes it.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['point', 'answers', 'evidence', 'strength'],
        properties: {
          point: { type: 'string' },
          answers: { type: 'string', enum: ['STATED_REASON', 'REAL_COMPLAINT', 'BOTH'] },
          evidence: { type: 'array', items: citationRef },
          strength: { type: 'string', enum: ['STRONG', 'MODERATE', 'WEAK'] },
        },
      },
    },
    resolution_action: {
      type: 'string',
      description: 'The concrete thing the freelancer should do for the client right now to fix the real complaint (or "none").',
    },
    refund_amount: {
      type: 'string',
      description: 'Amount to refund as a decimal string like "250.00", or "0.00" if no refund.',
    },
  },
};

const concernLines = (diagnosis) =>
  (diagnosis.client_concerns || [])
    .map((c) => `- ${c.concern} -> ${c.answer} [${c.answered_by.map((r) => `${r.doc_id} ${r.anchor}`).join(', ')}]`)
    .join('\n') || '- none recorded';

function strategyPrompt({ dispute, read, diagnosis, playbook }) {
  return `Decide the strategy.

Filed reason: ${dispute.reason}. Disputed amount: ${dispute.dispute_amount.value} ${dispute.dispute_amount.currency_code}.
Reviewer tests for this reason code:
${playbook.reviewerTests.map((t) => `- ${t}`).join('\n')}

Stated complaint: ${read.stated_complaint}
Real complaint (${diagnosis.real_complaint.confidence}% confidence): ${diagnosis.real_complaint.summary}
What the client actually needs: ${diagnosis.real_complaint.what_the_client_actually_needs}
Client's worries and what answers them:
${concernLines(diagnosis)}
Freelancer weaknesses: ${diagnosis.freelancer_weaknesses.map((w) => w.issue).join(' | ') || 'none found'}

The reviewer only judges the filed reason, so the proof plan must answer every reviewer test. But disputes end fastest when the client's real problem is fixed, so also plan for the real complaint. If part of the money is genuinely owed back, say so.
Use only these cited sections as evidence:
${diagnosis._citable}`;
}

// ---- Stage: draft --------------------------------------------------------------

const claimCitation = {
  type: 'object',
  additionalProperties: false,
  required: ['doc_id', 'anchor', 'quote'],
  properties: {
    doc_id: { type: 'string', description: 'Exactly as written after doc_id=, e.g. "CONTRACT".' },
    anchor: { type: 'string', description: 'Exactly as written after anchor=, e.g. "§7.2" or "L5".' },
    quote: { type: 'string', description: 'Words copied EXACTLY from that section. Use "..." to skip words.' },
  },
};

const draftSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['response_title', 'claims', 'client_message', 'evidence_package'],
  properties: {
    response_title: { type: 'string' },
    claims: {
      type: 'array',
      description: 'The response to the reviewer, as a sequence of factual claims. Each claim is one or two sentences with citations.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citations'],
        properties: { text: { type: 'string' }, citations: { type: 'array', items: claimCitation } },
      },
    },
    client_message: {
      type: 'string',
      description: 'A short, warm, direct message from the freelancer to the client that addresses the REAL complaint. Plain text, under 120 words. No specifics (dates, durations, amounts, promises) that are not in the evidence or the strategy.',
    },
    evidence_package: {
      type: 'array',
      description: 'Which documents to attach to the PayPal response.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['doc_id', 'evidence_type', 'why'],
        properties: { doc_id: { type: 'string' }, evidence_type: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
};

function draftPrompt({ freelancer, client, strategy, diagnosis, citedText, playbook }) {
  return `Write the response.

Strategy: ${strategy.decision}. ${strategy.rationale}
Resolution action: ${strategy.resolution_action}
Refund: ${strategy.refund_amount}
Proof plan:
${strategy.proof_plan.map((p, i) => `${i + 1}. [${p.answers}] ${p.point}`).join('\n')}

Real complaint: ${diagnosis.real_complaint.summary}
Client's worries and what answers them (the client message should settle each one):
${concernLines(diagnosis)}

Write two things:
A) "claims": the formal response to the reviewer, written by ${freelancer.name}. 6-10 claims in a logical order. Factual, calm, specific: dates, amounts, document names. If the strategy includes a refund or a fix, state it. Acknowledge a real weakness rather than hiding it. Every claim needs at least one citation, and every quote must be copied word-for-word from the section text below.
B) "client_message": a message from ${freelancer.name} to ${client.name} that fixes the real problem in plain human language. Do not mention the reason code or the bank's process.

For evidence_package, use these PayPal evidence types where they fit: ${playbook.evidenceTypes.join(', ')}.

Section text you may quote from (each line gives the doc_id and anchor to cite):
${citedText}`;
}

// ---- Stage: repair (only if some citations failed verification) ----------------

const repairSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: { claims: draftSchema.properties.claims },
};

function repairPrompt({ failed, citedText }) {
  return `Some citations in the draft could not be verified against the source documents. Fix each claim below: either correct the quote so it matches the section text EXACTLY, cite a different section that really supports it, or reword the claim so it says only what the evidence supports. Return the corrected claims in the same order.

Claims that failed:
${failed.map((f, i) => `${i + 1}. "${f.text}"\n   problems: ${f.citations.filter((c) => !c.ok).map((c) => c.problem).join('; ') || 'no citations'}`).join('\n')}

Section text:
${citedText}`;
}

module.exports = {
  SYSTEM,
  readSchema,
  readPrompt,
  investigateTools,
  investigatePrompt,
  findingsSchema,
  consolidatePrompt,
  diagnoseSchema,
  diagnosePrompt,
  strategySchema,
  strategyPrompt,
  draftSchema,
  draftPrompt,
  repairSchema,
  repairPrompt,
};

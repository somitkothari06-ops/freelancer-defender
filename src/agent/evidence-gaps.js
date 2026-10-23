// When all we have is a complaint/payment record, do not ask a model to guess
// the client's motive or decide a refund. Ask for the freelancer's records first.
function evidenceRequests(reason) {
  const requests = [
    { question: 'What work and payment terms did you agree to?', why_it_matters: 'We need the agreed scope before assessing whether the work matched it.', documents_needed: ['Contract, proposal or agreed scope'] },
    { question: 'What did you deliver, and what could the client access?', why_it_matters: 'A payment alone does not establish delivery or receipt.', documents_needed: ['Delivery messages, access logs or handover records'] },
  ];
  if (reason === 'UNAUTHORISED') requests.push({ question: 'Who approved the engagement and authorized the payment?', why_it_matters: 'We cannot establish authorization from the disputed payment alone.', documents_needed: ['Approval messages, signed agreement or authorization trail'] });
  else requests.push({ question: 'What did the client approve or report after delivery?', why_it_matters: 'Their messages help distinguish an accepted delivery from a defect or unresolved problem.', documents_needed: ['Approval, revision requests and follow-up messages'] });
  return requests;
}

function hasFreelancerEvidence(locker) {
  return [...locker.docs.values()].some((d) => !['DISPUTE', 'PAYPAL-TXN'].includes(d.id) && d.sections.some((s) => String(s.text || '').trim()));
}

function evidenceOnlyResult(scenario) {
  const summary = 'We have the complaint and payment record, but not enough evidence to determine what happened.';
  return {
    read: { stated_complaint: 'Supporting evidence is needed before assessing this complaint.', literal_claims: [], vague_phrases: [], reviewer_tests: [], open_questions: [] },
    findings: [],
    diagnosis: { client_concerns: [], hypotheses: [], freelancer_weaknesses: [], why_this_reason_code: 'The reason code describes the allegation; it does not establish the underlying cause.',
      real_complaint: { summary, what_the_client_actually_needs: 'Unknown until the agreement, delivery and communication records are reviewed.', confidence: 0 } },
    strategy: { decision: 'REQUEST_MORE_EVIDENCE', rationale: summary, proof_plan: [], resolution_action: 'Add the records below, then run the investigation again.', refund_amount: '0.00', evidence_requests: evidenceRequests(scenario.dispute.reason) },
    draft: { response_title: 'More evidence needed', claims: [], client_message: '', evidence_package: [] },
    removed: [], usage: { prompt: 0, completion: 0, calls: 0 },
  };
}
module.exports = { hasFreelancerEvidence, evidenceRequests, evidenceOnlyResult };

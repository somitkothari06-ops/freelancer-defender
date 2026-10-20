// What each PayPal dispute reason code makes the freelancer prove.
//
// The person deciding the case (PayPal or the client's bank) judges the
// response against the *filed reason*, not against whatever is really bothering the client.
// So the agent has to do two things:
//   1. answer the filed reason on its own terms (this playbook), and
//   2. work out the real complaint and address that too, which is what actually ends disputes.
//
// evidenceTypes are values from PayPal's Disputes API `evidence_type` enum.

const PLAYBOOK = {
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: {
    reviewerTests: [
      'What exactly was the service described as (contract, invoice, scope)?',
      'Did what was delivered match that description?',
      'Did the client accept or approve the work?',
      'Has the client used the work since (signs that it was fit for purpose)?',
    ],
    evidenceTypes: ['COPY_OF_CONTRACT', 'ITEM_DESCRIPTION', 'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED', 'OTHER'],
  },
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: {
    reviewerTests: [
      'Was the service delivered, and when?',
      'Is there proof the client received it or had access to it?',
      'Did the client acknowledge receipt or use it?',
    ],
    evidenceTypes: ['PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED', 'COPY_OF_CONTRACT', 'OTHER'],
  },
  UNAUTHORISED: {
    reviewerTests: [
      'Was the payment made by someone authorized by the account holder?',
      'Is there an agreement between the payer and the freelancer?',
      'Has the same payer paid the freelancer before without disputing it?',
      'Did the account holder benefit from or use what was paid for?',
    ],
    evidenceTypes: ['COPY_OF_CONTRACT', 'BILLING_AGREEMENT', 'PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED', 'OTHER'],
  },
  CREDIT_NOT_PROCESSED: {
    reviewerTests: [
      'Was a refund or credit promised?',
      'If so, was it issued, or is there a reason it is not due?',
    ],
    evidenceTypes: ['PROOF_OF_REFUND', 'CREDIT_DUE_REASON', 'COPY_OF_CONTRACT', 'OTHER'],
  },
  DUPLICATE_TRANSACTION: {
    reviewerTests: ['Are the two charges really for the same thing, or for separate work?'],
    evidenceTypes: ['PROOF_OF_RECEIPT_COPY', 'COPY_OF_CONTRACT', 'OTHER'],
  },
  INCORRECT_AMOUNT: {
    reviewerTests: ['What amount was agreed, and why was this amount charged?'],
    evidenceTypes: ['PRICE_DIFFERENCE_REASON', 'COPY_OF_CONTRACT', 'OTHER'],
  },
};

const FALLBACK = {
  reviewerTests: ['What was agreed?', 'What was delivered?', 'Did the client accept it?'],
  evidenceTypes: ['COPY_OF_CONTRACT', 'OTHER'],
};

module.exports = (reason) => PLAYBOOK[reason] || FALLBACK;

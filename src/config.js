// Central place for every setting the app reads from the environment.
// Values come from the .env file locally, or from Render's "Environment" tab in production.
require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3000,

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    studioModel: process.env.GROQ_STUDIO_MODEL || '',
    baseUrl: 'https://api.groq.com/openai/v1',
  },

  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    env: process.env.PAYPAL_ENV || 'sandbox',
  },

  // Who the freelancer is, for live disputes not linked to a demo scenario. Optional: without
  // these, the seller name on the PayPal dispute is used.
  freelancer: {
    name: process.env.FREELANCER_NAME || '',
    business: process.env.FREELANCER_BUSINESS || '',
    email: process.env.FREELANCER_EMAIL || '',
  },

  // Timelines shown in the dashboard's "asymmetry" clock, with sources (checked Oct 20, 2026).
  timelines: {
    // "Customers can initiate a chargeback within 180 days of the transaction date."
    // https://www.paypal.com/us/cshelp/article/what-is-a-chargeback-and-why-did-i-get-one-help607
    cardholderFilingDays: 180,
    // "...it may take your buyer's card company up to 75 days to resolve a chargeback" (same page)
    bankDecisionDays: 75,
    // Seller's window to answer a chargeback notice. PayPal help text quoted as "you'll have 10 days
    // to answer it"; live disputes use PayPal's real seller_response_due_date instead.
    sellerResponseDays: 10,
    sources: [
      { label: 'PayPal Help: What is a chargeback?', url: 'https://www.paypal.com/us/cshelp/article/what-is-a-chargeback-and-why-did-i-get-one-help607' },
      { label: 'PayPal Help: Evidence for chargebacks', url: 'https://www.paypal.com/us/cshelp/article/evidence-to-provide-for-chargebacks-a-guide-for-sellers-help1103' },
    ],
  },
};

config.paypal.baseUrl =
  config.paypal.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

// PayPal is "on" only if both credentials are present. Without them the app
// still runs, with seeded disputes and simulated submissions (clearly labelled).
config.paypal.enabled = Boolean(config.paypal.clientId && config.paypal.clientSecret);

module.exports = config;

// Central place for every setting the app reads from the environment.
// Values come from the .env file locally, or from Render's "Environment" tab in production.
require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3000,

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    baseUrl: 'https://api.groq.com/openai/v1',
  },

  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    env: process.env.PAYPAL_ENV || 'sandbox',
  },

  // Timelines shown in the dashboard's "asymmetry" clock.
  // TODO(team): confirm these numbers and cite a source before the pitch (see NOTES.md).
  timelines: {
    bankDecisionDays: 90,     // how long the issuing bank can take to decide
    cardholderFilingDays: 120, // how long the client has to file after paying
  },
};

config.paypal.baseUrl =
  config.paypal.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

// PayPal is "on" only if both credentials are present. Without them the app
// still runs, with seeded disputes and simulated submissions (clearly labelled).
config.paypal.enabled = Boolean(config.paypal.clientId && config.paypal.clientSecret);

module.exports = config;

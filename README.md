# The Freelancer Defender

An AI agent that fights on a freelancer's side when a client's bank reverses a payment they already earned.

**The problem:** A freelancer finishes approved work and gets paid. Months later, the client's bank reverses the charge — the freelancer gets only 48 hours to defend themselves, while the bank itself had up to 90 days to decide. The freelancer did nothing wrong but can still lose the money. Existing dispute-defense tools (Chargeflow, Justt) protect businesses, not the person who did the work.

**What this does:** When a dispute comes in, the AI reads the client's stated complaint, reasons out what they're *actually* upset about (which is often different from the official reason on paper), finds the specific evidence that answers that real complaint, and builds a defense submitted through PayPal's Resolution Center process before the clock runs out.

Built for the PayPal AI Hackathon 2026.

## Stack

- Backend: Node.js, orchestrates PayPal API calls + AI reasoning
- AI: Groq API (free tier, GPT-OSS 120B) — agentic reasoning + tool-calling over dispute text + evidence
- Frontend: dashboard showing the countdown clock and the AI's reasoning trail live
- PayPal: Resolution Center / Disputes API (sandbox), Transaction Search API

## Setup

1. `cp .env.example .env` and fill in your own PayPal sandbox credentials and AI API key.
2. `npm install`
3. `npm run dev`

## Status

Early scaffold — see project board / commits for progress.

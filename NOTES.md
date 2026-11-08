# Release status — November 8, 2026

Freelancer Defender is a working hackathon prototype. The public landing page,
personal desk, seeded case review, investigation workbench, source-linked
evidence, private cases, Groq agent, and PayPal sandbox integration are in the
repository. See [README.md](README.md) for setup and product boundaries.

## What a judge can try

- Open the hosted site and review a seeded case without credentials. Seeded
  records are examples, never live PayPal disputes.
- Open the personal desk, inspect exact source sections, save notes and
  follow-ups, and change its theme.
- Use the dispute queue, AG Grid evidence ledger, Bryntum deadline timeline,
  and the scripted AG Studio example. The unscripted AG Studio chat and live
  investigation require available Groq quota.
- Enter a private case and add documents. These are stored on the hosted
  service's persistent disk and scoped to a browser visitor cookie. Running
  live AI analysis sends the supplied documents to Groq. Download a case copy
  for an independent backup.
- Authorized sandbox accounts can read disputes and submit reviewed evidence
  through PayPal. The public sample does not perform PayPal actions.

The server checks that quoted text occurs in its cited source. It does not
prove that an AI interpretation is correct. Old recordings with unsupported
interpretations are archived and cannot be submitted. When a case lacks
freelancer evidence, the app asks for it and produces no submission package.

## Submission status

- Public GitHub repository and visible MIT license: confirmed November 8.
- Hosted Render service: live on `main`; Starter instance with a 1 GB disk.
- Automated tests: 54 passing; `npm audit --omit=dev` reported no known
  vulnerabilities on November 8.
- Selected demo film: the 2:49 emotional cut, kept outside this source repo
  until publication. The original approved cut is separately preserved. The
  selected video still needs a
  rights check, a public YouTube upload, and its URL in Devpost. ElevenLabs
  generated the narration on a free plan; its current terms limit that audio
  to non-commercial use and require attribution on publication. Use a cleared
  voice recording or obtain appropriate permission if this contest use could
  be considered commercial ([ElevenLabs terms](https://elevenlabs.io/terms-of-use)).
- Devpost entry and team membership: **not confirmed submitted**. Use
  [docs/SUBMISSION.md](docs/SUBMISSION.md) and verify the final entry in the
  account before the official deadline.
- Credentials previously shared in chat: rotation status is **not verified**.
  Rotate the exposed PayPal sandbox secret and Groq key, update Render, and
  revoke any exposed Render API key before judging. Never put keys in GitHub.

The official [rules](https://paypalaihackathon.devpost.com/rules) require a
public repository with an open-source license, a functional demo, and a
public YouTube video shorter than three minutes. The listed deadline is
November 12, 2026 at 12:00 pm Pacific.

## Deployment

After a production change, push `main`, explicitly create a Render deploy,
wait for `live`, and check the actual hosted page. Render auto-deploy has been
unreliable in this project. Service ID: `srv-dbbihntg1s2s7393u3dg`.

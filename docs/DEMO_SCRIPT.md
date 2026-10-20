# Demo video script (target 2:40, hard limit 3:00)

**Before you record**
- Open https://freelancer-defender.onrender.com a minute early so the free server is awake.
- Use **Watch a recorded run** in the video. A live run takes several minutes and uses the daily AI allowance.
- Browser full screen, zoom 100%, no other tabs visible. Record with QuickTime (Mac: File → New Screen Recording) or OBS.
- Read the voice-over slowly. No music (the rules forbid copyrighted music; silence is fine).
- Upload to YouTube as **Public** or **Unlisted** (the rules say public, so Public is safest).

---

### 0:00–0:20 · The problem (landing page)
**Show:** the landing page. Let auto mode play one example: "Not as described." sweeps open to "I never got the print files." Then drag the divider yourself once. Scroll to the 180 / 75 / 10 line, then click **Try the demo**.

**Say:** "When a client asks their bank to take back a payment, the bank only hears the complaint: 'not as described'. What the client actually meant is usually somewhere else: in an email, a download log, a Slack message. And the freelancer has ten days to prove it, while the client had a hundred and eighty. This is the Freelancer Defender: an AI agent that reads between the lines and fights for the person who did the work."

### 0:20–0:35 · AG Grid and Bryntum (dispute list)
**Show:** sort the "All disputes" table by Time left, then point at the "What's actually going on" column.

**Say:** "Every dispute comes from PayPal's Disputes API. The table is AG Grid: sort by deadline, and see at a glance what each client filed versus what's actually going on. The timeline is Bryntum: each bar is the time left to respond."

### 0:35–0:55 · Open the hero case
**Show:** click **Halden Coffee Roasters**. Pause on the countdown and card 1.

**Say:** "Priya designed a brand for a coffee roaster. Paid $2,400. Now the bank says 'not as described: what we received can't be used by our vendors.' A normal dispute bot would argue the design matched the brief. That would lose."

### 0:55–1:40 · The agent works it out
**Show:** click **Watch a recorded run**. Let the steps fill in. Point at the evidence dots lighting up on the right. When "Work out what's really wrong" finishes, click its title to open it and show the client's worries.

**Say:** "The agent reads the complaint, then investigates like a dispute specialist: it opens the contract, the emails, the file-download log, and the client's message on Priya's website. It finds that the client never downloaded the second link, the one with the print-quality logo files and the copyright letter. The link expired. Their sign maker can't cut a storefront sign from web images. And they're worried they don't own the logo. Under the contract, ownership only transfers once payment is kept, so winning this chargeback would actually cost them their logo."

### 1:40–2:10 · Verified response
**Show:** the three cards filled in, then scroll to the letter. Click one blue source tag; the side panel shows the exact passage. Close it. Click **Show all sources** to show the AG Grid evidence ledger.

**Say:** "So the plan is: contest the reversal, and fix the real problem by re-sending the files. Every sentence in the response points to an exact quote, and plain code, not AI, checks every quote word for word. Anything it can't back up gets removed. The ledger, also AG Grid, lists every source the response rests on."

### 2:10–2:30 · Send through PayPal
**Show:** click **Send response →**. Open "Show the exact API request" for a second.

**Say:** "One click builds the real PayPal calls: evidence with a generated PDF letter and appendix, and a message to the client. We tested this end to end on a real PayPal sandbox dispute, and PayPal accepted the evidence."

### 2:30–2:45 · Bring your own evidence + close
**Show:** open another case, click **+ Add evidence**, show the form for two seconds.

**Say:** "Any freelancer can add their own contract, emails or logs, and the agent can cite them immediately. The Freelancer Defender: answer the bank, fix the real problem, keep the money you earned."

---

**If you're over time:** shorten the 0:55–1:40 section first. Keep the "it would actually cost them their logo" line; it's the moment that shows real reasoning.

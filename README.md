# twilio-bulk-sms-queue

A rate-limited send queue for bulk Twilio SMS campaigns: paces sends to a
configurable messages/second, retries transient rate-limit errors with
exponential backoff, and **keeps going through individual failures instead
of silently halting the whole campaign** - the exact symptom described in
the client request this was scoped for ("campaign works fine then stops
after ~50 messages").

## Why

A naive `for` loop that calls `client.messages.create()` for every recipient
will eventually hit Twilio's per-second throughput cap, throw, and - unless
the loop has its own try/catch - stop sending to everyone after it. This
queue fixes that by:

- pacing sends (`messagesPerSecond`) so you mostly avoid the rate limit in
  the first place
- retrying only *retryable* errors (HTTP 429 / Twilio error code 20429) with
  exponential backoff
- treating everything else (invalid number, unsubscribed recipient, etc.) as
  a permanent per-recipient failure that's recorded and skipped, not retried
  and not fatal to the rest of the batch
- returning a full per-recipient status log (`sent` / `failed` + attempts +
  error) so you know exactly who did and didn't get the message

## Usage

```js
const { BulkSendQueue } = require("./src/queue");
const { TwilioRestSender } = require("./src/twilioSender");

const sender = new TwilioRestSender({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  from: process.env.TWILIO_FROM_NUMBER,
});

const queue = new BulkSendQueue({ sender, messagesPerSecond: 5, maxRetries: 3 });

const { results, sent, failed } = await queue.sendAll([
  { to: "+19999999999", body: "Your appointment is confirmed." },
  // ...
]);
```

Run `node example.js` for a runnable demo with a fake sender (no Twilio
account needed) that simulates a rate limit kicking in partway through a
batch and a permanently-failing recipient, so you can see the retry/skip
behavior without spending real Twilio credits.

`TwilioRestSender` talks to Twilio's REST API directly via `fetch` + Basic
auth (no `twilio` SDK dependency, zero extra deps) - but `BulkSendQueue`
only depends on the `{ send({ to, body }) => { sid } }` interface, so any
sender (a different SMS provider, a dry-run logger, etc.) drops in just as
easily.

## Test

```
npm test
```

9 tests (Node's built-in test runner, no extra dependencies): pacing
between sends, retry-with-backoff on a rate-limited send, a permanent
failure that doesn't retry and doesn't halt the batch, giving up after
`maxRetries`, and the Twilio sender's retryable/not-retryable
classification (429/20429 vs. invalid-number). Network is stubbed via
dependency injection (`fetchImpl`, `sleepImpl`) so tests run instantly and
don't need a Twilio account.

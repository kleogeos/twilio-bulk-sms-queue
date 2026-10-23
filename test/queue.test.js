const test = require("node:test");
const assert = require("node:assert/strict");
const { BulkSendQueue } = require("../src/queue");

function fakeSleep() {
  const calls = [];
  const impl = async (ms) => {
    calls.push(ms);
  };
  impl.calls = calls;
  return impl;
}

test("sends every recipient and reports sent/failed counts", async () => {
  const sender = {
    send: async ({ to }) => ({ sid: `SM_${to}` }),
  };
  const queue = new BulkSendQueue({ sender, messagesPerSecond: 10, sleepImpl: fakeSleep() });
  const { results, sent, failed } = await queue.sendAll([
    { to: "+1111", body: "hi" },
    { to: "+2222", body: "hi" },
  ]);
  assert.equal(sent, 2);
  assert.equal(failed, 0);
  assert.deepEqual(results.map((r) => r.status), ["sent", "sent"]);
});

test("paces sends according to messagesPerSecond", async () => {
  const sleep = fakeSleep();
  const sender = { send: async ({ to }) => ({ sid: to }) };
  const queue = new BulkSendQueue({ sender, messagesPerSecond: 5, sleepImpl: sleep });
  await queue.sendAll([{ to: "a" }, { to: "b" }, { to: "c" }]);
  // 3 recipients -> 2 inter-message pauses, each 1000/5 = 200ms
  assert.deepEqual(sleep.calls.filter((ms) => ms === 200), [200, 200]);
});

test("retries a rate-limited send with exponential backoff, then succeeds", async () => {
  let attempt = 0;
  const sender = {
    send: async () => {
      attempt++;
      if (attempt < 3) {
        const err = new Error("rate limited");
        err.retryable = true;
        throw err;
      }
      return { sid: "SM_ok" };
    },
  };
  const sleep = fakeSleep();
  const queue = new BulkSendQueue({ sender, messagesPerSecond: 10, baseBackoffMs: 100, sleepImpl: sleep });
  const result = await queue.sendOne({ to: "+1111", body: "hi" });
  assert.equal(result.status, "sent");
  assert.equal(result.attempts, 3);
  // backoff after attempt 1 (100ms) and attempt 2 (200ms)
  assert.deepEqual(sleep.calls, [100, 200]);
});

test("a permanent (non-retryable) failure does not retry and does not halt the rest of the campaign", async () => {
  const sender = {
    send: async ({ to }) => {
      if (to === "+bad") {
        const err = new Error("invalid number");
        err.retryable = false;
        throw err;
      }
      return { sid: `SM_${to}` };
    },
  };
  const queue = new BulkSendQueue({ sender, messagesPerSecond: 10, sleepImpl: fakeSleep() });
  const { results, sent, failed } = await queue.sendAll([
    { to: "+good1", body: "hi" },
    { to: "+bad", body: "hi" },
    { to: "+good2", body: "hi" },
  ]);
  assert.equal(sent, 2);
  assert.equal(failed, 1);
  const bad = results.find((r) => r.to === "+bad");
  assert.equal(bad.status, "failed");
  assert.equal(bad.attempts, 1); // no retries burned on a permanent error
  assert.equal(bad.error, "invalid number");
});

test("gives up after maxRetries on a persistently rate-limited recipient", async () => {
  const sender = {
    send: async () => {
      const err = new Error("rate limited");
      err.retryable = true;
      throw err;
    },
  };
  const queue = new BulkSendQueue({ sender, messagesPerSecond: 10, maxRetries: 2, sleepImpl: fakeSleep() });
  const result = await queue.sendOne({ to: "+1111", body: "hi" });
  assert.equal(result.status, "failed");
  assert.equal(result.attempts, 3); // 1 initial + 2 retries
});

test("rejects construction without a sender", () => {
  assert.throws(() => new BulkSendQueue({}), /requires a sender/);
});

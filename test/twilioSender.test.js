const test = require("node:test");
const assert = require("node:assert/strict");
const { TwilioRestSender } = require("../src/twilioSender");

function fakeFetch({ status = 201, body = { sid: "SM123" } } = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: status < 400, status, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

test("sends a message via Twilio's REST API with Basic auth and form-encoded body", async () => {
  const fetchImpl = fakeFetch();
  const sender = new TwilioRestSender({ accountSid: "ACxxx", authToken: "secret", from: "+10000000000", fetchImpl });
  const result = await sender.send({ to: "+19999999999", body: "hello" });
  assert.equal(result.sid, "SM123");

  const call = fetchImpl.calls[0];
  assert.equal(call.url, "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json");
  assert.equal(call.opts.method, "POST");
  assert.match(call.opts.headers.Authorization, /^Basic /);
  assert.match(call.opts.body, /To=%2B19999999999/);
});

test("marks a 429 response as retryable", async () => {
  const fetchImpl = fakeFetch({ status: 429, body: { message: "Too Many Requests", code: 20429 } });
  const sender = new TwilioRestSender({ accountSid: "ACxxx", authToken: "secret", from: "+1", fetchImpl });
  await assert.rejects(
    () => sender.send({ to: "+2", body: "hi" }),
    (err) => err.retryable === true
  );
});

test("marks an invalid-number response as not retryable", async () => {
  const fetchImpl = fakeFetch({ status: 400, body: { message: "Invalid 'To' Phone Number", code: 21211 } });
  const sender = new TwilioRestSender({ accountSid: "ACxxx", authToken: "secret", from: "+1", fetchImpl });
  await assert.rejects(
    () => sender.send({ to: "+2", body: "hi" }),
    (err) => err.retryable === false
  );
});

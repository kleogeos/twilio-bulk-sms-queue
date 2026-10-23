// Demo run with a fake sender (no Twilio account needed) so this is runnable out of the box.
// Swap FakeSender for `new TwilioRestSender({ accountSid, authToken, from })` from
// src/twilioSender.js to hit the real Twilio API.
const { BulkSendQueue } = require("./src/queue");

class FakeSender {
  constructor() {
    this.sent = 0;
  }
  async send({ to }) {
    this.sent++;
    // Simulate Twilio's rate limit kicking in after the 3rd message, like the client
    // described: a send loop that works for a while then silently stops past ~50 messages.
    if (this.sent > 0 && this.sent % 3 === 0) {
      const err = new Error("rate limited");
      err.retryable = true;
      throw err;
    }
    if (to === "+10000000404") {
      const err = new Error("unsubscribed recipient");
      err.retryable = false;
      throw err;
    }
    return { sid: `SM${this.sent}` };
  }
}

async function main() {
  const recipients = Array.from({ length: 8 }, (_, i) => ({
    to: i === 5 ? "+10000000404" : `+1000000${String(i).padStart(4, "0")}`,
    body: "Your appointment is confirmed.",
  }));

  const queue = new BulkSendQueue({ sender: new FakeSender(), messagesPerSecond: 5, maxRetries: 3 });
  const { results, sent, failed } = await queue.sendAll(recipients);

  console.log(`sent ${sent}/${recipients.length}, failed ${failed}`);
  for (const r of results) {
    console.log(r);
  }
}

main();

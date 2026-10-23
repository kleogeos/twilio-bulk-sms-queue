const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Errors the sender throws can mark themselves retryable (rate limit / transient network
// issues) vs. not (bad phone number, unsubscribed recipient, etc). Anything not explicitly
// retryable is treated as permanent so we don't burn retry budget retrying a message that
// will never go through.
function isRetryable(err) {
  return err && err.retryable === true;
}

class BulkSendQueue {
  constructor({ sender, messagesPerSecond = 1, maxRetries = 3, baseBackoffMs = 200, sleepImpl = defaultSleep }) {
    if (!sender || typeof sender.send !== "function") {
      throw new Error("BulkSendQueue requires a sender with a send({ to, body }) method");
    }
    this.sender = sender;
    this.intervalMs = 1000 / messagesPerSecond;
    this.maxRetries = maxRetries;
    this.baseBackoffMs = baseBackoffMs;
    this.sleep = sleepImpl;
  }

  async sendOne(recipient) {
    let attempts = 0;
    let lastError;

    while (attempts <= this.maxRetries) {
      attempts++;
      try {
        const result = await this.sender.send(recipient);
        return { to: recipient.to, status: "sent", sid: result.sid, attempts };
      } catch (err) {
        lastError = err;
        if (!isRetryable(err) || attempts > this.maxRetries) {
          break;
        }
        // exponential backoff: baseBackoffMs * 2^(attempt-1)
        await this.sleep(this.baseBackoffMs * 2 ** (attempts - 1));
      }
    }

    return {
      to: recipient.to,
      status: "failed",
      error: lastError ? lastError.message : "unknown error",
      attempts,
    };
  }

  // Processes the whole list sequentially, pacing sends to respect messagesPerSecond and
  // continuing through individual failures instead of halting the campaign.
  async sendAll(recipients) {
    const results = [];
    for (let i = 0; i < recipients.length; i++) {
      if (i > 0) await this.sleep(this.intervalMs);
      results.push(await this.sendOne(recipients[i]));
    }

    const sent = results.filter((r) => r.status === "sent").length;
    return { results, sent, failed: results.length - sent };
  }
}

module.exports = { BulkSendQueue, isRetryable };

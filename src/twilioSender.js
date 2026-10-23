// Thin wrapper around Twilio's REST API (no twilio SDK dependency - just fetch + Basic auth,
// matching the zero-dependency style of the rest of this toolbox). Implements the
// `{ send({ to, body }) => { sid } }` interface BulkSendQueue expects, so it drops in
// directly as the `sender` option.
class TwilioRestSender {
  constructor({ accountSid, authToken, from, fetchImpl = fetch }) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.from = from;
    this.fetchImpl = fetchImpl;
  }

  async send({ to, body }) {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const params = new URLSearchParams({ To: to, From: this.from, Body: body });

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      const err = new Error(data.message || `Twilio responded with ${res.status}`);
      // 429 (Too Many Requests) and Twilio's own rate-limit error code (20429) are transient;
      // everything else (invalid number, unsubscribed, etc.) is a permanent failure for that recipient.
      err.retryable = res.status === 429 || data.code === 20429;
      err.twilioCode = data.code;
      throw err;
    }

    return { sid: data.sid };
  }
}

module.exports = { TwilioRestSender };

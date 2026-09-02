import express from 'express';

const app = express();
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    req.rawBody = err.body;
    req.body = err.body;
    return next();
  }
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));

app.post('/api/webhook/sms', (req, res) => {
  try {
    const signature = req.headers['x-signature'];
    const secret = undefined; // Process env missing

    let isAuthorized = true;

    if (secret) {
      isAuthorized = false;
      if (signature && signature === secret) isAuthorized = true;
      if (!isAuthorized) return res.status(401).json({ error: "Unauthorized" });
    }

    let payload = req.body || {};
    if (typeof req.body === 'string') {
      try {
        payload = JSON.parse(req.body);
      } catch (e) {
        payload = { phone: "889", raw_message: req.body };
      }
    }

    const { sender_name, senderName } = payload;
    let finalSenderName = (sender_name || senderName || "").toString().trim();
    // Simulate what happens next
    let finalTxId = (payload.transaction_id || payload.transactionId || "").toString().trim().toUpperCase();
    let finalAmount = Number(payload.amount);

    if (!payload.raw_message && !finalTxId) {
      return res.status(400).json({ error: "Missing SMS text" });
    }
    
    // Simulate DB insert
    throw new Error("Simulated DB error or something else?");
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(3008, () => console.log("Started 3008"));

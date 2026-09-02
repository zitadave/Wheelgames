import express from 'express';

const app = express();
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    req.rawBody = err.body;
    req.body = err.body;
    return next();
  }
  next(err);
});
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));

// Simulate webhook logic
app.post('/api/webhook/sms', (req, res) => {
  let payload = req.body || {};
  if (typeof req.body === 'string') {
    try {
      payload = JSON.parse(req.body);
    } catch (e) {
      const phoneMatch = req.body.match(/PHONE:\s*(.*?)\r?\n/i);
      const textMatch = req.body.match(/TEXT:\s*([\s\S]*)/i);
      const brokenJsonPhone = req.body.match(/"sender_phone"\s*:\s*"([^"]*)"/i);
      const brokenJsonRaw = req.body.match(/"raw_message"\s*:\s*"([\s\S]*?)"\s*}/i);
      if (phoneMatch && textMatch) {
        payload = { phone: phoneMatch[1].trim(), raw_message: textMatch[1].trim() };
      } else if (brokenJsonPhone && brokenJsonRaw) {
        payload = { phone: brokenJsonPhone[1].trim(), raw_message: brokenJsonRaw[1].trim() };
      } else {
        const match = req.body.match(/\b(889|127|CBE)\b/i);
        const maybePhone = match ? match[1] : "";
        payload = { phone: maybePhone, raw_message: req.body.trim() };
      }
    }
  }

  const { sender_name, senderName } = payload;
  let finalSenderName = (sender_name || senderName || "").toString().trim();
  res.json({ success: true });
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(3005, () => {
  console.log("Started");
});

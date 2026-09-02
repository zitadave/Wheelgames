import express from 'express';
import crypto from 'crypto';

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
    let payload = req.body || {};
    if (typeof req.body === 'string') {
      try {
        payload = JSON.parse(req.body);
      } catch (e) {
        const brokenJsonPhone = req.body.match(/"sender_phone"\s*:\s*"([^"]*)"/i);
        const brokenJsonRaw = req.body.match(/"raw_message"\s*:\s*"([\s\S]*?)"\s*}/i);
        if (brokenJsonPhone && brokenJsonRaw) {
          payload = { phone: brokenJsonPhone[1].trim(), raw_message: brokenJsonRaw[1].trim() };
        } else {
          payload = { raw_message: req.body };
        }
      }
    }
    res.json({ payload });
  } catch (e) {
    console.error("Caught inside:", e);
    res.status(500).json({ error: e.message });
  }
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(3006, () => console.log("Started 3006"));

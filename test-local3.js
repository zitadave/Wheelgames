import express from 'express';
import crypto from 'crypto';

const app = express();

const secret = "Dave@5520@Dave";

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
    let isAuthorized = false;

    if (signature && signature === secret) {
      isAuthorized = true;
    }

    if (!isAuthorized && signature) {
      try {
        const bodyStr = req.rawBody || JSON.stringify(req.body);
        const hmac = crypto.createHmac('sha256', secret);
        const digest = hmac.update(bodyStr).digest('hex');
        if (signature.toLowerCase() === digest.toLowerCase()) {
          isAuthorized = true;
        }
      } catch (err) {
        console.error("HMAC Verification Error:", err);
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("Caught inside:", e);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(3007, () => console.log("Started 3007"));

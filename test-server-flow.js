import express from 'express';
import fetch from 'node-fetch';
const app = express();

app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    req.rawBody = err.body;
    req.body = err.body;
    return next();
  }
  next(err);
});
app.use(express.urlencoded({ extended: true }));

app.post('/webhook', (req, res) => {
    let payload = req.body || {};
    if (typeof req.body === 'string') {
      try {
        payload = JSON.parse(req.body);
      } catch (e) {
        const brokenJsonPhone = req.body.match(/"sender_phone"\s*:\s*"([^"]*)"/i);
        const brokenJsonRaw = req.body.match(/"raw_message"\s*:\s*"([\s\S]*?)"\s*}/i);
        
        if (brokenJsonPhone && brokenJsonRaw) {
          payload = { phone: brokenJsonPhone[1].trim(), raw_message: brokenJsonRaw[1].trim() };
        }
      }
    }
    res.json(payload);
});

const server = app.listen(3003, async () => {
  const bodyStr = `{
    "transaction_id": "",
    "amount": "",
    "sender_name": "",
    "sender_phone": "889",
    "raw_message": "Dear Dawit Tamiru Asefaw
You have received ETB 22.00 from account 1********7583"
  }`;
  
  const r = await fetch('http://localhost:3003/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr
  });
  console.log("Status:", r.status);
  console.log("Response:", await r.json());
  server.close();
});

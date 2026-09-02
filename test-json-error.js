import express from 'express';
import fetch from 'node-fetch';
const app = express();

app.use(express.json());
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.log("Caught JSON syntax error, saving raw body...");
    req.body = err.body; // the raw string body!
    req.isInvalidJson = true;
    return next();
  }
  next();
});

app.post('/webhook', (req, res) => {
  console.log("Webhook body:", req.body);
  res.send('ok');
});

const server = app.listen(3002, async () => {
  const r = await fetch('http://localhost:3002/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"invalid": "json\nnewlines"}'
  });
  console.log("Status:", r.status);
  server.close();
});

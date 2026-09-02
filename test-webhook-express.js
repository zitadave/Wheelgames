import express from 'express';
const app = express();

app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: 'text/plain' }));

app.post('/webhook', (req, res) => {
  console.log("Headers:", req.headers['content-type']);
  console.log("Body typeof:", typeof req.body);
  console.log("Body:", req.body);
  res.send('ok');
});

const server = app.listen(3001, async () => {
  console.log("--- text/plain ---");
  await fetch('http://localhost:3001/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: "PHONE:889\nTEXT:Dear Dawit Tamiru Asefaw"
  });
  
  console.log("\n--- application/json (invalid json) ---");
  await fetch('http://localhost:3001/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: "PHONE:889\nTEXT:Dear Dawit Tamiru Asefaw"
  });
  
  console.log("\n--- no content type ---");
  await fetch('http://localhost:3001/webhook', {
    method: 'POST',
    body: "PHONE:889\nTEXT:Dear Dawit Tamiru Asefaw"
  });

  server.close();
});

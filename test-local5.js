import express from 'express';
import { parseBankSMS, extractSenderName } from './src/server/smsParser.js';

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

app.post('/api/webhook/sms', async (req, res) => {
  try {
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
    let finalTxId = (payload.transaction_id || payload.transactionId || "").toString().trim().toUpperCase();
    let finalAmount = Number(payload.amount);
    let isFullyParsed = !!(finalTxId && !isNaN(finalAmount) && finalAmount > 0);
    const smsText = payload.raw_message || "";
    
    if (!isFullyParsed) {
        const parsed = parseBankSMS(smsText, "889");
        if (parsed) {
            finalTxId = parsed.transactionId.trim().toUpperCase();
            finalAmount = parsed.amount;
            isFullyParsed = true;
        }
    }
    
    if (isFullyParsed && finalTxId) {
        if (!finalSenderName && smsText) {
          const parsedName = extractSenderName(smsText);
          if (parsedName) finalSenderName = parsedName;
        }
        console.log(`Parsed Name: ${finalSenderName}, TxId: ${finalTxId}`);
    }

    res.json({ success: true, name: finalSenderName });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const server = app.listen(3011, () => console.log("Started 3011"));

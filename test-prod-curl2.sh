export SMS_WEBHOOK_SECRET=Dave@5520@Dave
node dist/server.cjs &
PID=$!
sleep 5
curl -X POST http://localhost:3000/api/webhook/sms \
-H "Content-Type: application/json" \
-H "x-signature: Dave@5520@Dave" \
-d '{
  "transaction_id": "",
  "amount": "",
  "sender_name": "",
  "sender_phone": "889",
  "raw_message": "Dear Dawit Tamiru Asefaw\nYou have received ETB 22.00 from account 1********7583 (Tsion Mekonnen Getachew) to your account 1********2938.\nYour current balance is ETB244.61.\nThanks for Banking with CBE.\nhttps://mbreciept.cbe.com.et/v2-hfHCxGJZQb1AlrSrr3Th"
}'
sleep 1
kill $PID

# Telegram User Registration Flow (Contact Sharing)

This document outlines the exact mechanism implemented in the bot to fetch and process a user's Telegram ID, username, and phone number when they click the "Share Contact" button during their first-time registration.

## 1. Requesting the Contact
When an unregistered user interacts with the bot, the system prompts them to register by sharing their contact. This is achieved using Telegram's custom Reply Keyboard with the `request_contact` flag set to `true`.

```typescript
const contactPrompt = `📱 <b>Registration Required / ምዝገባ ያስፈልጋል</b>\n\n` +
  `To ensure a secure environment, protect your funds, and prevent bots, please share your contact details below to finalize your registration.\n\n` +
  `ደህንነቱ የተጠበቀ የጨዋታ ሁኔታ ለመፍጠር እና ቦቶችን ለመከላከል እባክዎ ከታች ያለውን <b>"📱 Share Contact / ስልክ ቁጥር ያጋሩ"</b> የሚለውን ቁልፍ ተጭነው ስልክ ቁጥርዎን ያጋሩ።`;

await bot.sendMessage(chatId, contactPrompt, {
    parse_mode: "HTML",
    reply_markup: {
        keyboard: [
            [{ text: "📱 Share Contact / ስልክ ቁጥር ያጋሩ", request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
});
```

## 2. Handling the Contact Event
The bot listens for incoming messages of type `contact`. When the user clicks the "Share Contact" button, Telegram automatically sends a contact message containing the user's phone number and Telegram user ID.

```typescript
bot.on("contact", async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from?.id.toString();
    const contact = msg.contact;

    if (!userId || !contact) return;
    
    // ... processing logic
});
```

## 3. Validating the Contact
To prevent users from forwarding someone else's contact to register, the system validates that the `user_id` inside the shared contact object matches the `id` of the sender (`msg.from.id`).

```typescript
if (contact.user_id && contact.user_id.toString() !== userId) {
    return bot.sendMessage(chatId, "⚠️ <b>Validation Error:</b> Please share your own contact to register.", { parse_mode: "HTML" });
}
```

## 4. Extracting User Data
Once validated, the bot extracts the necessary user details from the `msg.from` object and the `msg.contact` object. It also attempts to fetch the user's profile photo.

```typescript
const username = msg.from?.username || "";
const firstName = msg.from?.first_name || "";
const lastName = msg.from?.last_name || "";
const phoneNumber = contact.phone_number;

let photoUrl = "";
// Fetch user's profile photo from Telegram API
const photosRes = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
if (photosRes && photosRes.total_count > 0 && photosRes.photos.length > 0) {
    const fileId = photosRes.photos[0][0].file_id;
    const file = await bot.getFile(fileId);
    if (file && file.file_path) {
        photoUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    }
}
```

## 5. Saving to the Database
The extracted information is structured and sent to the Supabase database using an `upsert` operation. The system includes a fallback mechanism in case the `phone` column hasn't been added to the database schema yet.

```typescript
const upsertData: any = {
    id: userId,
    username: username || null,
    first_name: firstName || null,
    last_name: lastName || null,
    phone: phoneNumber || null,
    photo_url: photoUrl || null,
    balance: 0 // Starting balance
};

let { data: insertedUser, error: insertError } = await supabase
    .from('users')
    .upsert(upsertData, { onConflict: 'id' })
    .select()
    .single();

// Fallback if the 'phone' column doesn't exist in the database yet
if (insertError && (insertError.message.includes("phone") || insertError.message.includes("schema cache"))) {
    delete upsertData.phone;
    const retryRes = await supabase
        .from('users')
        .upsert(upsertData, { onConflict: 'id' })
        .select()
        .single();
    insertedUser = retryRes.data;
    insertError = retryRes.error;
}
```

## 6. Success Confirmation
If the database insertion is successful, the bot replies to the user, confirming the verification and simultaneously removing the custom "Share Contact" keyboard.

```typescript
await bot.sendMessage(chatId, "✅ <b>Contact verified successfully!</b>", {
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true } // Removes the contact button
});
```

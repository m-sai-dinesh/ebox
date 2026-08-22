# Setup Instructions for AI Sales Agent

Welcome to the setup guide for the Autonomous AI Sales System. This document explains how to configure the critical environment variables in your `.env` file to get the system running correctly.

## 1. Twilio Credentials

To make and receive phone calls, the system uses Twilio. You will need to fill in the following variables in your `.env` file:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` (Your active Twilio phone number)

### Where to find them:
1. Log in to your Twilio account at the [Twilio Console](https://console.twilio.com/).
2. On the main dashboard (Console Info section), you will immediately see your **Account SID** and **Auth Token**.
3. Under **Phone Numbers** -> **Active Numbers**, you will find your `TWILIO_PHONE_NUMBER`. Make sure to include the country code (e.g., `+1234567890`).

---

## 2. WhatsApp Configuration Numbers

The system uses two distinct phone numbers to manage WhatsApp lead notifications and follow-ups. It is crucial to understand the difference between them:

### `TARGET_WHATSAPP_NUMBER`
* **What it is:** This is the destination number where the AI sends all its notifications. 
* **What it does:** Think of this as the "Business Owner's Dashboard". When the AI detects a "HOT" lead mid-call, or when it generates a summary after the call ends, it sends the WhatsApp message to **this** number. 
* **Format:** Must include the country code (e.g., `+919876543210`).

### `MY_PHONE_NUMBER`
* **What it is:** This is just a text variable that gets injected into the bottom of the final summary message.
* **What it does:** When the AI sends the post-call summary to the `TARGET_WHATSAPP_NUMBER`, it signs off the message by providing a callback number. It literally prints: *"My Mobile Number: [MY_PHONE_NUMBER]"* at the bottom of the WhatsApp message.
* **Format:** Formatted exactly as you want the person reading the text to see it (e.g., `+91 9704 951 643`).

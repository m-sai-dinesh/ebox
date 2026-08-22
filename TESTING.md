# Testing Strategy (TESTING.md)

This document outlines the testing approach for the Autonomous AI Sales System.

## 1. Manual Testing Workflow

The application relies on a manual testing workflow to verify business logic, LLM intent parsing, and third-party integrations.

### How to Test
1. Start the development server (`node server.js`).
2. Ensure your local tunnel (Ngrok) is active and your Twilio webhook is configured correctly.
3. Open the frontend (`http://localhost:3000`) or use an API client to send a `POST` request to `/start-call` with a valid phone number.
4. Answer the inbound Twilio call and interact naturally with the AI.

### Verification Steps
During the manual test, verify the following critical flows:
* **Audio Quality:** Ensure the Sarvam TTS/ASR stream is clear and without heavy latency.
* **Intent Classification:** Speak vaguely and ensure the AI accurately classifies the interaction as HOT, WARM, or COLD.
* **Mid-Call Action:** If simulating a HOT lead, verify that the WhatsApp message (`TARGET_WHATSAPP_NUMBER`) is received *before* the call disconnects.
* **Callback Scheduling:** If simulating a WARM lead, verify that `./callbacks.json` is successfully updated with the correct timestamp and barrier.
* **Post-Call Summary:** After hanging up, verify that the final WhatsApp message contains the accurately summarized transcript, your phone number, and the specified URLs.

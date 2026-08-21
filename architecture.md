# AI-Automated Recruiter Agent: System Architecture & Data Flow

## System Architecture Components

The AI-Automated Recruiter Agent is a real-time conversational voice bot designed to conduct screening calls and perform mid-call and post-call automated actions. The architecture is composed of the following core technologies:

- **Backend (Node.js / Express):** Acts as the central orchestrator. It serves the frontend UI, exposes REST endpoints for call initiation, and manages the real-time WebSocket bidirectional data streams for audio and LLM coordination.
- **Tunneling (Ngrok):** Exposes the local Node.js environment (port 3000) to the public internet securely, allowing Twilio webhooks to reach the local server.
- **Telephony & Messaging (Twilio):** 
  - *Programmable Voice:* Handles outbound PSTN dialing and establishes a WebSocket media stream to the backend when the call connects.
  - *WhatsApp Sandbox:* Executes automated messaging both mid-call (e.g., triggered by high-intent) and post-call (summaries and deliverables).
- **Speech Services (Sarvam AI):** 
  - *Speech-to-Text (STT):* Transcribes the incoming audio stream from the user into text.
  - *Text-to-Speech (TTS):* Synthesizes the generated LLM text responses back into audio buffers to be streamed to Twilio.
- **LLM & Logic (Google Gemini 1.5-flash):** The core intelligence of the agent. It manages the conversational context, strictly adheres to the system prompt (including language code-switching), and natively supports function calling to trigger external tools (like WhatsApp messages and callback scheduling) asynchronously based on the user's intent.

## Real-Time Data Flow

```mermaid
sequenceDiagram
    participant UI as Frontend UI
    participant Node as Node.js Backend
    participant Twilio as Twilio Voice/WhatsApp
    participant User as Target User (Phone)
    participant SarvamSTT as Sarvam AI (STT)
    participant Gemini as Gemini 1.5-flash
    participant SarvamTTS as Sarvam AI (TTS)

    UI->>Node: POST /start-call
    Node->>Twilio: API Call: Create Outbound Call
    Twilio->>User: Dials Target Phone Number
    User-->>Twilio: Answers Call
    Twilio->>Node: Establishes WebSockets Media Stream via Ngrok
    
    loop Real-Time Conversation
        User->>Twilio: Speaks
        Twilio->>Node: Streams Audio (WebSockets)
        Node->>SarvamSTT: Routes Audio for Transcription
        SarvamSTT-->>Node: Returns Transcribed Text
        
        Node->>Gemini: Sends Text + Conversation History
        Gemini-->>Gemini: Processes Logic & Intent
        
        opt High Intent Detected (Function Call)
            Gemini-->>Node: Triggers send_whatsapp_message tool
            Node->>Twilio: API Call: Send WhatsApp Message
            Twilio->>User: Delivers WhatsApp Message
            Node->>Gemini: Returns Tool Execution Success
        end
        
        Gemini-->>Node: Returns Conversational Text Response
        Node->>SarvamTTS: Sends Text for Synthesis
        SarvamTTS-->>Node: Returns Audio Buffer
        Node->>Twilio: Streams Audio Buffer (WebSockets)
        Twilio->>User: Hears AI Speak
    end
    
    User->>Twilio: Hangs up (Call Ends)
    Twilio->>Node: WebSockets Close / Stop Event
    Node->>Gemini: Generates Final Call Summary
    Gemini-->>Node: Returns Summary Text
    Node->>Twilio: API Call: Send Post-Call WhatsApp
    Twilio->>User: Delivers Post-Call Summary & Assets
```

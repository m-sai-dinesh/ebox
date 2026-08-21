require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const PORT = process.env.PORT || 3000;

// Initialize Twilio client globally to reuse for WhatsApp API
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_KEY');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// POST /start-call
app.post('/start-call', async (req, res) => {
    let to = req.body.to || req.body.phoneNumber;
    if (!to) {
        return res.status(400).json({ error: 'Missing "to" phone number.' });
    }

    // FIX 1: E.164 Phone Number Sanitization
    to = to.replace(/[\s\-()]/g, '');
    if (!to.startsWith('+')) {
        to = '+91' + to;
    }

    try {
        const ngrokUrl = process.env.NGROK_URL || 'https://YOUR_NGROK_URL';
        
        const call = await twilioClient.calls.create({
            to: to,
            from: process.env.TWILIO_PHONE_NUMBER,
            url: `${ngrokUrl}/twiml`
        });

        console.log(`Call initiated to ${to}. Call SID: ${call.sid}`);
        return res.status(200).json({ success: true, callSid: call.sid });
    } catch (error) {
        console.error('Error initiating call:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// POST /twiml - Generates TwiML for the call
app.post('/twiml', (req, res) => {
    const ngrokUrl = process.env.NGROK_URL || 'https://YOUR_NGROK_URL';
    const wssUrl = ngrokUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    
    const twiml = `
<Response>
  <Connect>
    <Stream url="${wssUrl}/ws" />
  </Connect>
</Response>
    `.trim();

    res.type('text/xml');
    res.send(twiml);
});

// System Prompt for LLM Agent
const currentDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

const SYSTEM_PROMPT = `You are an expert sales engineer pitching e-commerce website development. Current Date/Time: ${currentDate}.
Speak naturally, keep responses concise, and seamlessly handle code-switching between Telugu, Hindi, and English based on the user's language. 
Your goal is to discover 4 things naturally (not as a checklist): budget, products sold, timeline, and required features.
Analyze intent silently and trigger tools mid-call:
HOT: Asking for price/timeline. Trigger send_hot_lead_whatsapp immediately.
WARM: Interested but has a barrier (budget/timing). Capture the barrier and trigger book_callback with a specific ISO datetime.
COLD: Just looking; curious with no clear need. Trigger send_cold_brochure mid-call.
CRITICAL: You MUST prefix every response with a language tag so our TTS engine knows the dialect: [en-IN], [hi-IN], or [te-IN]. Example: "[en-IN] Hello! How can I help?"`;

// Define Tools for LLM Function Calling (Gemini Format)
const geminiTools = [{
    functionDeclarations: [
        {
            name: "send_hot_lead_whatsapp",
            description: "Send a WhatsApp to HOT leads.",
            parameters: {
                type: "OBJECT",
                properties: {
                    budget: { type: "STRING" },
                    products: { type: "STRING", description: "What they sell and volume" },
                    timeline: { type: "STRING" },
                    features: { type: "STRING" }
                },
                required: ["budget", "products", "timeline", "features"]
            }
        },
        {
            name: "book_callback",
            description: "Book a callback for WARM leads.",
            parameters: {
                type: "OBJECT",
                properties: {
                    callback_time: { type: "STRING", description: "Exact date and time in ISO 8601 format" },
                    barrier: { type: "STRING" }
                },
                required: ["callback_time", "barrier"]
            }
        },
        {
            name: "send_cold_brochure",
            description: "Send a brochure to COLD leads who are just browsing.",
            parameters: { type: "OBJECT", properties: {} }
        }
    ]
}];

// Async function to trigger WhatsApp without blocking the event loop
function sendWhatsAppAsync(args) {
    const { budget, products, timeline, features } = args;
    const body = `Hi there! It was great speaking with you. Here is a summary of your e-commerce needs:\n\n*Budget:* ${budget}\n*Products:* ${products}\n*Timeline:* ${timeline}\n*Features:* ${features}\n\nOur team will be in touch shortly!`;
    
    twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
        to: process.env.TARGET_WHATSAPP_NUMBER || 'whatsapp:+918688664337',
        body: body
    }).then(msg => console.log(`[WhatsApp] Sent successfully! SID: ${msg.sid}`))
      .catch(err => console.error(`[WhatsApp] Error sending message:`, err));
}

function sendColdBrochureAsync() {
    twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
        to: process.env.TARGET_WHATSAPP_NUMBER || 'whatsapp:+918688664337',
        body: "Thanks for your interest! Here is our brochure to learn more about our e-commerce solutions."
    }).then(msg => console.log(`[WhatsApp] Brochure sent! SID: ${msg.sid}`))
      .catch(err => console.error(`[WhatsApp] Error sending message:`, err));
}

// Async function to trigger the final post-call WhatsApp summary
async function send_post_call_whatsapp(conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) return;

    console.log('[Post-Call] Generating post-call summary and WhatsApp message...');
    const url = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions';
    const apiKey = process.env.LLM_API_KEY || 'YOUR_LLM_KEY';
    const model = process.env.LLM_MODEL || 'gpt-4o';

    try {
        // Query the LLM to summarize the context in a natural conversational tone
        const summaryModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: { role: "system", parts: [{ text: 'You are an assistant summarizing a sales call. Extract the products discussed, budget, timeline, and key features. Write a plain, human conversational summary addressed to the customer outlining what was discussed. Keep it professional but warm.' }] }
        });

        const result = await summaryModel.generateContent({ contents: conversationHistory });
        let summary = result.response.text();
        if (!summary) {
            summary = "Thank you for taking the time to speak with me about your e-commerce website requirements!";
        }

        const myPhoneNumber = process.env.MY_PHONE_NUMBER || '+91XXXXXXXXXX';
        const resumeUrl = process.env.RESUME_URL || 'https://your-hosted-resume-link.pdf';
        
        const body = `${summary}\n\nFeel free to contact me directly at: ${myPhoneNumber}\nView my resume here: ${resumeUrl}`;

        const messageOptions = {
            from: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
            to: process.env.TARGET_WHATSAPP_NUMBER || 'whatsapp:+918688664337',
            body: body
        };

        if (process.env.DIAGRAM_IMAGE_URL && process.env.DIAGRAM_IMAGE_URL.startsWith('http')) {
            messageOptions.mediaUrl = [process.env.DIAGRAM_IMAGE_URL];
        }

        twilioClient.messages.create(messageOptions)
            .then(msg => console.log(`[Post-Call WhatsApp] Final summary sent! SID: ${msg.sid}`))
            .catch(err => console.error(`[Post-Call WhatsApp] Error sending summary message:`, err));

    } catch (error) {
        console.error('Error generating post-call summary:', error);
    }
}

async function callLLM(conversationHistory) {
    const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash",
        systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        tools: geminiTools
    });

    try {
        const response = await model.generateContent({ contents: conversationHistory });
        const result = response.response;

        const functionCalls = result.functionCalls();
        if (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            const name = call.name;
            const args = call.args;
            
            // Push the model's function call to history
            if (result.candidates && result.candidates[0] && result.candidates[0].content) {
                conversationHistory.push(result.candidates[0].content);
            }

            if (name === 'send_hot_lead_whatsapp') {
                console.log('HOT LEAD DETECTED! Executing send_hot_lead_whatsapp tool with args:', args);
                
                // Fire async WhatsApp message (non-blocking)
                sendWhatsAppAsync(args);

                conversationHistory.push({ 
                    role: "user", 
                    parts: [{ functionResponse: { name: name, response: { status: "success", info: "WhatsApp sent successfully. Acknowledge this briefly to the user and wrap up." } } }] 
                });

                return await callLLM(conversationHistory);
            } else if (name === 'book_callback') {
                console.log('WARM LEAD DETECTED! Booking callback with args:', args);

                conversationHistory.push({ 
                    role: "user", 
                    parts: [{ functionResponse: { name: name, response: { status: "success", info: `Callback booked for ${args.callback_time}. Acknowledge this politely to the caller and conclude the call.` } } }] 
                });

                return await callLLM(conversationHistory);
            } else if (name === 'send_cold_brochure') {
                console.log('COLD LEAD DETECTED! Sending brochure...');
                
                // Fire async WhatsApp brochure (non-blocking)
                sendColdBrochureAsync();

                conversationHistory.push({ 
                    role: "user", 
                    parts: [{ functionResponse: { name: name, response: { status: "success", info: "Brochure sent. Let them know they can check their WhatsApp and end the call." } } }] 
                });

                return await callLLM(conversationHistory);
            }
        }

        return result.text();
    } catch (error) {
        console.error('LLM Request Failed:', error);
        return '[en-IN] I encountered an error processing your request.';
    }
}

// WebSocket Server for Twilio Media Streams
wss.on('connection', (ws) => {
    console.log('Twilio connected to our WebSocket.');
    
    let streamSid = null;
    let conversationHistory = [];
    let asrWs = null;
    let ttsWs = null;
    
    // FIX 2: Global Interrupt Control
    global.isInterrupted = false;
    
    // Patch 7: Safe Post-Call Trigger
    let postCallSent = false;
    const triggerPostCall = () => {
        if (!postCallSent) {
            postCallSent = true;
            send_post_call_whatsapp(conversationHistory);
        }
    };

    // 1. Connect to Sarvam ASR
    try {
        const asrUrl = 'wss://api.sarvam.ai/speech-to-text/ws?language-code=unknown&sample_rate=8000';
        asrWs = new WebSocket(asrUrl, {
            headers: { 'api-subscription-key': process.env.SARVAM_API_KEY }
        });

        asrWs.on('open', () => console.log('Connected to Sarvam ASR'));

        asrWs.on('message', async (data) => {
            try {
                const response = JSON.parse(data);
                
                // FIX 2: Complete Barge-In Audio Flush
                if (response.text && response.text.length > 0) {
                    if (streamSid) ws.send(JSON.stringify({ event: 'clear', streamSid: streamSid }));
                    global.isInterrupted = true;
                }

                if (response.is_final && response.text) {
                    const userText = response.text;
                    console.log(`User: ${userText}`);
                    conversationHistory.push({ role: 'user', parts: [{ text: userText }] });

                    // LLM State Machine
                    global.isInterrupted = false; // Reset interrupt before LLM turn
                    const llmResponseText = await callLLM(conversationHistory);
                    console.log(`Agent: ${llmResponseText}`);
                    
                    if (llmResponseText) {
                        conversationHistory.push({ role: 'model', parts: [{ text: llmResponseText }] });
                        // Synthesize Response
                        synthesizeSpeech(llmResponseText);
                    }
                }
            } catch (e) {
                console.error('Error parsing ASR message:', e);
            }
        });

        asrWs.on('close', () => console.log('Sarvam ASR disconnected'));
        asrWs.on('error', (err) => console.error('Sarvam ASR Error:', err));
    } catch (err) {
        console.error('Failed to initialize Sarvam ASR WebSocket:', err);
    }

    // 2. Connect to Sarvam TTS
    try {
        const ttsUrl = 'wss://api.sarvam.ai/text-to-speech/ws';
        ttsWs = new WebSocket(ttsUrl, {
            headers: { 'api-subscription-key': process.env.SARVAM_API_KEY }
        });

        ttsWs.on('open', () => console.log('Connected to Sarvam TTS'));
        
        ttsWs.on('message', (data) => {
            try {
                if (global.isInterrupted) return; // FIX 2: Ignore stale TTS audio from interrupted sentence

                const response = JSON.parse(data);
                if (response.audio && streamSid) {
                    const audioPayload = {
                        event: 'media',
                        streamSid: streamSid,
                        media: { payload: response.audio }
                    };
                    ws.send(JSON.stringify(audioPayload));
                }
            } catch (e) {
                console.error('Error parsing TTS message:', e);
            }
        });

        ttsWs.on('close', () => console.log('Sarvam TTS disconnected'));
        ttsWs.on('error', (err) => console.error('Sarvam TTS Error:', err));
    } catch (err) {
        console.error('Failed to initialize Sarvam TTS WebSocket:', err);
    }

    // Helper to send text to TTS
    function synthesizeSpeech(text) {
        let languageCode = 'en-IN'; // default fallback
        let cleanText = text;
        
        // Extract language tag like [te-IN] or [hi-IN]
        const match = text.match(/^\[(en-IN|hi-IN|te-IN)\]/i);
        if (match) {
            languageCode = match[1];
            cleanText = text.substring(match[0].length).trim();
        }

        if (ttsWs && ttsWs.readyState === WebSocket.OPEN && cleanText) {
            ttsWs.send(JSON.stringify({
                text: cleanText,
                language_code: languageCode, 
                speaker: 'meera'
            }));
        }
    }

    // 3. Handle incoming Twilio messages
    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg.event === 'start') {
                streamSid = msg.start.streamSid;
                console.log(`Media stream started: ${streamSid}`);
                
                const introText = "[en-IN] Hello! I am an AI sales engineer. How can I help you build your e-commerce website today?";
                console.log(`Agent (Intro): ${introText}`);
                conversationHistory.push({ role: 'model', parts: [{ text: introText }] });
                synthesizeSpeech(introText);

            } else if (msg.event === 'media') {
                if (asrWs && asrWs.readyState === WebSocket.OPEN) {
                    asrWs.send(JSON.stringify({ audio: msg.media.payload }));
                }
            } else if (msg.event === 'stop') {
                console.log('Media stream stopped by Twilio.');
                triggerPostCall();
                if (asrWs) asrWs.close();
                if (ttsWs) ttsWs.close();
            }
        } catch (error) {
            console.error('Error processing Twilio message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Twilio disconnected (Call Ended).');
        
        // Trigger Post-Call WhatsApp asynchronously
        triggerPostCall();

        if (asrWs) asrWs.close();
        if (ttsWs) ttsWs.close();
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser.`);
});

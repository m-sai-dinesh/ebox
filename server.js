require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const twilio = require('twilio');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const PORT = process.env.PORT || 3000;

// Initialize Twilio client globally to reuse for Voice API
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Initialize WhatsApp Web Client
const waClient = new Client({
    authStrategy: new LocalAuth({ clientId: 'agent-v2' }),
    puppeteer: { 
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    }
});

waClient.on('qr', (qr) => {
    console.log('\n======================================================');
    console.log('SCAN THIS QR CODE WITH YOUR WHATSAPP TO AUTHENTICATE:');
    qrcode.generate(qr, { small: true });
    console.log('======================================================\n');
});

let isWaReady = false;
waClient.on('ready', () => {
    isWaReady = true;
    console.log('\n[WhatsApp Web] Client is READY! Authenticated successfully!\n');
});

waClient.on('disconnected', (reason) => {
    console.error('\n[WhatsApp Web] Client was disconnected:', reason);
    isWaReady = false;
});

waClient.initialize();

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
Speak naturally, be EXTREMELY concise (1-2 short sentences max).
CRITICAL RULE: You MUST reply in the EXACT SAME LANGUAGE the user just spoke in. 
NOTE: The transcription system may transliterate English words into Hindi script (e.g., "आई वांट" instead of "I want"). If the underlying words spoken are English, you MUST reply in pure English. Do not shift to Hindi unless the user is actually speaking Hindi words.
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

// Helper to format Twilio-style numbers to whatsapp-web.js format
function formatWaNumber(twilioFormatNumber) {
    let clean = twilioFormatNumber.replace('whatsapp:', '').replace(/\+/g, '').replace(/ /g, '');
    return clean + '@c.us';
}

// Async function to trigger WhatsApp without blocking the event loop
function sendWhatsAppAsync(args) {
    const { budget, products, timeline, features } = args;
    const body = `Hi there! It was great speaking with you. Here is a summary of your e-commerce needs:\n\n*Budget:* ${budget}\n*Products:* ${products}\n*Timeline:* ${timeline}\n*Features:* ${features}\n\nOur team will be in touch shortly!`;
    
    const targetNumber = formatWaNumber(process.env.TARGET_WHATSAPP_NUMBER || '+918688664337');
    
    const sendMessage = () => {
        waClient.sendMessage(targetNumber, body)
            .then(msg => console.log(`[WhatsApp] Sent successfully to ${targetNumber}!`))
            .catch(err => console.error(`[WhatsApp] Error sending message:`, err));
    };

    if (!isWaReady) {
        console.warn(`[WhatsApp] Client not ready yet! Queuing message in background...`);
        waClient.once('ready', sendMessage);
    } else {
        sendMessage();
    }
}

function sendColdBrochureAsync() {
    const targetNumber = formatWaNumber(process.env.TARGET_WHATSAPP_NUMBER || '+918688664337');
    const brochureLink = process.env.COMPANY_BROCHURE_URL || 'https://www.magnific.com/free-photos-vectors/placeholder-brochure';
    
    const sendBrochure = () => {
        waClient.sendMessage(targetNumber, `Thanks for your interest! Here is our company brochure to learn more about our e-commerce solutions:\n\n${brochureLink}`)
            .then(msg => console.log(`[WhatsApp] Brochure sent successfully to ${targetNumber}!`))
            .catch(err => console.error(`[WhatsApp] Error sending message:`, err));
    };

    if (!isWaReady) {
        console.warn(`[WhatsApp] Client not ready yet! Queuing brochure in background...`);
        waClient.once('ready', sendBrochure);
    } else {
        sendBrochure();
    }
}

function bookCallbackAsync(args) {
    const { callback_time, barrier } = args;
    const body = `Hello! This is a confirmation that your callback with our AI Sales Engineer is tentatively scheduled for:\n*${callback_time}*\n\nNoted Barrier: ${barrier}\n\nWe look forward to speaking with you!`;
    
    const targetNumber = formatWaNumber(process.env.TARGET_WHATSAPP_NUMBER || '+918688664337');
    
    const sendCallback = () => {
        waClient.sendMessage(targetNumber, body)
            .then(msg => console.log(`[WhatsApp] Callback confirmation sent successfully to ${targetNumber}!`))
            .catch(err => console.error(`[WhatsApp] Error sending message:`, err));
    };

    if (!isWaReady) {
        console.warn(`[WhatsApp] Client not ready yet! Queuing callback confirmation in background...`);
        waClient.once('ready', sendCallback);
    } else {
        sendCallback();
    }
}

// Async function to trigger the final post-call WhatsApp summary
async function send_post_call_whatsapp(conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) return;

    console.log('[Post-Call] Generating post-call summary and WhatsApp message...');

    try {
        // Query the LLM to summarize the context in a natural conversational tone
        const summaryModel = genAI.getGenerativeModel({ 
            model: "gemini-3.5-flash",
            systemInstruction: { role: "system", parts: [{ text: 'You are an assistant summarizing a sales call. Extract the products discussed, budget, timeline, and key features. Write a plain, human conversational summary addressed to the customer outlining what was discussed. Keep it professional but warm. CRITICAL RULE: Your entire response MUST be under 1000 characters. Never exceed this limit.' }] }
        });

        const result = await summaryModel.generateContent({ contents: conversationHistory });
        let summary = result.response.text();
        if (!summary) {
            summary = "Thank you for taking the time to speak with me about your e-commerce website requirements!";
        }

        const myPhoneNumber = process.env.MY_PHONE_NUMBER || '+91XXXXXXXXXX';
        const resumeUrl = process.env.RESUME_URL || 'https://your-hosted-resume-link.pdf';
        
        let finalBody = `${summary}\n\nFeel free to contact me directly at: ${myPhoneNumber}\nView my resume here: ${resumeUrl}`;

        if (process.env.DIAGRAM_IMAGE_URL && process.env.DIAGRAM_IMAGE_URL.startsWith('http')) {
            finalBody += `\n\nDiagram: ${process.env.DIAGRAM_IMAGE_URL}`;
        }

        console.log(`[Post-Call WhatsApp] Sending summary text:\n${finalBody}`);
        
        const targetNumber = formatWaNumber(process.env.TARGET_WHATSAPP_NUMBER || '+918688664337');

        const sendFinal = () => {
            waClient.sendMessage(targetNumber, finalBody)
                .then(msg => console.log(`[Post-Call WhatsApp] Final summary sent successfully to ${targetNumber}!`))
                .catch(err => console.error(`[Post-Call WhatsApp] Error sending summary message:`, err));
        };

        if (!isWaReady) {
            console.warn(`[Post-Call WhatsApp] Client not ready yet! Queuing summary in background...`);
            waClient.once('ready', sendFinal);
        } else {
            sendFinal();
        }

    } catch (error) {
        console.error('Error generating post-call summary:', error);
    }
}

async function callLLMStream(conversationHistory, onSentenceComplete, callState) {
    const model = genAI.getGenerativeModel({
        model: "gemini-3.5-flash",
        systemInstruction: { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        tools: geminiTools
    });

    try {
        const responseStream = await model.generateContentStream({ contents: conversationHistory });
        
        let fullResponse = '';
        let currentSentenceBuffer = '';
        let currentLang = 'hi-IN'; // default
        let ttsPromiseChain = Promise.resolve();

        for await (const chunk of responseStream.stream) {
            if (callState.isInterrupted) break;

            let functionCalls;
            try { functionCalls = chunk.functionCalls(); } catch(e){}
            
            if (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                const name = call.name;
                const args = call.args;
                
                conversationHistory.push({ role: "model", parts: [{ functionCall: call }] });

                if (name === 'send_hot_lead_whatsapp') {
                    console.log('HOT LEAD DETECTED! Executing send_hot_lead_whatsapp tool with args:', args);
                    sendWhatsAppAsync(args);
                    conversationHistory.push({ role: "user", parts: [{ functionResponse: { name: name, response: { status: "success", info: "WhatsApp sent successfully. Acknowledge this briefly to the user and wrap up." } } }] });
                    return await callLLMStream(conversationHistory, onSentenceComplete, callState);
                } else if (name === 'book_callback') {
                    console.log('WARM LEAD DETECTED! Booking callback with args:', args);
                    bookCallbackAsync(args);
                    conversationHistory.push({ role: "user", parts: [{ functionResponse: { name: name, response: { status: "success", info: `Callback booked for ${args.callback_time}. Acknowledge this politely to the caller and conclude the call.` } } }] });
                    return await callLLMStream(conversationHistory, onSentenceComplete, callState);
                } else if (name === 'send_cold_brochure') {
                    console.log('COLD LEAD DETECTED! Sending brochure...');
                    sendColdBrochureAsync();
                    conversationHistory.push({ role: "user", parts: [{ functionResponse: { name: name, response: { status: "success", info: "Brochure sent. Let them know they can check their WhatsApp and end the call." } } }] });
                    return await callLLMStream(conversationHistory, onSentenceComplete, callState);
                }
            }

            let textChunk = '';
            try { textChunk = chunk.text(); } catch(e){}

            if (textChunk) {
                fullResponse += textChunk;
                currentSentenceBuffer += textChunk;

                const langMatch = currentSentenceBuffer.match(/\[(en-IN|hi-IN|te-IN)\]/i);
                if (langMatch) {
                    currentLang = langMatch[1];
                    currentSentenceBuffer = currentSentenceBuffer.replace(langMatch[0], '').trimStart();
                }

                const match = currentSentenceBuffer.match(/[.?!|।\n]/);
                if (match) {
                    const splitIndex = match.index + 1;
                    const sentenceToSynthesize = currentSentenceBuffer.substring(0, splitIndex).trim();
                    currentSentenceBuffer = currentSentenceBuffer.substring(splitIndex).trimStart();

                    if (sentenceToSynthesize.length > 1) {
                        const langToUse = currentLang;
                        ttsPromiseChain = ttsPromiseChain.then(() => {
                            if (!callState.isInterrupted) return onSentenceComplete(sentenceToSynthesize, langToUse);
                        }).catch(err => console.error('[TTS Chain Error]:', err));
                    }
                }
            }
        }

        if (currentSentenceBuffer.trim().length > 0) {
            const langToUse = currentLang;
            const finalSentence = currentSentenceBuffer.trim();
            ttsPromiseChain = ttsPromiseChain.then(() => {
                if (!callState.isInterrupted) return onSentenceComplete(finalSentence, langToUse);
            }).catch(err => console.error('[TTS Chain Error]:', err));
        }

        await ttsPromiseChain;
        return fullResponse;

    } catch (error) {
        console.error('LLM Stream Failed:', error);
        return '[en-IN] I encountered an error processing your request.';
    }
}

// WebSocket Server for Twilio Media Streams
wss.on('connection', (ws) => {
    console.log('Twilio connected to our WebSocket.');
    
    let streamSid = null;
    let conversationHistory = [];
    let asrWs = null;
    let asrHasSentHeader = false;

    // Fast pure-JS mu-law to PCM16 transcoder
    const muLawToPcm16 = (muLawBuffer) => {
        const pcmBuffer = Buffer.alloc(muLawBuffer.length * 2);
        for (let i = 0; i < muLawBuffer.length; i++) {
            let mu = ~muLawBuffer[i];
            let sign = mu & 0x80;
            let exponent = (mu >> 4) & 0x07;
            let mantissa = mu & 0x0F;
            let sample = (mantissa << 3) + 132;
            sample <<= exponent;
            sample = sample - 132; // Fixed: Removed the incorrect << 2 shift which caused ERR_OUT_OF_RANGE
            if (sign !== 0) sample = -sample;
            
            // Safe clamp to strictly fit within Int16 range to absolutely prevent crashes
            if (sample > 32767) sample = 32767;
            if (sample < -32768) sample = -32768;
            
            pcmBuffer.writeInt16LE(sample, i * 2);
        }
        return pcmBuffer;
    };
    
    // FIX 2: Isolated Call State Interrupt Control
    const callState = { isInterrupted: false };
    
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
        const asrUrl = 'wss://api.sarvam.ai/speech-to-text-realtime/ws?language_code=hi-IN&sample_rate=8000&silence_duration_ms=400';
        asrWs = new WebSocket(asrUrl, {
            headers: { 'api-subscription-key': process.env.SARVAM_API_KEY }
        });

        asrWs.on('open', () => console.log('Connected to Sarvam ASR'));

        asrWs.on('message', async (data) => {
            try {
                const response = JSON.parse(data);
                console.log(`[Sarvam ASR Debug]:`, response);
                
                // NEW REALTIME ENDPOINT RESPONSES
                // e.g. {"event": "transcript", "transcript": "Hello", "is_final": true}
                // or   {"event": "transcript.final", "transcript": "Hello"}
                // We extract whatever text they provide.
                
                const isFinal = response.is_final === true || response.event === 'transcript.final';
                const text = response.transcript || response.text;

                if (text && text.length > 0) {
                    if (streamSid) ws.send(JSON.stringify({ event: 'clear', streamSid: streamSid }));
                    callState.isInterrupted = true;
                }

                if (isFinal && text) {
                    const userText = text;
                    console.log(`User: ${userText}`);
                    conversationHistory.push({ role: 'user', parts: [{ text: userText }] });

                    // LLM State Machine
                    callState.isInterrupted = false; // Reset interrupt before LLM turn
                    const llmResponseText = await callLLMStream(conversationHistory, async (sentence, lang) => {
                        if (!callState.isInterrupted) {
                            console.log(`Agent (Stream): [${lang}] ${sentence}`);
                            await synthesizeSpeech(sentence, lang);
                        }
                    }, callState);
                    
                    if (llmResponseText) {
                        conversationHistory.push({ role: 'model', parts: [{ text: llmResponseText }] });
                    }
                }
            } catch (e) {
                console.error('Error parsing ASR message:', e);
            }
        });

        asrWs.on('close', (code, reason) => console.log(`Sarvam ASR disconnected. Code: ${code}, Reason: ${reason.toString() || 'None'}`));
        asrWs.on('error', (err) => console.error('Sarvam ASR Error:', err));
    } catch (err) {
        console.error('Failed to initialize Sarvam ASR WebSocket:', err);
    }

    // 2. Helper to send text to TTS via Sarvam REST API
    async function synthesizeSpeech(cleanText, languageCode = 'hi-IN') {
        // If English is selected, Sarvam TTS models expect hi-IN for Indian-English
        if (languageCode === 'en-IN') languageCode = 'hi-IN';

        try {
            const response = await fetch('https://api.sarvam.ai/text-to-speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api-subscription-key': process.env.SARVAM_API_KEY
                },
                body: JSON.stringify({
                    inputs: [cleanText],
                    target_language_code: languageCode,
                    speaker: 'ritu',
                    speech_sample_rate: 8000,
                    enable_preprocessing: true,
                    model: 'bulbul:v3',
                    output_audio_codec: 'mulaw'
                })
            });

            const data = await response.json();
            if (callState.isInterrupted) return; // FIX 2: Ignore stale TTS audio from interrupted sentence

            if (data.audios && data.audios[0] && streamSid) {
                const audioPayload = {
                    event: 'media',
                    streamSid: streamSid,
                    media: { payload: data.audios[0] }
                };
                ws.send(JSON.stringify(audioPayload));
            } else {
                console.error('Sarvam REST TTS error:', data);
            }
        } catch (err) {
            console.error('Failed to call Sarvam REST TTS:', err);
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
                synthesizeSpeech("Hello! I am an AI sales engineer. How can I help you build your e-commerce website today?", 'en-IN');

            } else if (msg.event === 'media') {
                if (asrWs && asrWs.readyState === WebSocket.OPEN) {
                    const muLawBuffer = Buffer.from(msg.media.payload, 'base64');
                    const pcm16Buffer = muLawToPcm16(muLawBuffer);
                    
                    // Directly send raw PCM16 binary buffer!
                    asrWs.send(pcm16Buffer);
                }
            } else if (msg.event === 'stop') {
                console.log('Media stream stopped by Twilio.');
                triggerPostCall();
                if (asrWs) asrWs.close();
            }
        } catch (error) {
            console.error('Error processing Twilio message:', error);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Twilio disconnected (Call Ended). Code: ${code}, Reason: ${reason.toString() || 'None'}`);
        
        // Trigger Post-Call WhatsApp asynchronously
        triggerPostCall();

        if (asrWs) asrWs.close();
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser.`);
});

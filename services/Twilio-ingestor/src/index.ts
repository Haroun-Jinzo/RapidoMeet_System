import express, { Request, Response } from "express";
import cors from "cors";
import twilio from "twilio";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middlewares
app.use(cors());
// Twilio sends application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * GET /health
 */
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", service: "twilio-ingestor" });
});
console.log('TWILIO_WEBHOOK_URL:', process.env.TWILIO_WEBHOOK_URL);
/**
 * POST /webhooks/twilio/recording-status
 */
app.post("/webhooks/twilio/recording-status", async (req: Request, res: Response) => {
  try {
    // SKIP Twilio Signature Validation for local/Postman testing
    const twilioSignature = req.headers["x-twilio-signature"] as string;
    const webhookUrl = process.env.TWILIO_WEBHOOK_URL || "";
    const isValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN || "",
      twilioSignature,
      webhookUrl,
      req.body
    );
    if (!isValid) {
      console.warn("[Twilio] Invalid signature detected. Rejecting.");
      return res.status(403).send("Forbidden");
    }

    const payload = req.body;

    // 2. Ignore non-completed statuses
    if (payload.RecordingStatus !== "completed") {
      return res.status(200).send("OK"); // Twilio requires swift 200 OK
    }

    // Return 200 immediately to prevent Twilio webhook timeout
    res.status(200).send("OK");

    // 3. Process Async
    processRecording(payload).catch((err) => {
      console.error("[Twilio] Async processing failed:", err.message);
    });

  } catch (error) {
    console.error("[Twilio] Webhook Error:", error);
    // If headers haven't been sent, return 500
    if (!res.headersSent) res.status(500).send("Internal Server Error");
  }
});

app.post("/webhooks/twilio/voice/", (req: Request, res: Response) => {
    // This endpoint can be used for future voice call events if needed
    const recordingStatusCallback = process.env.TWILIO_WEBHOOK_URL;

    res.type("text/xml");
    res.send(`
         <Response>
      <Say>Welcome, your call will be recorded.</Say>
      <Record
        recordingStatusCallback="${recordingStatusCallback}"
        recordingStatusCallbackMethod="POST"
      />
    </Response>
  `);
});

/**
 * Async Processor for the Recording
 */
async function processRecording(payload: any) {
  const { CallSid, RecordingUrl, RecordingSid } = payload;
  console.log(`[Processor] Processing recording ${RecordingSid} for call ${CallSid}`);

  // Need to get From/To data from the Call resource
  const call = await twilioClient.calls(CallSid).fetch();
  const caller = call.from;
  const receiver = call.to;

  const meetingTitle = `Phone Call: ${caller} ↔ ${receiver}`;
  const meetingType = "phone_call";
  const language = process.env.DEFAULT_LANGUAGE || "fr";

  // Use the native .wav extension provided by Twilio
  const downloadUrl = `${RecordingUrl}`;
  console.log(`[Processor] Downloading audio from ${downloadUrl}`);

  // Fetch audio with HTTP Basic Auth
  const authHeader = "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  
  const audioRes = await fetch(downloadUrl, {
    method: "GET",
    headers: { Authorization: authHeader }
  });

  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);

  const tmpPath = path.join(os.tmpdir(), `${RecordingSid}.wav`);
  
  // Stream to disk first
  const fileStream = fs.createWriteStream(tmpPath);
  if (audioRes.body) {
    // node-fetch compat for Node 18+ global fetch
    for await (const chunk of audioRes.body as any) {
      fileStream.write(chunk);
    }
  }
  fileStream.end();

  // Wait for file writing to finish
  await new Promise((resolve) => fileStream.on("finish", resolve));
  console.log(`[Processor] Audio saved to ${tmpPath}`);

  // 4. Send to Main RapidoMeet Pipeline
  try {
    console.log(`[Processor] Uploading to RapidoMeet Pipeline...`);
    const buffer = fs.readFileSync(tmpPath);

    // Using modern FormData (Node 18+)
    const form = new FormData();
    form.append("meeting_title", meetingTitle);
    form.append("meeting_type", meetingType);
    form.append("language", language);
    form.append("participants", `${caller},${receiver}`);
    
    // Attach audio as a Blob/File
    const audioBlob = new Blob([buffer], { type: "audio/wav" });
    form.append("audio", audioBlob, `${RecordingSid}`);

    const rapidoMeetUrl = `${process.env.RAPIDOMEET_SYSTEM_BASE_URL}/upload-meeting`;
    
    const pipelineRes = await fetch(rapidoMeetUrl, {
      method: "POST",
      headers: {
        "X-Internal-Auth": process.env.TWILIO_INTERNAL_INGEST_SECRET || "",
      },
      body: form,
    });

    if (!pipelineRes.ok) {
      const errText = await pipelineRes.text();
      throw new Error(`Pipeline refused upload. Status: ${pipelineRes.status}. Output: ${errText}`);
    }

    const json = await pipelineRes.json();
    console.log(`[Processor] ✅ Successfully ingested into pipeline. Session ID: ${json.session_id}`);

  } finally {
    // Cleanup Temp File
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
      console.log(`[Processor] Cleaned up tmp file ${tmpPath}`);
    }
  }
}

app.listen(PORT, () => {
  console.log(`[Twilio Ingestor] Server running on port ${PORT}`);
});
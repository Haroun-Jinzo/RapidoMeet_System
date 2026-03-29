#!/usr/bin/env node
/**
 * test-transcribe.js - Test transcription service directly
 * This helps diagnose if Groq API is the bottleneck
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const Groq = require("groq-sdk").default;

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function log(color, ...args) {
  console.log(`${colors[color]}${args.join(" ")}${colors.reset}`);
}

async function testTranscription() {
  log("blue", "\n🎙️ Direct Groq API Test\n");

  // Load audio file
  const audioPath = path.join(__dirname, "..", "MeetingTest.mp3");
  if (!fs.existsSync(audioPath)) {
    log("red", `❌ File not found: ${audioPath}`);
    process.exit(1);
  }

  let audioBuffer = fs.readFileSync(audioPath);
  let fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2);
  log("green", `✅ Loaded ${fileSizeMB} MB`);

  // Check if file is too large, if so ask user to try smaller chunk
  if (audioBuffer.length > 10 * 1024 * 1024) {
    log("yellow", `\n⚠️  File is ${fileSizeMB} MB - Groq may timeout`);
    log("yellow", `Try creating a 1-2 minute sample first`);
    log("yellow", `Or use: npm run split-audio\n`);
    
    const useAnyway = process.argv.includes("--force");
    if (!useAnyway) {
      log("yellow", `Run with --force to try anyway: npm run test:transcribe -- --force`);
      process.exit(0);
    }
  }

  // Check API key
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    log("red", "❌ GROQ_API_KEY not set in environment");
    process.exit(1);
  }
  log("green", "✅ GROQ_API_KEY found");

  // Initialize Groq client with custom timeout
  const groq = new Groq({ 
    apiKey,
    timeout: 10 * 60 * 1000, // 10 minutes timeout
  });
  log("green", "✅ Groq client initialized (10 min timeout)");

  // Create temp file
  const tmpPath = path.join(__dirname, "..", `temp_${Date.now()}.mp3`);
  fs.writeFileSync(tmpPath, audioBuffer);
  log("green", `✅ Created temp file`);

  try {
    // Call API
    log("blue", "\n⏳ Calling Groq Whisper API (this may take a while)...");
    const startTime = Date.now();

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-large-v3",
      language: "fr",
      response_format: "verbose_json",
      temperature: 0,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log("green", `✅ Transcription complete in ${elapsed}s`);

    // Display results
    log("blue", "\n📝 Results:");
    log("green", `   Duration: ${(transcription.duration || 0).toFixed(1)}s`);
    log("green", `   Text length: ${(transcription.text || "").length} chars`);
    log("green", `   Segments: ${((transcription.segments || []).length)}`);

    if (transcription.text) {
      const preview = transcription.text.substring(0, 100);
      log("yellow", `   Preview: "${preview}..."`);
    }

    // Save result
    const resultPath = path.join(__dirname, "..", "test-data", `transcribe-${Date.now()}.json`);
    if (!fs.existsSync(path.dirname(resultPath))) {
      fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    }
    fs.writeFileSync(resultPath, JSON.stringify(transcription, null, 2));
    log("yellow", `\n✅ Result saved: ${resultPath}`);

  } catch (error) {
    log("red", `\n❌ Error: ${error.message}`);
    if (error.error?.error?.message) {
      log("red", `   API Error: ${error.error.error.message}`);
    }
    log("yellow", `Stack: ${error.stack}`);
  } finally {
    // Cleanup
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
      log("green", `✅ Cleaned up temp file`);
    }
  }
}

testTranscription();

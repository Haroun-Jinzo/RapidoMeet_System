#!/usr/bin/env node
/**
 * test-sample.js - Quick end-to-end test
 * Usage: npm run test:sample
 * 
 * This creates a minimal WAV file and sends it through the entire pipeline.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

// Colors for console output
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

async function testPipeline() {
  log("blue", "\n🧪 OpenClaw Server End-to-End Test\n");

  // Create test-data directory
  const testDataDir = path.join(__dirname, "..", "test-data");
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }

  // Step 1: Load audio file
  log("blue", "1. Loading MeetingTest.mp3...");
  const audioPath = path.join(__dirname, "..", "MeetingTest.mp3");
  
  if (!fs.existsSync(audioPath)) {
    log("red", `❌ File not found: ${audioPath}`);
    log("yellow", `Current directory: ${process.cwd()}`);
    log("yellow", `Script directory: ${__dirname}`);
    process.exit(1);
  }

  let audioBuffer;
  try {
    audioBuffer = fs.readFileSync(audioPath);
    log("green", `✅ Loaded ${audioPath} (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
  } catch (error) {
    log("red", `❌ Error reading file: ${error.message}`);
    process.exit(1);
  }

  // Step 2: Encode to base64
  log("blue", "\n2. Encoding to base64...");
  const startEncode = Date.now();
  const audioBase64 = audioBuffer.toString("base64");
  const encodeTime = ((Date.now() - startEncode) / 1000).toFixed(2);
  log("green", `✅ Encoded (${audioBase64.length} chars) - ${encodeTime}s`);

  // Step 3: Send to API
  log("blue", "\n3. Sending to pipeline...");
  log("yellow", `   (This may take several minutes for large audio files)`);

  const timestamp = new Date().toISOString().split("T")[0];
  const payload = {
    audio: audioBase64,
    audio_type: "audio/mp3",
    meeting_title: `Test Meeting - ${timestamp}`,
    meeting_type: "tech",
    language: "fr",
    participants: "Alice,Bob,Charlie",
  };

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);

    const options = {
      hostname: "localhost",
      port: 3000,
      path: "/upload-meeting",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      log("yellow", `   ⏳ Server responding... (status: ${res.statusCode})`);

      res.on("data", (chunk) => {
        data += chunk;
        log("yellow", `   ⏳ Receiving data... (${(data.length / 1024).toFixed(0)} KB)`);
      });

      res.on("end", () => {
        log("green", `✅ Got response (${data.length} bytes)`);

        try {
          const result = JSON.parse(data);
          log("blue", "\n📊 Pipeline Results:\n");

          // Display results
          log("blue", "Session ID:");
          log("green", `  ${result.session_id || "N/A"}`);

          log("blue", "\nTranscript (first 100 chars):");
          if (result.transcript) {
            const short =
              result.transcript.substring(0, 100) +
              (result.transcript.length > 100 ? "..." : "");
            log("green", `  ${short}`);
          } else {
            log("red", "  ❌ No transcript");
          }

          log("blue", "\nExtraction:");
          if (result.extraction) {
            const taskCount = (result.extraction.tasks || []).length;
            const decisionCount = (result.extraction.decisions || []).length;
            log(
              "green",
              `  ✅ ${taskCount} tasks, ${decisionCount} decisions`
            );
          } else {
            log("yellow", "  ⚠️  No extraction");
          }

          log("blue", "\nActions:");
          const actionCount = (result.actions || []).length;
          if (actionCount > 0) {
            log("green", `  ✅ ${actionCount} actions created`);
          } else {
            log("yellow", "  ⚠️  No actions");
          }

          log("blue", "\nNotifications:");
          if (result.notifications_sent && result.notifications_sent.length) {
            result.notifications_sent.forEach((n) => {
              log("green", `  ✅ ${n}`);
            });
          } else {
            log(
              "yellow",
              "  ⚠️  Check TELEGRAM_BOT_TOKEN in .env"
            );
          }

          log("green", "\n✅ Test completed!\n");

          // Save full response
          const timestamp = Date.now();
          const resultPath = path.join(
            testDataDir,
            `result-${timestamp}.json`
          );
          fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
          log("yellow", `Full response saved: ${resultPath}\n`);

          resolve();
        } catch (e) {
          log("red", `❌ Invalid JSON response: ${e.message}`);
          resolve();
        }
      });
    });

    req.on("error", (e) => {
      log("red", `\n❌ Request failed: ${e.message}`);
      log("yellow", "Make sure the server is running: npm run dev\n");
      reject(e);
    });

    // Set timeout to 30 minutes for large audio files
    req.setTimeout(1800000, () => {
      log("red", "\n❌ Request timeout after 30 minutes");
      log("yellow", "The audio file may be too large or the processing is taking too long\n");
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(postData);
    req.end();
  });
}

// Run test
testPipeline().catch((e) => {
  process.exit(1);
});

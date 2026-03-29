#!/usr/bin/env node
/**
 * split-audio.js - Split large audio files into smaller chunks
 * Useful for processing large audio files with Groq API
 */

const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);

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

async function getAudioDuration(filePath) {
  try {
    const { stdout } = await exec(
      `ffprobe -v error -format "%%duration" -of default=noprint_wrappers=1:nokey=1:noprint_wrappers=1 "${filePath}"`
    );
    return parseFloat(stdout.trim());
  } catch (error) {
    log("yellow", "⚠️  Could not get duration with ffprobe, trying alternative method...");
    return null;
  }
}

async function splitAudio(inputFile, outputDir, chunkDurationSec = 300) {
  log("blue", "\n🎵 Audio Splitter\n");

  if (!fs.existsSync(inputFile)) {
    log("red", `❌ File not found: ${inputFile}`);
    process.exit(1);
  }

  const stats = fs.statSync(inputFile);
  const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
  log("green", `✅ Input file: ${inputFile} (${fileSizeMB} MB)`);

  // Try to get duration
  const duration = await getAudioDuration(inputFile);
  if (duration) {
    log("green", `✅ Duration: ${Math.round(duration)}s`);
  } else {
    log("yellow", "⚠️  Could not determine duration");
  }

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ext = path.extname(inputFile);
  const baseName = path.basename(inputFile, ext);

  log("blue", `\n⏳ Splitting into ${chunkDurationSec}s chunks...`);

  let chunkNum = 0;
  let currentTime = 0;

  while (!duration || currentTime < duration) {
    chunkNum++;
    const outputFile = path.join(outputDir, `${baseName}_chunk_${chunkNum}${ext}`);

    const cmd = `ffmpeg -i "${inputFile}" -ss ${currentTime} -t ${chunkDurationSec} -c copy "${outputFile}" -y 2>&1`;

    try {
      await exec(cmd);
      const chunkStats = fs.statSync(outputFile);
      const chunkSizeMB = (chunkStats.size / 1024 / 1024).toFixed(2);
      log("green", `   ✅ Chunk ${chunkNum}: ${outputFile} (${chunkSizeMB} MB)`);
      currentTime += chunkDurationSec;

      // Stop if we don't know the total duration and created a very small chunk
      if (!duration && chunkStats.size < 100000) {
        break;
      }
    } catch (error) {
      if (chunkNum === 1) {
        log("red", "❌ ffmpeg not installed or failed");
        log("yellow", "Install ffmpeg: brew install ffmpeg (macOS) or download from ffmpeg.org");
        process.exit(1);
      }
      break;
    }
  }

  log("green", `\n✅ Created ${chunkNum} chunks in ${outputDir}`);
  log("yellow", `\nNext: Test with: npm run test:transcribe:chunk 1`);
}

// Get arguments
const args = process.argv.slice(2);
const inputFile = args[0] || path.join(__dirname, "..", "MeetingTest.mp3");
const outputDir = args[1] || path.join(__dirname, "..", "audio-chunks");
const chunkDuration = parseInt(args[2]) || 300; // 5 minutes

splitAudio(inputFile, outputDir, chunkDuration).catch((err) => {
  log("red", `Error: ${err.message}`);
  process.exit(1);
});

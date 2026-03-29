#!/usr/bin/env node
/**
 * test-python.js - Diagnose Python execution from Node.js
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

console.log("🔍 Testing Python execution...\n");

// Test 1: Check if python is in PATH
console.log("1. Testing: python --version");
const pythonVersion = spawn("python", ["--version"], { stdio: "inherit" });

pythonVersion.on("close", (code) => {
  if (code !== 0) {
    console.error("❌ Python not found in PATH\n");
    testVenv();
  } else {
    console.log("✅ Python found\n");
    testWhisper();
  }
});

function testVenv() {
  console.log("2. Testing virtual environment...");
  const venvPath = path.join(__dirname, "..", "venv", "Scripts", "python.exe");
  
  if (fs.existsSync(venvPath)) {
    console.log(`✅ Found venv Python at: ${venvPath}\n`);
    console.log("3. Testing: venv python --version");
    const venvTest = spawn(venvPath, ["--version"], { stdio: "inherit" });
    venvTest.on("close", () => {
      testWhisper(venvPath);
    });
  } else {
    console.log(`❌ venv Python not found at: ${venvPath}`);
    console.log("\nCreate venv with: python -m venv venv\n");
  }
}

function testWhisper(pythonPath = "python") {
  console.log("4. Testing: faster-whisper import");
  
  const testScript = `
import sys
try:
    from faster_whisper import WhisperModel
    print("✅ faster-whisper is installed")
    sys.exit(0)
except ImportError as e:
    print(f"❌ faster-whisper not installed: {e}")
    sys.exit(1)
`;

  const tmpScript = path.join(__dirname, "..", "test_import.py");
  fs.writeFileSync(tmpScript, testScript);

  const test = spawn(pythonPath, [tmpScript], { stdio: "inherit" });
  test.on("close", (code) => {
    fs.unlinkSync(tmpScript);
    
    if (code !== 0) {
      console.log("\nInstall with: pip install faster-whisper\n");
    } else {
      console.log("\n✅ Everything is set up correctly!");
      console.log("Ready to test: npm run test:sample\n");
    }
  });
}

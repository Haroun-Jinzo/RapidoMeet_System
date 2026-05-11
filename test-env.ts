// Test script to verify .env is loaded and API keys are accessible
import * as dotenv from "dotenv";

dotenv.config();

console.log("\n=== .ENV VERIFICATION ===\n");

const keys = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  N8N_API_KEY: process.env.N8N_API_KEY,
  INTERNAL_INGEST_SECRET: process.env.INTERNAL_INGEST_SECRET,
  ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET,
};

for (const [key, value] of Object.entries(keys)) {
  const masked = value 
    ? `✓ Present (len=${value.length}, first 8: ${value.slice(0, 8)}...)`
    : "✗ MISSING";
  console.log(`${key}: ${masked}`);
}

console.log("\n=== TESTING KEY RESOLUTION ===\n");

async function testKeyResolver() {
  const { KeyResolver } = await import("./src/utils/KeyResolver");
  
  // Test with a non-UUID user (should trigger env fallback)
  const testUserId = "test-user-123";
  
  try {
    const apiKeys = await KeyResolver.resolveKeys(testUserId);
    
    console.log("KeyResolver.resolveKeys() result:");
    console.log(`  Orchestrator: ${apiKeys.Orchestrator.provider} — key present: ${!!apiKeys.Orchestrator.apiKey}`);
    if (apiKeys.Orchestrator.apiKey) {
      console.log(`    → Key length: ${apiKeys.Orchestrator.apiKey.length}, first 8: ${apiKeys.Orchestrator.apiKey.slice(0, 8)}...`);
    }
    
    console.log(`  AudioTranscriber: ${apiKeys.AudioTranscriber.provider} — key present: ${!!apiKeys.AudioTranscriber.apiKey}`);
    if (apiKeys.AudioTranscriber.apiKey) {
      console.log(`    → Key length: ${apiKeys.AudioTranscriber.apiKey.length}, first 8: ${apiKeys.AudioTranscriber.apiKey.slice(0, 8)}...`);
    }
    
    console.log(`  n8n: key present: ${!!apiKeys.n8n}`);
    if (apiKeys.n8n) {
      console.log(`    → Key length: ${apiKeys.n8n.length}, first 8: ${(apiKeys.n8n as string).slice(0, 8)}...`);
    }
    
    console.log("\n✅ KeyResolver works correctly!");
    
  } catch (err) {
    console.error("\n❌ KeyResolver error:", (err as Error).message);
  }
}

testKeyResolver().catch(console.error);

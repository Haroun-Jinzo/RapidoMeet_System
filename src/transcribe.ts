import FormData from 'form-data';
import fetch from 'node-fetch';
// src/transcribe.ts
// ─────────────────────────────────────────────────────────────────────────────
// C4 Level 3: Transcription
// Interface:  ITranscriber (from interfaces.ts)
// Responsibility: Convert audio to structured text with speaker diarisation.
//                 The ONLY module that calls the transcription API.
// Dependencies: Groq API (GROQ_API_KEY) — Whisper large-v3.
// Note: Swapped from Deepgram to Groq Whisper — interface unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import Groq from "groq-sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import {
  ITranscriber,
  ITranscriptionResult,
  ISpeakerSegment,
} from "./interfaces";
import { CircuitBreaker } from "./resilience/CircuitBreaker";
import { GROQ_CONFIG, CIRCUIT_BREAKER_CONFIG, LOCAL_WHISPER_CONFIG } from "./config/services";
import { splitAudioIfNeeded } from './utils/splitAudio';

const execAsync = promisify(exec);

/**
 * Speech-to-Text Transcription Service
 * 
 * This service converts audio files/streams to structured text transcripts
 * using Groq's Whisper large-v3 model. It provides:
 * - File and stream-based transcription
 * - Automatic speaker segmentation (labels all segments as "Speaker 0")
 * - Error handling and circuit breaker protection against Groq API failures
 * - Temporary file management for SDK compatibility
 * 
 * Note: Whisper doesn't perform true speaker diarization. For production
 * speaker identification, consider: pyannote.audio or AssemblyAI.
 */
class Transcriber implements ITranscriber {

  private circuitBreaker: CircuitBreaker;

  constructor() {
    // Initialize circuit breaker to protect against cascading failures
    // If API becomes unresponsive, circuit breaker will fail fast
    // instead of causing request timeouts and retry storms
    this.circuitBreaker = new CircuitBreaker('transcriber', CIRCUIT_BREAKER_CONFIG);
    
    console.log("[Transcriber] Client initialised with circuit breaker protection");
  }

  /**
   * Transcribe using local faster-whisper (no API cost, no timeout issues)
   * Spawns Python subprocess to run faster-whisper
   * 
   * @param audioPath - Path to audio file
   * @param language - ISO language code
   * @returns Promise resolving to transcription result with segments
   */
  private async transcribeWithLocalWhisper(
    audioPath: string,
    language: string
  ): Promise<ITranscriptionResult> {
    console.log(`[Transcriber] Using FastAPI faster-whisper service for transcription`);

    const formData = new FormData();
    formData.append("audio", fs.createReadStream(audioPath) as any);
    formData.append("language", language);

    const startTime = Date.now();
    try {
      const response = await fetch("http://127.0.0.1:8000/transcribe", {
        method: "POST",
        body: formData as any,
      });

      if (!response.ok) {
        throw new Error(`Whisper API failed with status ${response.status}: ${await response.text()}`);
      }

      const result = await response.json() as any;
      if (result.error) {
        throw new Error(result.error);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[Transcriber] FastAPI transcription complete in ${elapsed}s`);

      const segments: ISpeakerSegment[] = (result.segments || []).map((seg: any) => ({
        start: seg.start,
        end: seg.end,
        speaker: seg.speaker,
        text: seg.text,
      }));

      return {
        transcript: result.transcript,
        segments,
        duration: result.duration || 0,
        confidence: result.language_probability || 0.95,
        language: result.language || language,
      };

    } catch (e: any) {
      console.error(`[Transcriber] FastAPI error: ${e.message}`);
      throw new Error(`Failed to call Whisper API: ${e.message}`);
    }
  }

  /**
   * Transcribe a complete audio file and return structured result with segments
   * 
   * Flow:
   * 1. Auto-detect: use local whisper for large files (> 10MB)
   * 2. Otherwise use Groq API for smaller files
   * 3. Write buffer to temp file
   * 4. Call API with circuit breaker protection
   * 5. Parse response and build segment list
   * 6. Clean up temp file
   * 
   * @param audioBuffer - Binary audio data
   * @param mimeType - Audio format (audio/wav, audio/mp3, etc.)
   * @param language - ISO language code (default: French)
   * @returns Promise resolving to transcription with segments and metadata
   * @throws Error if file too large, API fails, or Groq temporarily disabled (circuit breaker open)
   */
  async transcribeFile(
    audioBuffer: Buffer,
    mimeType:    string,
    language:    string = "fr",
    apiKeys?:    any
  ): Promise<ITranscriptionResult> {
    const provider = apiKeys?.AudioTranscriber?.provider || 'groq';
    const apiKey = apiKeys?.AudioTranscriber?.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error(`${provider} API key not configured`);
    
    // We only have the groq sdk setup for audio transcription at this point
    // A dynamically routed adapter could be created here in the future
    const groq = new Groq({ apiKey, timeout: 10 * 60 * 1000 });

    const fileSizeMB = Math.round(audioBuffer.length / 1024 / 1024);
    console.log(
      `[Transcriber] Starting transcription — ` +
      `size: ${fileSizeMB}MB, ` +
      `type: ${mimeType}, lang: ${language}`
    );

    const ext = this.getExtension(mimeType);
    const tmpPath = path.join(os.tmpdir(), `rapidomeet_${Date.now()}${ext}`);

    try {
      fs.writeFileSync(tmpPath, audioBuffer);

      // ✅ Route to appropriate transcription engine based on file size
      if (LOCAL_WHISPER_CONFIG.enabled && (audioBuffer.length > LOCAL_WHISPER_CONFIG.sizeLimitForLocal || audioBuffer.length > GROQ_CONFIG.maxFileSize)) {
        console.log(`[Transcriber] File size (${fileSizeMB}MB) triggers local fallback, using local faster-whisper`);
        return await this.transcribeWithLocalWhisper(tmpPath, language);
      }

      // Validate file size against Groq's hard limit if local whisper didn't catch it
      if (audioBuffer.length > GROQ_CONFIG.maxFileSize) {
        throw new Error(
          `Audio file too large for Groq: ${fileSizeMB}MB. ` +
          `Maximum is ${Math.round(GROQ_CONFIG.maxFileSize / 1024 / 1024)}MB. Local Whisper fallback is disabled.`
        );
      }

      // Use Groq API for smaller files
      console.log(`[Transcriber] File size ${fileSizeMB}MB is below threshold, using Groq API`);
      
      const startTime = Date.now();
      
      // 1. Split the massive buffer into smaller, safe chunks
      const audioChunks = splitAudioIfNeeded(audioBuffer, mimeType);
      console.log(`[Transcriber] File split into ${audioChunks.length} chunk(s) to avoid 524 Timeout`);

      let fullTranscript = "";
      let allSegments: ISpeakerSegment[] = [];
      let totalDuration = 0;

      // 2. Process each chunk one by one
      for (let i = 0; i < audioChunks.length; i++) {
        const chunkBuffer = audioChunks[i];
        
        // Write the individual chunk to a temp file
        const chunkTmpPath = path.join(os.tmpdir(), `chunk_${Date.now()}_${i}${ext}`);
        fs.writeFileSync(chunkTmpPath, chunkBuffer);

        console.log(`[Transcriber] Transcribing chunk ${i + 1}/${audioChunks.length}...`);

        try {
          // Clean the language parameter to ensure it's valid for Groq
          const safeLanguage = language.trim() || undefined;

          // Send the small chunk to Groq
          const transcription = await this.circuitBreaker.execute(async () => {
             return await groq.audio.transcriptions.create({
                file: fs.createReadStream(chunkTmpPath),
                model: GROQ_CONFIG.model,
                language: safeLanguage,
                response_format: "verbose_json",
                temperature: 0,
             });
          });

          // Append text
          const chunkText = transcription.text?.trim() || "";
          fullTranscript += " " + chunkText;

          // Process boundaries (padding times so segment 2 doesn't restart at 0:00)
          const chunkSegments = this.buildSegments((transcription as any).segments || []);
          const paddedSegments = chunkSegments.map(s => ({
            ...s,
            start: s.start + totalDuration,
            end: s.end + totalDuration
          }));
          
          allSegments.push(...paddedSegments);

          // Update duration for the next chunk's offset
          totalDuration += chunkSegments.length > 0 
             ? chunkSegments[chunkSegments.length - 1].end 
             : 0;

        } finally {
          // Always clean up chunk temp file
          if (fs.existsSync(chunkTmpPath)) {
            fs.unlinkSync(chunkTmpPath);
          }
        }
      }

      const elapsed = Date.now() - startTime;

      console.log(
        `[Transcriber] Complete — ` +
        `duration: ${Math.round(totalDuration)}s, ` +
        `segments: ${allSegments.length}, ` +
        `elapsed: ${elapsed}ms`
      );

      return {
        transcript: fullTranscript.trim(),
        segments: allSegments,
        duration: totalDuration,
        confidence: 0.95,  // Whisper doesn't return confidence scores — use fixed value
        language,
      };

    } finally {
      // Cleanup: Always delete temp file, even if transcription failed
      // "finally" block runs regardless of success/error
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    }
  }

  /**
   * Transcribe audio from a readable stream
   * 
   * Since Groq doesn't support real-time streaming, we:
   * 1. Collect ALL audio chunks from the stream into memory
   * 2. When stream ends, call transcribeFile() with complete buffer
   * 3. Call onPartial() periodically to show progress to the UI
   * 
   * ⚠️ This means transcription only occurs AFTER the meeting ends.
   * For production real-time transcription, consider:
   *   - AssemblyAI (supports WebSocket streaming)
   *   - Deepgram (supports WebSocket + gRPC streaming)
   *   - A separate Python service using faster-whisper
   * 
   * @param stream - Node.js readable stream emitting audio chunks
   * @param onPartial - Callback for progress messages shown to UI
   * @returns Promise resolving to transcription result
   */
  async transcribeStream(
    stream:    NodeJS.ReadableStream,
    onPartial: (text: string) => void,
    apiKeys?:  any
  ): Promise<ITranscriptionResult> {
    console.log("[Transcriber] Initializing stream collection for batch transcription");

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      // Signal to UI that we're in collection phase
      onPartial("Enregistrement en cours...");

      stream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        totalBytes += chunk.length;

        // Send progress update every 5MB so UI shows the application is responsive
        // Without progress feedback, UI appears frozen during long recordings
        if (totalBytes % (5 * 1024 * 1024) < chunk.length) {
          const mb = Math.round(totalBytes / 1024 / 1024);
          onPartial(`Enregistrement en cours... ${mb}MB capturés`);
          console.log(`[Transcriber] Collected ${mb}MB of audio`);
        }
      });

      stream.on("end", async () => {
        console.log(
          `[Transcriber] Stream collection complete — ` +
          `total: ${Math.round(totalBytes / 1024)}KB. Initiating transcription.`
        );
        onPartial("Transcription en cours...");

        try {
          // Concatenate all chunks into one buffer and transcribe
          const fullBuffer = Buffer.concat(chunks);
          // Assume WAV format from Playwright bot recording
          // ⚠️ TODO: Detect format from stream metadata instead of assuming
          const result = await this.transcribeFile(fullBuffer, "audio/wav", "fr", apiKeys);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      stream.on("error", (err) => {
        const errorMsg = `Audio stream collection failed: ${err.message}`;
        console.error(`[Transcriber] ${errorMsg}`);
        reject(new Error(errorMsg));
      });
    });
  }

  /**
   * Convert Groq Whisper segments to internal domain model
   * 
   * Whisper's segments represent speech pauses and are approximately
   * at sentence/breath boundaries. We map them to our ISpeakerSegment model.
   * 
   * ⚠️ ALL segments are labeled "Speaker 0" because Whisper doesn't identify speakers.
   * Each speaker would need pyannote.audio or AssemblyAI speaker detection.
   * 
   * @param whisperSegments - Raw Whisper API response segments
   * @returns Segments in our internal ISpeakerSegment format
   */
  private buildSegments(
    whisperSegments: Array<{ text: string; start: number; end: number }>
  ): ISpeakerSegment[] {
    return whisperSegments.map(seg => ({
      speaker: "Speaker 0",       // Whisper doesn't identify speakers
      text:    seg.text.trim(),   // Remove whitespace from segment text
      start:   seg.start,         // Start time in seconds
      end:     seg.end,           // End time in seconds
    }));
  }

  /**
   * Map MIME type strings to file extensions
   * 
   * Groq SDK uses file extensions to detect audio format during upload.
   * This mapping ensures we write temp files with the correct extension.
   * 
   * @param mimeType - MIME type string (e.g. "audio/wav")
   * @returns File extension with dot prefix (e.g. ".wav")
   */
  private getExtension(mimeType: string): string {
    // Mapping of MIME types to file extensions
    // Falls back to .mp3 if type is unknown
    const map: Record<string, string> = {
      "audio/mpeg":  ".mp3",
      "audio/mp3":   ".mp3",
      "audio/wav":   ".wav",
      "audio/wave":  ".wav",
      "audio/m4a":   ".m4a",
      "audio/mp4":   ".mp4",
      "audio/ogg":   ".ogg",
      "audio/webm":  ".webm",
      "audio/flac":  ".flac",
    };
    return map[mimeType] || ".mp3";
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global transcriber instance
 * 
 * Exported as a singleton so all modules use the same Groq client.
 * This reuses the same API connection, reducing overhead.
 * 
 * Usage in other modules:
 *   import { transcriber } from './transcribe';
 *   await transcriber.transcribeFile(buffer, 'audio/wav');
 */
export const transcriber = new Transcriber();
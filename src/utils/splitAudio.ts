// src/utils/splitAudio.ts
// Splits a large audio buffer into 20MB chunks using ffmpeg
// Only needed for files > 25MB

import { execSync } from "child_process";
import * as fs      from "fs";
import * as os      from "os";
import * as path    from "path";

export function splitAudioIfNeeded(
  buffer:   Buffer,
  mimeType: string
): Buffer[] {
  const MAX_MB = 20; // stay safely under the 25MB limit
  const maxBytes = MAX_MB * 1024 * 1024;

  // If it fits, return as-is
  if (buffer.length <= maxBytes) return [buffer];

  console.log(
    `[splitAudio] File is ${Math.round(buffer.length/1024/1024)}MB — splitting`
  );

  // Write to temp, split with ffmpeg, read parts back
  const ext      = mimeType.includes("wav") ? ".wav" : ".mp3";
  const tmpInput = path.join(os.tmpdir(), `split_input_${Date.now()}${ext}`);
  const tmpDir   = path.join(os.tmpdir(), `split_${Date.now()}`);
  fs.mkdirSync(tmpDir);
  fs.writeFileSync(tmpInput, buffer);

  // ffmpeg splits by duration — 20 minutes per chunk
  execSync(
    `ffmpeg -i "${tmpInput}" -f segment -segment_time 1200 ` +
    `-c copy "${tmpDir}/part_%03d${ext}" -y`,
    { stdio: "pipe" }
  );

  const parts = fs.readdirSync(tmpDir)
    .sort()
    .map(f => fs.readFileSync(path.join(tmpDir, f)));

  // Clean up temp files
  fs.unlinkSync(tmpInput);
  fs.rmSync(tmpDir, { recursive: true });

  console.log(`[splitAudio] Split into ${parts.length} parts`);
  return parts;
}
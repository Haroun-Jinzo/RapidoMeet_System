/**
 * One segment of speech from one identified speaker.
 * Example: { speaker: "Speaker 0", text: "On va commencer...", start: 0, end: 4.2 }
 */
export interface ISpeakerSegment {
  speaker:  string;   // "Speaker 0", "Speaker 1", etc.
  text:     string;   // What that speaker said
  start:    number;   // Seconds from beginning of audio
  end:      number;   // Seconds from beginning of audio
}

/**
 * Full result of transcribing one audio file or stream.
 */

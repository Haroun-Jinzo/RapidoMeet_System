export interface ISpeakerSegment {
  speaker:  string;   // "Speaker 0", "Speaker 1", etc.
  text:     string;   // What that speaker said
  start:    number;   // Seconds from beginning of audio
  end:      number;   // Seconds from beginning of audio
}

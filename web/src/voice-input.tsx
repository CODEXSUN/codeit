import { useEffect, useRef, useState } from "react";
import { ComposerIcon } from "./composer-icon.js";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

export function VoiceInput({ onTranscript, disabled = false }: { onTranscript: (text: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;
  const SpeechRecognition = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;

  useEffect(() => () => {
    if (recognition.current) {
      recognition.current.onend = null;
      recognition.current.onresult = null;
      recognition.current.onerror = null;
      recognition.current.abort();
    }
  }, []);
  useEffect(() => {
    if (disabled && recognition.current) recognition.current.abort();
  }, [disabled]);

  function toggle() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    if (!SpeechRecognition) return;
    setError("");
    const session = new SpeechRecognition();
    session.continuous = true;
    session.interimResults = false;
    session.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal && result[0]?.transcript) callback.current(result[0].transcript);
      }
    };
    session.onerror = (event) => setError(speechError(event.error));
    session.onend = () => { recognition.current = null; setListening(false); };
    recognition.current = session;
    try { session.start(); setListening(true); }
    catch { recognition.current = null; setError("Could not start voice input. Check microphone permissions and try again."); }
  }

  return <div className="voice-input">
    <button className="composer-icon" type="button" onClick={toggle} disabled={disabled || !SpeechRecognition} aria-pressed={listening} aria-label={listening ? "Stop voice input" : "Start voice input"} title={!SpeechRecognition ? "Voice input is not supported in this browser" : listening ? "Stop voice input" : "Start voice input"}><ComposerIcon name={listening ? "stop" : "mic"} /></button>
    <span role="status" aria-live="polite">{error || (listening ? "Listening…" : !SpeechRecognition ? "Voice input is not supported in this browser." : "")}</span>
  </div>;
}

function speechError(error: string): string {
  switch (error) {
    case "not-allowed": case "service-not-allowed": return "Microphone or speech recognition permission was denied.";
    case "audio-capture": return "No microphone is available. Check your microphone and try again.";
    case "network": return "Speech recognition needs a network connection. Check your connection and try again.";
    case "no-speech": return "No speech was detected. Try again.";
    case "aborted": return "Voice input was stopped.";
    default: return `Voice input failed (${error}). Try again.`;
  }
}

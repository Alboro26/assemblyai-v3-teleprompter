import { useState, useCallback, useRef, useEffect } from "react";

export interface VoiceFeatures {
  pitchAvg: number;
  energyAvg: number;
  rate: number;
}

export function useVoiceActivity(
  onSilence: () => void,
  silenceThreshold: number = 1500
) {
  const [isActive, setIsActive] = useState(false);
  const [features, setFeatures] = useState<VoiceFeatures | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const energyHistory = useRef<number[]>([]);
  const isRunning = useRef(false);

  const calculatePitch = useCallback((buffer: Float32Array, sampleRate: number): number => {
    // Simple autocorrelation pitch detection
    const buflen = buffer.length;
    let bestOffset = -1;
    let bestCorrelation = 0;
    const correlations = new Array(buflen).fill(0);
    const rms = Math.sqrt(buffer.reduce((sum, val) => sum + val * val, 0) / buflen);

    if (rms < 0.01) return 0; // Too quiet

    for (let offset = 0; offset < buflen; offset++) {
      let correlation = 0;
      for (let i = 0; i < buflen - offset; i++) {
        correlation += Math.abs(buffer[i] - buffer[i + offset]);
      }
      correlation = 1 - correlation / buflen;
      correlations[offset] = correlation;

      if (correlation > 0.9 && correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    if (bestOffset === -1) return 0;
    return sampleRate / bestOffset;
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      isRunning.current = true;
      energyHistory.current = [];

      const bufferLength = analyser.fftSize;
      const timeDomainData = new Float32Array(bufferLength);
      const frequencyData = new Uint8Array(analyser.frequencyBinCount);

      const detect = () => {
        if (!isRunning.current) return;

        analyser.getFloatTimeDomainData(timeDomainData);
        analyser.getByteFrequencyData(frequencyData);

        // Calculate energy (RMS)
        const rms = Math.sqrt(
          timeDomainData.reduce((sum, val) => sum + val * val, 0) / bufferLength
        );
        const energy = rms * 1000; // Scale up

        energyHistory.current.push(energy);
        if (energyHistory.current.length > 100) {
          energyHistory.current.shift();
        }

        const avgEnergy =
          energyHistory.current.reduce((a, b) => a + b, 0) /
          energyHistory.current.length;

        // Voice activity threshold
        const threshold = 15;
        const hasVoice = energy > threshold || avgEnergy > threshold * 0.6;

        if (hasVoice) {
          setIsActive(true);
          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }

          // Calculate features
          const pitch = calculatePitch(timeDomainData, audioContext.sampleRate);
          const features: VoiceFeatures = {
            pitchAvg: pitch > 50 && pitch < 500 ? pitch : 150,
            energyAvg: avgEnergy,
            rate: energyHistory.current.filter((e) => e > threshold).length / 10, // Approximate syllables/sec
          };
          setFeatures(features);
        } else if (isActive && !silenceTimeoutRef.current) {
          silenceTimeoutRef.current = setTimeout(() => {
            setIsActive(false);
            onSilence();
          }, silenceThreshold);
        }

        animationFrameRef.current = requestAnimationFrame(detect);
      };

      detect();
    } catch (err) {
      console.error("Voice activity detection failed:", err);
    }
  }, [onSilence, silenceThreshold, calculatePitch, isActive]);

  const stop = useCallback(() => {
    isRunning.current = false;

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setIsActive(false);
    setFeatures(null);
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return { isActive, features, start, stop };
}

/**
 * audioProcessing.ts
 * Utilities for capturing, downsampling, playing, and converting raw PCM audio for Gemini Live.
 */

// Converts a base64 string to a Uint8Array
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Converts a Uint8Array to a base64 string
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Converts 16-bit PCM (Uint8Array of Int16s) to Float32Array for AudioContext playback
export function pcm16ToFloat32(pcmData: Uint8Array): Float32Array {
  const int16Array = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    // Normalize Int16 to Float32 [-1, 1]
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}

// Very basic inline AudioWorklet code to handle downsampling to 16kHz and packaging as 16-bit PCM.
// Improved AudioWorklet for aggressive noise gating and adaptive floor tracking.
const AudioWorkletSrc = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.noiseFloor = 0.001;
    this.alpha = 0.005; // EMA for noise tracking
  }
  
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      
      // Calculate RMS for this chunk
      let sumSquares = 0;
      for (let i = 0; i < channelData.length; i++) {
          sumSquares += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sumSquares / channelData.length);

      // Adaptively update noise floor
      if (rms < this.noiseFloor * 2.0) {
          this.noiseFloor = this.alpha * rms + (1 - this.alpha) * this.noiseFloor;
      }
      
      // More aggressive multiplier (4.0x) to block outer mic noise
      const dynamicThreshold = Math.max(0.003, this.noiseFloor * 4.0);
      
      // Aggressive noise gate
      let gain = 1.0;
      if (rms < dynamicThreshold) {
          gain = Math.max(0, rms / dynamicThreshold);
          // Cubic curve for sharper cutoff
          gain = gain * gain * gain;
      }

      // Convert Float32 to Int16 with gain and soft clipping
      const int16Data = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        let s = channelData[i] * gain;
        s = Math.max(-1, Math.min(1, s));
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.port.postMessage(int16Data.buffer, [int16Data.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

export class AudioQueue {
  private audioContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  /** True when audio is currently being played through speakers */
  get isPlaying(): boolean {
    return this.activeSources.length > 0;
  }

  constructor() {
    // Initialize context only on user interaction if possible, or gracefully fallback
    if (typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 24000 }); // Gemini default response is 24kHz
    }
  }

  async resume() {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  playBase64PCM(base64: string, sampleRate = 24000) {
    if (!this.audioContext) return;
    
    // Resume context if needed
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const uint8Data = base64ToUint8Array(base64);
    const float32Data = pcm16ToFloat32(uint8Data);
    
    const audioBuffer = this.audioContext.createBuffer(1, float32Data.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Track active sources for stopping
    source.onended = () => {
      this.activeSources = this.activeSources.filter(s => s !== source);
    };
    this.activeSources.push(source);

    // Schedule gapless playback
    const currentTime = this.audioContext.currentTime;
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += audioBuffer.duration;
  }
  
  stop() {
    // Stop all currently playing audio chunks
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch {
        // Ignore if already stopped
      }
    });
    this.activeSources = [];
    
    // Reset next play time to current time
    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime;
    }
  }

  close() {
    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.close();
      }
      this.audioContext = null;
    }
  }
}

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  public onAudioData: ((base64Data: string) => void) | null = null;
  
  // Local VAD Callbacks
  public onSilence: (() => void) | null = null;
  public onSpeech: (() => void) | null = null;

  /** Set to true while bot audio is playing to suppress echo detection */
  public suppressVAD: boolean = false;

  private isSpeaking: boolean = false;
  private silenceMs: number = 0;
  private smoothedRms: number = 0;
  private readonly RMS_ALPHA = 0.1; // Smoothing factor for VAD RMS
  private readonly SILENCE_THRESHOLD = 1000; // Increased threshold for stability
  private readonly REQUIRED_SILENCE_MS = 1200; // Slightly longer wait to ensure turn completion

  get speaking(): boolean {
    return this.isSpeaking;
  }

  private audioBuffer: Int16Array[] = [];
  private audioBufferLength: number = 0;
  private readonly SEND_CHUNK_SIZE = 4096; // 4096 samples at 16kHz = 256ms

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.context = new AudioContextClass({ sampleRate: 16000 });
    
    const source = this.context.createMediaStreamSource(this.stream);
    
    // High-pass filter: 200Hz (blocks low-end rumble and mechanical noise)
    const hpFilter = this.context.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = 200;

    // Low-pass filter: 5000Hz (blocks high-end hiss where speech is minimal)
    const lpFilter = this.context.createBiquadFilter();
    lpFilter.type = 'lowpass';
    lpFilter.frequency.value = 5000;

    // Dynamics Compressor: Stabilizes input levels to help VAD and Noise Gate consistency
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 20;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    
    const blob = new Blob([AudioWorkletSrc], { type: 'application/javascript' });
    const blobURL = URL.createObjectURL(blob);
    
    await this.context.audioWorklet.addModule(blobURL);
    
    this.workletNode = new AudioWorkletNode(this.context, 'pcm-processor');
    this.workletNode.port.onmessage = (event) => {
      if (this.onAudioData) {
        const int16Array = new Int16Array(event.data);

        // Skip all VAD and audio sending while bot is speaking (echo suppression)
        if (this.suppressVAD) {
          this.isSpeaking = false;
          this.silenceMs = 0;
          this.smoothedRms = 0;
          return;
        }
        
        // VAD Logic (RMS calculation with smoothing)
        let sumSquares = 0;
        for (let i = 0; i < int16Array.length; i++) {
          sumSquares += int16Array[i] * int16Array[i];
        }
        const rms = Math.sqrt(sumSquares / int16Array.length);
        
        // EMA smoothing for RMS to avoid jitter
        this.smoothedRms = this.RMS_ALPHA * rms + (1 - this.RMS_ALPHA) * this.smoothedRms;
        
        const chunkDurationMs = (int16Array.length / 16000) * 1000;

        if (this.smoothedRms > this.SILENCE_THRESHOLD) {
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            if (this.onSpeech) this.onSpeech();
          }
          this.silenceMs = 0;
        } else {
          if (this.isSpeaking) {
            this.silenceMs += chunkDurationMs;
            if (this.silenceMs > this.REQUIRED_SILENCE_MS) {
              this.isSpeaking = false;
              if (this.onSilence) this.onSilence();
            }
          }
        }

        // Buffer audio to send larger chunks (reduces websocket latency overhead)
        this.audioBuffer.push(int16Array);
        this.audioBufferLength += int16Array.length;

        if (this.audioBufferLength >= this.SEND_CHUNK_SIZE) {
          const combined = new Int16Array(this.audioBufferLength);
          let offset = 0;
          for (const arr of this.audioBuffer) {
            combined.set(arr, offset);
            offset += arr.length;
          }
          const uint8Array = new Uint8Array(combined.buffer);
          const base64 = uint8ArrayToBase64(uint8Array);
          this.onAudioData(base64);

          // Reset buffer
          this.audioBuffer = [];
          this.audioBufferLength = 0;
        }
      }
    };

    source.connect(hpFilter);
    hpFilter.connect(lpFilter);
    lpFilter.connect(compressor);
    compressor.connect(this.workletNode);
    this.workletNode.connect(this.context.destination);
  }

  stop() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.context) {
      this.context.close();
      this.context = null;
    }
    this.isSpeaking = false;
    this.silenceMs = 0;
  }
}

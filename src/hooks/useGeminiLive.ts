import { useState, useRef, useCallback } from 'react';
import { AudioQueue, AudioRecorder } from '../utils/audioProcessing';
import { AYADI_SYSTEM_PROMPT } from '../constants/prompts';

const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-09-2025";
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

export function useGeminiLive() {
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
      audioRecorderRef.current = null;
    }
    if (audioQueueRef.current) {
      audioQueueRef.current.close();
      audioQueueRef.current = null;
    }
    setIsConnected(false);
    setIsSpeaking(false);
  }, []);

  const connect = useCallback(async () => {
    if (isConnected) return;
    
    if (!API_KEY) {
      console.error("Missing NEXT_PUBLIC_GEMINI_API_KEY environment variable.");
      return;
    }

    try {
      // Initialize audio tools
      audioQueueRef.current = new AudioQueue();
      await audioQueueRef.current.resume();
      
      audioRecorderRef.current = new AudioRecorder();
      
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = async () => {
        setIsConnected(true);

        // Send Initial Setup Message
        const configMessage = {
          setup: {
            model: `models/${MODEL_NAME}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Aoede", // Warm and friendly voice
                  }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: AYADI_SYSTEM_PROMPT }]
            }
          }
        };
        
        ws.send(JSON.stringify(configMessage));

        // Start microphone and attach callback
        await audioRecorderRef.current?.start();
        if (audioRecorderRef.current) {
           
           audioRecorderRef.current.onSilence = () => {
             // Let Gemini's server-side VAD handle response triggering.
             // Manual turnComplete injections currently cause API 1011 parsing errors.
             setIsSpeaking(false);
           };

           audioRecorderRef.current.onSpeech = () => {
              // User has started speaking — stop bot audio and re-enable mic
              audioQueueRef.current?.stop();
              setIsSpeaking(false);
              if (audioRecorderRef.current) {
                audioRecorderRef.current.suppressVAD = false;
              }
            };

           audioRecorderRef.current.onAudioData = (base64Data) => {
              // Always send audio to Gemini (its server-side VAD needs the stream)
              // But skip sending while bot is speaking (echo suppression)
              if (ws.readyState === WebSocket.OPEN && !audioRecorderRef.current?.suppressVAD) {
                ws.send(JSON.stringify({
                  realtimeInput: {
                    mediaChunks: [{
                      data: base64Data,
                      mimeType: 'audio/pcm;rate=16000'
                    }]
                  }
                }));
              }
            };
        }
      };

      ws.onmessage = async (event) => {
        // Handle Blob to text if needed
        let dataStr = event.data;
        if (dataStr instanceof Blob) {
          dataStr = await dataStr.text();
        } else if (typeof dataStr !== 'string') {
          console.warn('Received non-string data over WS', event.data);
          return;
        }

        try {
          const response = JSON.parse(dataStr);

          if (response.serverContent) {
            const serverContent = response.serverContent;
            
            // Check for Audio
            if (serverContent.modelTurn?.parts) {
              setIsSpeaking(true);
              // Suppress mic VAD while bot audio plays (echo suppression)
              if (audioRecorderRef.current) {
                audioRecorderRef.current.suppressVAD = true;
              }
              for (const part of serverContent.modelTurn.parts) {
                if (part.inlineData) {
                  // Play the received audio via our Queue
                  const audioData = part.inlineData.data;
                  audioQueueRef.current?.playBase64PCM(audioData, 24000);
                }
              }
            }

            // When the bot's turn is complete, re-enable mic after a short delay
            if (serverContent.turnComplete) {
              setTimeout(() => {
                setIsSpeaking(false);
                if (audioRecorderRef.current) {
                  audioRecorderRef.current.suppressVAD = false;
                }
              }, 300); // 300ms grace period for echo to fade
            }

            // Transcriptions
            if (serverContent.interrupted) {
                 audioQueueRef.current?.stop();
            }
          }
        } catch (err) {
          console.error("Failed to parse socket message", err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        disconnect();
      };

      ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
      };

    } catch (e: unknown) {
      console.error('Failed to start:', e);
      setIsConnected(false);
    }
  }, [isConnected, disconnect]);

  return {
    isConnected,
    isSpeaking,
    connect,
    disconnect
  };
}

"use client";

import React from 'react';
import { useGeminiLive } from '../hooks/useGeminiLive';

// Microphone SVG icon component
function MicIcon({ size = 40 }: { size?: number }) {
  return (
    <svg
      className="orb-mic-icon"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

// Equalizer bars icon for speaking state
function EqualizerBars() {
  return (
    <div className="equalizer-bars">
      <span className="eq-bar" style={{ animationDelay: '0s' }} />
      <span className="eq-bar" style={{ animationDelay: '0.15s' }} />
      <span className="eq-bar" style={{ animationDelay: '0.3s' }} />
      <span className="eq-dot" style={{ animationDelay: '0.1s' }} />
      <span className="eq-dot" style={{ animationDelay: '0.25s' }} />
      <span className="eq-dot" style={{ animationDelay: '0.35s' }} />
      <span className="eq-dot" style={{ animationDelay: '0.45s' }} />
      <span className="eq-bar" style={{ animationDelay: '0.45s' }} />
      <span className="eq-bar" style={{ animationDelay: '0.6s' }} />
    </div>
  );
}

// Volume icon for navbar
function VolumeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

// Reset icon for navbar
function ResetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

// Starfield component — renders only on client to avoid hydration mismatch
function Starfield() {
  const [stars, setStars] = React.useState<Array<{id: number; className: string; style: React.CSSProperties}>>([]);

  React.useEffect(() => {
    const result = [];
    for (let i = 0; i < 60; i++) {
      const types = ['', 'dim', 'bright'];
      const type = types[Math.floor(Math.random() * 3)];
      result.push({
        id: i,
        className: `star ${type}`,
        style: {
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 4}s`,
          animationDuration: `${3 + Math.random() * 4}s`,
        },
      });
    }
    setStars(result);
  }, []);

  return (
    <div className="starfield">
      {stars.map((star) => (
        <div key={star.id} className={star.className} style={star.style} />
      ))}
    </div>
  );
}

export default function VoiceChat() {
  const { isConnected, isSpeaking, connect, disconnect } = useGeminiLive();

  const handleOrbClick = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  const orbClasses = [
    'orb',
    isConnected ? 'active' : '',
    isSpeaking ? 'speaking' : '',
  ].filter(Boolean).join(' ');

  // Status text
  let statusLabel = 'Ready';
  let statusSub = 'TAP TO START SPEAKING';
  if (isConnected && isSpeaking) {
    statusLabel = 'Speaking...';
    statusSub = 'AI RESPONSE ACTIVE';
  } else if (isConnected) {
    statusLabel = 'Listening...';
    statusSub = 'VOICE INPUT ACTIVE';
  }

  return (
    <>
      <Starfield />

      {/* Navbar */}
      <nav className="navbar" id="navbar">
        <div className="navbar-brand">
          <div className="navbar-logo">A</div>
          <span className="navbar-title">AYABOT</span>
        </div>
        <div className="navbar-controls">
          <div className={`navbar-badge ${isConnected ? 'online' : 'offline'}`}>
            <span className="badge-dot" />
            {isConnected ? 'ONLINE' : 'OFFLINE'}
          </div>
          <button className="navbar-icon-btn" aria-label="Toggle volume" id="btn-volume">
            <VolumeIcon />
          </button>
          <button className="navbar-icon-btn" aria-label="Reset session" id="btn-reset" onClick={disconnect}>
            <ResetIcon />
          </button>
        </div>
      </nav>

      {/* Main Area */}
      <main className="main-container" id="main-content">
        <div className="glass-frame">
          {/* Corner decorations */}
          <div className="corner-tr" />
          <div className="corner-bl" />
          <div className="frame-dot top-left" />
          <div className="frame-dot top-right" />
          <div className="frame-dot bottom-left" />
          <div className="frame-dot bottom-right" />

          {/* Orb */}
          <div className="orb-wrapper">
            <div className="orb-ring-outer" />
            <div className="orb-ring-mid" />
            <div className="orb-ring-inner" />
            <div className={orbClasses} onClick={handleOrbClick} id="orb-button" role="button" tabIndex={0}>
              {isSpeaking ? <EqualizerBars /> : <MicIcon size={38} />}
            </div>
            <div className="orb-pulse-ring" />
          </div>

          {/* Status */}
          <div className="status-text">
            <div className={`status-label ${isConnected ? 'active' : ''} ${isSpeaking ? 'speaking' : ''}`}>{statusLabel}</div>
            <div className="status-sublabel">{statusSub}</div>
          </div>
        </div>
      </main>

      {/* Bottom CTA */}
      <div className="bottom-cta">
        <span className="cta-text">
          Ask me anything about <span className="cta-highlight">admissions</span>
        </span>
      </div>
    </>
  );
}

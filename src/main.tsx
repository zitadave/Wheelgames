import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Client-side console filter to suppress benign iframe/websocket/Telegram API logs and warnings
const originalWarn = console.warn;
const originalLog = console.log;
const originalError = console.error;

const noisyPatterns = [
  "not supported",
  "websocket",
  "Socket connection error",
  "Failed to fetch bot-info",
  "Haptic feedback failed",
  "VoiceCallerEngine",
  "Failed to generate secure share token",
  "Failed to initialize session",
  "failed to connect"
];

console.warn = function (...args) {
  const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" ");
  if (noisyPatterns.some(pattern => msg.toLowerCase().includes(pattern.toLowerCase()))) return;
  originalWarn.apply(console, args);
};

console.log = function (...args) {
  const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" ");
  if (noisyPatterns.some(pattern => msg.toLowerCase().includes(pattern.toLowerCase()))) return;
  originalLog.apply(console, args);
};

console.error = function (...args) {
  const msg = args.map(arg => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" ");
  if (noisyPatterns.some(pattern => msg.toLowerCase().includes(pattern.toLowerCase()))) return;
  originalError.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

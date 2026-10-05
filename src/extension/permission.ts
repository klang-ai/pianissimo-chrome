import '../style.css';
import type { SessionState } from '../session/types.ts';
const button = document.querySelector<HTMLButtonElement>('#allow')!;
const close = document.querySelector<HTMLButtonElement>('#close')!;
const status = document.querySelector<HTMLElement>('#permission-status')!;
let stream: MediaStream | undefined;
let port: chrome.runtime.Port | undefined;
let active = false,
  owned = false,
  began = false,
  closed = false,
  attempt = 0;
const release = () => {
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
};
function fail(message: string) {
  active = false;
  owned = false;
  release();
  status.textContent = message;
  button.textContent = 'Allow and record';
  button.disabled = false;
  close.hidden = false;
}
async function connect() {
  if (port) return;
  const ready = await chrome.runtime.sendMessage({ target: 'background', type: 'ensure-session' });
  if (!ready?.ok) throw new Error(ready?.error || 'Could not start Pianissimo.');
  if (closed) throw new DOMException('Closed', 'AbortError');
  const next = chrome.runtime.connect({ name: 'pianissimo-microphone' });
  port = next;
  next.onMessage.addListener((message) => {
    if (port !== next) return;
    if (message.type === 'error') {
      fail(message.message);
      return;
    }
    if (message.type !== 'state' || !active) return;
    const state = message.state as SessionState;
    owned = message.owned;
    if (owned) began = true;
    if (owned && state.phase === 'recording') {
      status.textContent = `Recording · ${Math.floor(state.elapsed / 60)}:${String(Math.floor(state.elapsed % 60)).padStart(2, '0')}. Keep this window open.`;
      button.textContent = 'Stop recording';
      button.disabled = false;
      close.hidden = true;
    } else if (owned && state.phase === 'stopping') {
      status.textContent = 'Finishing…';
      button.disabled = true;
    } else if (
      began &&
      !owned &&
      !['requesting-mic', 'recording', 'stopping'].includes(state.phase)
    ) {
      active = false;
      release();
      button.textContent = 'Allow and record';
      button.disabled = false;
      close.hidden = false;
      status.textContent = state.error || 'Recording finished. Your transcript is in Pianissimo.';
    }
  });
  next.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port !== next) return;
    port = undefined;
    if (!closed) fail('The recording connection closed. Try again.');
  });
}
button.addEventListener('click', async () => {
  if (active && owned) {
    button.disabled = true;
    port?.postMessage({ type: 'stop' });
    return;
  }
  const current = ++attempt;
  button.disabled = true;
  status.textContent = 'Choose microphone access in Chrome.';
  try {
    await connect();
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (closed || current !== attempt) {
      acquired.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = acquired;
    // Hold the granting stream and its top-level document for the complete
    // recording. A command ACK alone does not mean offscreen capture started.
    active = true;
    began = false;
    status.textContent = 'Starting recording…';
    port!.postMessage({ type: 'start' });
  } catch (error) {
    if (closed || current !== attempt) return;
    fail(
      error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access was not allowed. Choose Allow this time or Allow on every visit to record.'
        : error instanceof Error
          ? error.message
          : 'Could not open the microphone. Try again.',
    );
  }
});
close.addEventListener('click', () => window.close());
document.querySelector('#open-pianissimo')!.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ target: 'background', type: 'expand' }).catch(() => {
    status.textContent = 'Open Pianissimo from the toolbar.';
  });
});
window.addEventListener('pagehide', () => {
  closed = true;
  attempt++;
  release();
  port?.disconnect();
  port = undefined;
});

import { SessionController } from '../session/controller.ts';
import { BUS, type Command } from '../session/types.ts';
const controller = new SessionController();
const channel = new BroadcastChannel(BUS);
const completed = new Map<string, string | undefined>();
let wasRecording: boolean | undefined;
controller.subscribe((state) => {
  channel.postMessage({ type: 'state', state });
  // Runtime notifications keep the toolbar tooltip in sync without storing transcript data there.
  const recording = state.phase === 'recording' || state.phase === 'stopping';
  if (recording !== wasRecording) {
    wasRecording = recording;
    void chrome.runtime
      .sendMessage({ target: 'background', type: 'session-status', recording })
      .catch(() => {});
  }
});
channel.onmessage = (event) => {
  const message = event.data;
  if (message?.type !== 'command' || typeof message.id !== 'string') return;
  let error: string | undefined;
  if (completed.has(message.id)) error = completed.get(message.id);
  else {
    try {
      controller.command(message.command as Command);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
    completed.set(message.id, error);
    if (completed.size > 256) completed.delete(completed.keys().next().value!);
  }
  channel.postMessage({ type: 'state', state: controller.state });
  channel.postMessage({ type: 'ack', id: message.id, error });
};
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id === chrome.runtime.id && message?.target === 'session' && message.type === 'ping')
    respond({ ok: true });
});
window.addEventListener('pagehide', () => {
  controller.cancel();
  channel.close();
});

// A visible permission page keeps a one-time grant alive. Its port owns only
// the recording it started; closing an old page cannot stop a later session.
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== 'pianissimo-microphone' ||
    port.sender?.id !== chrome.runtime.id ||
    port.sender.url !== chrome.runtime.getURL('permission.html')
  )
    return;
  const owner = crypto.randomUUID();
  let connected = true;
  const send = (message: unknown) => {
    if (connected) {
      try {
        port.postMessage(message);
      } catch {
        /* Disconnected. */
      }
    }
  };
  const unsubscribe = controller.subscribe((state) =>
    send({ type: 'state', state, owned: controller.ownsCapture(owner) }),
  );
  port.onMessage.addListener((message) => {
    try {
      if (message?.type === 'start') controller.startAnchored(owner);
      else if (message?.type === 'stop') controller.stopAnchored(owner);
    } catch (error) {
      send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });
  port.onDisconnect.addListener(() => {
    connected = false;
    unsubscribe();
    controller.stopAnchored(owner);
  });
});

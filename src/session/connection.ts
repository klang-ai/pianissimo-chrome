import { BUS, type Command, type SessionConnection, type SessionState } from './types.ts';
export const inExtension = () => location.protocol === 'chrome-extension:';
export async function connectSession(
  onState: (state: SessionState) => void,
): Promise<SessionConnection> {
  if (!inExtension()) {
    const { SessionController } = await import('./controller.ts');
    const controller = new SessionController();
    const unsubscribe = controller.subscribe(onState);
    return {
      command: async (command) => controller.command(command),
      close: () => {
        unsubscribe();
        controller.cancel();
      },
    };
  }
  const channel = new BroadcastChannel(BUS);
  const pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  let instance = '',
    version = -1;
  channel.onmessage = (event) => {
    const data = event.data;
    if (data.type === 'state') {
      const state = data.state as SessionState;
      if (state.instance !== instance) {
        instance = state.instance;
        version = -1;
      }
      if (state.version >= version) {
        version = state.version;
        onState(state);
      }
    } else if (data.type === 'ack') {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timeout);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve();
    }
  };
  let ready;
  try {
    ready = await chrome.runtime.sendMessage({ target: 'background', type: 'ensure-session' });
  } catch (error) {
    channel.close();
    throw error;
  }
  if (!ready?.ok) {
    channel.close();
    throw new Error(ready?.error || 'Could not start the extension. Reload it and try again.');
  }
  const command = (command: Command): Promise<void> =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The session is not responding. Reopen Pianissimo.'));
      }, 10000);
      pending.set(id, { resolve, reject, timeout });
      channel.postMessage({ type: 'command', id, command });
    });
  try {
    await command({ type: 'snapshot' });
  } catch (error) {
    channel.close();
    throw error;
  }
  return {
    command,
    close: () => {
      channel.close();
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new DOMException('View closed', 'AbortError'));
      }
      pending.clear();
    },
  };
}

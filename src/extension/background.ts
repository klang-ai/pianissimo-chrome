let creating: Promise<void> | undefined;
async function ensureSession() {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    });
    if (!contexts.length)
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [
          chrome.offscreen.Reason.USER_MEDIA,
          chrome.offscreen.Reason.WORKERS,
          chrome.offscreen.Reason.BLOBS,
        ],
        justification: 'Keep audio capture and model inference running when the popup closes.',
      });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await chrome.runtime.sendMessage({ target: 'session', type: 'ping' }))?.ok) return;
      } catch {
        /* Initial page startup. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('The session could not start. Reopen Pianissimo.');
  })().finally(() => {
    creating = undefined;
  });
  return creating;
}
async function expand() {
  const url = chrome.runtime.getURL('index.html');
  const existing = (await chrome.tabs.query({})).find((tab) => tab.url === url);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const target = windows.find((window) => window.focused) ?? windows[0];
    if (target?.id !== undefined) {
      await chrome.tabs.create({ url, windowId: target.id });
      await chrome.windows.update(target.id, { focused: true });
    } else await chrome.windows.create({ url, type: 'normal' });
  }
}
async function microphonePermission() {
  const url = chrome.runtime.getURL('permission.html');
  const existing = (await chrome.tabs.query({})).find((tab) => tab.url === url);
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else
    await chrome.windows.create({ url, type: 'popup', width: 440, height: 340, focused: true });
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'background') return;
  const action = async () => {
    if (message.type === 'ensure-session') await ensureSession();
    else if (message.type === 'expand') await expand();
    else if (message.type === 'microphone-permission') await microphonePermission();
    else if (message.type === 'session-status')
      await chrome.action.setTitle({
        title: message.recording ? 'Pianissimo: recording. Open to stop.' : 'Pianissimo',
      });
    else throw new Error('Unknown extension command.');
    return { ok: true };
  };
  void action().then(respond, (error) => respond({ ok: false, error: error.message }));
  return true;
});

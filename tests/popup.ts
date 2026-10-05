import { expect, type BrowserContext, type CDPSession } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
/** Chrome action popups aren't exposed as Playwright Pages; attach to the actual target over CDP. */
export async function openPopup(
  context: BrowserContext,
  background: { evaluate(fn: () => Promise<void>): Promise<void> },
) {
  // Chrome can reject a reopen while the previous popup is still closing.
  await expect(async () => {
    await background.evaluate(async () => {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      const windowId = windows[0]!.id!;
      await chrome.windows.update(windowId, { focused: true });
      await chrome.action.openPopup({ windowId });
    });
  }).toPass({ timeout: 5000 });
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((t) => t.url.endsWith('/popup.html'));
  if (!target) throw new Error('Toolbar popup did not open.');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  });
  const popup = new Popup(cdp, sessionId, target.targetId);
  await popup.send('Runtime.enable');
  await popup.send('Log.enable');
  await expect.poll(() => popup.evaluate('document.readyState')).toBe('complete');
  await expect.poll(() => popup.evaluate('document.body.dataset.sessionConnected')).toBe('true');
  await expect
    .poll(() =>
      popup.evaluate(
        'document.querySelector("footer").getBoundingClientRect().bottom <= innerHeight + 1',
      ),
    )
    .toBe(true);
  return popup;
}
export class Popup {
  readonly errors: string[] = [];
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (reason: Error) => void }
  >();
  constructor(
    private cdp: CDPSession,
    private sessionId: string,
    private targetId: string,
  ) {
    cdp.on('Target.receivedMessageFromTarget', (event) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      if (message.method === 'Runtime.exceptionThrown')
        this.errors.push(
          message.params.exceptionDetails.exception?.description ??
            message.params.exceptionDetails.text,
        );
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error')
        this.errors.push(message.params.entry.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
        this.errors.push(
          message.params.args.map((arg: any) => arg.value ?? arg.description).join(' '),
        );
      const job = this.pending.get(message.id);
      if (!job) return;
      this.pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error.message));
      else job.resolve(message.result);
    });
  }
  async send(method: string, params: object = {}): Promise<any> {
    const id = ++this.next;
    const response = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    await this.cdp.send('Target.sendMessageToTarget', {
      sessionId: this.sessionId,
      message: JSON.stringify({ id, method, params }),
    });
    return response;
  }
  async evaluate(expression: string): Promise<any> {
    const output = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (output.exceptionDetails) throw new Error(output.exceptionDetails.text);
    return output.result.value;
  }
  async click(selector: string) {
    const point = await this.evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
  }
  text(selector: string): Promise<string> {
    return this.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
  }
  async close() {
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId });
    await expect
      .poll(async () => {
        const { targetInfos } = await this.cdp.send('Target.getTargets');
        return targetInfos.some((target) => target.targetId === this.targetId);
      })
      .toBe(false);
    await this.cdp.detach();
  }
  async screenshot(path: string) {
    const { data } = await this.send('Page.captureScreenshot');
    await writeFile(path, Buffer.from(data, 'base64'));
  }
}

export async function observeHost(context: BrowserContext) {
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((t) => t.url.endsWith('/offscreen.html'));
  if (!target) throw new Error('Offscreen host is missing.');
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  });
  const host = new Popup(cdp, sessionId, target.targetId);
  await host.send('Runtime.enable');
  await host.send('Log.enable');
  return host;
}

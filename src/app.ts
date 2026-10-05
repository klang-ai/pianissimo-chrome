import './style.css';
import { MODELS, getModel, downloadMegabytes, PARAKEET_LANGUAGES } from './core/model.ts';
import { exportTranscript } from './core/export.ts';
import { connectSession, inExtension } from './session/connection.ts';
import {
  initialState,
  isBusy,
  type Command,
  type SessionConnection,
  type SessionState,
} from './session/types.ts';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const load = el<HTMLButtonElement>('load'),
  record = el<HTMLButtonElement>('record'),
  cancel = el<HTMLButtonElement>('cancel');
const file = el<HTMLInputElement>('file'),
  language = el<HTMLSelectElement>('language'),
  quantization = el<HTMLSelectElement>('quantization');
const settings = el<HTMLDialogElement>('settings');
const sculpture = document.querySelector<HTMLElement>('.signal-sculpture')!;
// End the introduction permanently, including after clearing a transcript.
sculpture.addEventListener('animationend', (event) => {
  if (event.animationName === 'signal-intro') sculpture.classList.remove('is-intro');
});
if (matchMedia('(prefers-reduced-motion: reduce)').matches) sculpture.classList.remove('is-intro');
const liveTab = el<HTMLButtonElement>('live-tab'),
  fileTab = el<HTMLButtonElement>('file-tab');
let state = initialState(),
  connection: SessionConnection | undefined,
  mode: 'live' | 'file' = 'live';
let connected = false;
for (const model of MODELS) language.add(new Option(model.label, model.id));
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function error(message: string) {
  el('error').textContent = message;
  el('error').hidden = false;
}
async function command(value: Command) {
  try {
    if (!connection) throw new Error('The session is connecting. Try again.');
    await connection.command(value);
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'AbortError'))
      error(reason instanceof Error ? reason.message : String(reason));
  }
}
function render(next: SessionState) {
  document.body.dataset.sessionConnected = String(connected);
  const sourceChanged = next.source !== state.source;
  state = next;
  if (sourceChanged) {
    setMode(next.source);
    return;
  }
  const busy = isBusy(state.phase),
    recording = state.phase === 'recording';
  const fileBusy = ['decoding', 'transcribing'].includes(state.phase);
  const hasFile = state.source === 'file' && !!state.fileName;
  const captureActive = ['recording', 'requesting-mic', 'stopping'].includes(state.phase);
  load.disabled = !connected || busy || state.loaded;
  el('setup').hidden = state.loaded;
  language.disabled = !connected || busy;
  quantization.disabled = busy || state.loaded;
  const model = getModel(state.modelId);
  if (
    Array.from(quantization.options, (option) => option.value).join() !== model.quantizations.join()
  ) {
    quantization.replaceChildren(...model.quantizations.map((value) => new Option('', value)));
  }
  for (const option of quantization.options)
    option.textContent = `${option.value.toUpperCase()} · ${downloadMegabytes(model, option.value as 'int8' | 'int4')} MB`;
  language.value = state.modelId;
  quantization.value = state.quantization;
  el('download-size').textContent =
    `${downloadMegabytes(model, state.quantization)} MB on first download`;
  el('model-name').textContent = model.name;
  el('supported-languages').hidden = model.id !== 'parakeet-tdt-v3';
  el('language-list').textContent = PARAKEET_LANGUAGES.join(', ') + '.';
  const attribution = el<HTMLAnchorElement>('model-attribution');
  attribution.textContent =
    model.id === 'pianissimo-sv' ? 'Pianissimo by Klang' : 'Parakeet by NVIDIA';
  attribution.href =
    model.id === 'pianissimo-sv'
      ? 'https://huggingface.co/KlangAI/pianissimo-sv-onnx'
      : 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3';
  el<HTMLButtonElement>('unload').disabled = busy || !state.loaded;
  el<HTMLButtonElement>('clear-cache').disabled = !connected || busy;
  file.disabled = !state.loaded || busy;
  record.disabled = !state.loaded || (busy && !recording);
  record.querySelector('span')!.textContent = recording ? 'Stop recording' : 'Start recording';
  record.hidden = !state.loaded || (mode !== 'live' && !captureActive);
  cancel.hidden = !busy;
  liveTab.disabled = captureActive || fileBusy;
  fileTab.disabled = captureActive || fileBusy;
  el('status').textContent = recording
    ? `${state.lag > 5 ? 'Catching up' : 'Recording'} · ${time(state.elapsed)}`
    : state.status === 'Ready.'
      ? ''
      : state.status;
  el('metrics').textContent = state.result
    ? `${time(state.result.duration)} · ${state.result.words.length} words`
    : '';
  const progress = el<HTMLProgressElement>('progress');
  progress.hidden = !['loading', 'decoding', 'transcribing', 'clearing', 'stopping'].includes(
    state.phase,
  );
  if (state.progress === null) progress.removeAttribute('value');
  else progress.value = state.progress;
  el('error').textContent = state.error;
  el('error').hidden = !state.error;
  el('permission').hidden = !state.needsPermission || !inExtension();
  const area = document.querySelector<HTMLElement>('.transcript-area')!;
  const follow = area.scrollHeight - area.scrollTop - area.clientHeight < 60;
  el('committed').textContent = state.committed;
  el('draft').textContent = `${state.committed && state.draft ? ' ' : ''}${state.draft}`;
  el('welcome').hidden = !!(state.committed || state.draft);
  el('empty').hidden = !state.loaded || fileBusy;
  el('transcript').hidden = !(state.committed || state.draft);
  el('klang-discover').hidden = busy || !!state.error || !state.result?.text.trim();
  el('empty').textContent = recording
    ? 'Listening…'
    : mode === 'live'
      ? 'Start recording to transcribe.'
      : 'Choose a file to transcribe.';
  if (follow) area.scrollTop = area.scrollHeight;
  const hasText = !!(state.committed || state.draft);
  el<HTMLButtonElement>('copy').disabled = !hasText;
  el<HTMLButtonElement>('save').disabled = !state.result || busy;
  el<HTMLButtonElement>('reset').disabled = busy || !hasText;
  el('drop-zone').hidden = hasFile;
  el('file-summary').hidden = !hasFile;
  el('source-name').textContent = hasFile ? state.fileName : '';
  el('source-name').title = hasFile ? state.fileName : '';
  el('change-file').hidden = busy;
  el<HTMLButtonElement>('change-file').disabled = file.disabled;
  el('meter').classList.toggle('active', recording);
  el('meter').setAttribute('aria-valuenow', String(Math.round(state.level * 100)));
  el('meter').querySelector<HTMLElement>('span')!.style.width = `${state.level * 100}%`;
}
function setMode(value: 'live' | 'file') {
  mode = value;
  liveTab.setAttribute('aria-selected', String(value === 'live'));
  liveTab.tabIndex = value === 'live' ? 0 : -1;
  fileTab.setAttribute('aria-selected', String(value === 'file'));
  fileTab.tabIndex = value === 'file' ? 0 : -1;
  el('live-panel').hidden = value !== 'live';
  el('file-panel').hidden = value !== 'file';
  el('empty').textContent =
    value === 'live' ? 'Start recording to transcribe.' : 'Choose a file to transcribe.';
  render(state);
}
liveTab.addEventListener('click', () => setMode('live'));
fileTab.addEventListener('click', () => setMode('file'));
for (const tab of [liveTab, fileTab])
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? liveTab
        : event.key === 'End'
          ? fileTab
          : tab === liveTab
            ? fileTab
            : liveTab;
    if (!next.disabled) {
      setMode(next === liveTab ? 'live' : 'file');
      next.focus();
    }
  });
el('settings-open').addEventListener('click', () => settings.showModal());
el('settings-close').addEventListener('click', () => settings.close());
quantization.addEventListener('change', () => {
  state = { ...state, quantization: quantization.value as 'int8' | 'int4' };
  render(state);
});
language.addEventListener(
  'change',
  () => void command({ type: 'select-model', modelId: language.value }),
);
load.addEventListener(
  'click',
  () =>
    void command({
      type: 'load',
      modelId: language.value,
      quantization: quantization.value as 'int8' | 'int4',
    }),
);
record.addEventListener(
  'click',
  () => void command({ type: state.phase === 'recording' ? 'stop' : 'start' }),
);
cancel.addEventListener('click', () => void command({ type: 'cancel' }));
el('unload').addEventListener('click', () => {
  settings.close();
  void command({ type: 'unload' });
});
el('clear-cache').addEventListener('click', () => {
  settings.close();
  void command({ type: 'clear-cache' });
});
el('reset').addEventListener('click', () => void command({ type: 'reset' }));
el('change-file').addEventListener('click', () => file.click());
file.addEventListener('change', () => {
  const selected = file.files?.[0];
  if (selected) void command({ type: 'file', file: selected });
  file.value = '';
});
const drop = el('drop-zone');
drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (!file.disabled) drop.classList.add('dragover');
});
drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('dragover');
  const selected = event.dataTransfer?.files[0];
  if (selected && !file.disabled) void command({ type: 'file', file: selected });
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());
el('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(
      `${state.committed}${state.committed && state.draft ? ' ' : ''}${state.draft}`,
    );
    el('status').textContent = 'Copied.';
  } catch {
    error('Could not copy. Select the text and use your keyboard shortcut.');
  }
});
el('save').addEventListener('click', () => {
  if (!state.result) return;
  const format = el<HTMLSelectElement>('format').value as 'txt' | 'json' | 'srt' | 'vtt';
  const content = exportTranscript(state.result, format);
  const url = URL.createObjectURL(
    new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8',
    }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(state.fileName || 'Pianissimo').replace(/\.[^.]+$/u, '').replace(/[^\p{L}\p{N}\s._-]/gu, '_')}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
el('expand').addEventListener('click', async () => {
  try {
    if (inExtension()) {
      const reply = await chrome.runtime.sendMessage({ target: 'background', type: 'expand' });
      if (!reply?.ok) error(reply?.error || 'Could not open the expanded view.');
      else if (document.body.classList.contains('popup')) window.close();
    } else {
      document.body.className = 'expanded';
    }
  } catch {
    error('Could not open the expanded view. Try again.');
  }
});
el('permission').addEventListener('click', async () => {
  try {
    const reply = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'microphone-permission',
    });
    if (!reply?.ok) error(reply?.error || 'Could not open microphone settings.');
  } catch {
    error('Could not open microphone settings. Try again.');
  }
});
window.addEventListener('pagehide', () => connection?.close());
if (!inExtension())
  window.addEventListener('beforeunload', (event) => {
    if (isBusy(state.phase)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
render(state);
void connectSession(render).then(
  (value) => {
    connection = value;
    connected = true;
    render(state);
  },
  (reason) => error(reason instanceof Error ? reason.message : String(reason)),
);

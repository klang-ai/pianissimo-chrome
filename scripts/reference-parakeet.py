"""Generate native Parakeet references using the exact pinned ONNX preprocessor."""
import json
from pathlib import Path
import time
import onnx_asr
import onnxruntime as ort

root = Path('.models/parakeet-tdt-v3')
class PinnedPreprocessor:
    def __init__(self):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        self.session = ort.InferenceSession(str(root / 'nemo128.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    def __call__(self, waveforms, waveforms_lens):
        return self.session.run(['features', 'features_lens'], {'waveforms': waveforms, 'waveforms_lens': waveforms_lens})

model = onnx_asr.load_model('nemo-conformer-tdt', str(root), quantization='int8', providers=['CPUExecutionProvider'])
model.asr._preprocessor = PinnedPreprocessor()
fixtures = Path('tests/fixtures/multilingual')
rows = json.loads((fixtures / 'fleurs.json').read_text())['rows']
results = {}
for row in rows + [{'file': '../silence.wav', 'language': 'silence', 'text': ''}]:
    start = time.monotonic()
    text = model.recognize(str(fixtures / row['file']))
    results[row['file']] = {'text': text, 'seconds': time.monotonic() - start}
    print(row['language'], text, flush=True)
(fixtures / 'reference-parakeet.json').write_text(json.dumps(results, indent=2, ensure_ascii=False) + '\n')

"""Generate pinned CPU reference transcripts for the integration fixtures."""
import json
from pathlib import Path
import time
import onnx_asr
import onnxruntime as ort

class PinnedPreprocessor:
    def __init__(self):
        self.session = ort.InferenceSession(".models/nemo128.onnx", providers=["CPUExecutionProvider"])
    def __call__(self, waveforms, waveforms_lens):
        return self.session.run(["features", "features_lens"], {"waveforms": waveforms, "waveforms_lens": waveforms_lens})


fixtures = ['swedish.wav', 'silence.wav'] + [x['file'] for x in json.loads(Path('tests/fixtures/fleurs.json').read_text())]
for quantization in ['int8', 'int4']:
    model = onnx_asr.load_model('nemo-conformer-tdt', '.models', quantization=quantization, providers=['CPUExecutionProvider'])
    model.asr._preprocessor = PinnedPreprocessor()
    results = {}
    for fixture in fixtures:
        start = time.monotonic()
        text = model.recognize(str(Path('tests/fixtures') / fixture))
        results[fixture] = {'text': text, 'seconds': time.monotonic() - start}
        print(quantization, fixture, text, flush=True)
    Path(f'tests/fixtures/reference-{quantization}.json').write_text(json.dumps(results, indent=2, ensure_ascii=False) + '\n')

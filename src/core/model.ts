import type { Quantization } from './types.ts';
export const MODEL = 'KlangAI/pianissimo-sv-onnx' as const;
export const REVISION = '63730c6021234f26b9bbae9a07a04fec39e7a52e';
export const MODEL_BASE = `https://huggingface.co/${MODEL}/resolve/${REVISION}/`;
export const CACHE_DIRECTORY = `pianissimo-${REVISION}`;
export interface Asset {
  name: string;
  bytes: number;
  sha256: string;
}
const files: Record<string, Omit<Asset, 'name'>> = {
  'encoder-model.int8.onnx': {
    bytes: 630313965,
    sha256: '13288a5f4f009bf6bf8a3260044d098f6922e8caf1c564521d4962fa5749f66c',
  },
  'decoder_joint-model.int8.onnx': {
    bytes: 30025652,
    sha256: '0f9213242acd8874f2717c5e3cdb888d4e7673ddf3abb9ee3a2fd2eaf0acdd03',
  },
  'encoder-model.int4.onnx': {
    bytes: 486421211,
    sha256: '689b18b1c58df738e4a309757a817f4a8fcdad8e99d770f6810b3449be95b729',
  },
  'decoder_joint-model.int4.onnx': {
    bytes: 28378227,
    sha256: 'bf9b99051419623751e34d542c0076ab50f84bbde4f68f095850b2d4cefdafcd',
  },
  'nemo128.onnx': {
    bytes: 138824,
    sha256: '5b4a84c52eeaa615dc46d781cc7e4598f9b432184831d57493c48adcd01371a9',
  },
  'vocab.txt': {
    bytes: 93939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
  },
};
export function assetsFor(quantization: Quantization): Asset[] {
  if (quantization !== 'int8' && quantization !== 'int4') throw new Error('Unknown model variant.');
  return [
    `encoder-model.${quantization}.onnx`,
    `decoder_joint-model.${quantization}.onnx`,
    'nemo128.onnx',
    'vocab.txt',
  ].map((name) => ({ name, ...files[name]! }));
}

export const DANISH_MODEL = 'KlangAI/pianissimo-da-onnx' as const;
export const DANISH_REVISION = 'main';
const danishFiles: Record<string, Omit<Asset, 'name'>> = {
  'encoder-model.int8.onnx': {
    bytes: 630313965,
    sha256: 'c24b31ad20d0ca17f7fda376edd36f2c3384fe3da2d55f25986a5cb190c7753d',
  },
  'decoder_joint-model.int8.onnx': {
    bytes: 53639765,
    sha256: '90035d9a36a8fb3aacb6ae5ce8bf03c1505566fae0b35ec5306d36bc9078655a',
  },
  'encoder-model.int4.onnx': {
    bytes: 496353006,
    sha256: 'a2d06f139e59d790d828bffa1cb00f2460a2e65333f624bd7b5072483fdb2b97',
  },
  'decoder_joint-model.int4.onnx': {
    bytes: 28480554,
    sha256: '00c67576b8379cfeffd38a8dac2666ac9af523702de719dbc9d49820b4f1c03e',
  },
  'nemo128.onnx': {
    bytes: 138824,
    sha256: '5b4a84c52eeaa615dc46d781cc7e4598f9b432184831d57493c48adcd01371a9',
  },
  'vocab.txt': {
    bytes: 93939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
  },
};
function danishAssets(quantization: Quantization): Asset[] {
  if (quantization !== 'int8' && quantization !== 'int4') throw new Error('Unknown model variant.');
  return [
    `encoder-model.${quantization}.onnx`,
    `decoder_joint-model.${quantization}.onnx`,
    'nemo128.onnx',
    'vocab.txt',
  ].map((name) => ({ name, ...danishFiles[name]! }));
}

export const PARAKEET_REVISION = '8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce';
const parakeetFiles: Record<string, Omit<Asset, 'name'>> = {
  'encoder-model.int8.onnx': {
    bytes: 652183999,
    sha256: '6139d2fa7e1b086097b277c7149725edbab89cc7c7ae64b23c741be4055aff09',
  },
  'decoder_joint-model.int8.onnx': {
    bytes: 18202004,
    sha256: 'eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70',
  },
  'nemo128.onnx': {
    bytes: 139764,
    sha256: 'a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f',
  },
  'vocab.txt': {
    bytes: 93939,
    sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d',
  },
};
function parakeetAssets(quantization: Quantization): Asset[] {
  if (quantization !== 'int8') throw new Error('Parakeet is available in INT8.');
  return [
    'encoder-model.int8.onnx',
    'decoder_joint-model.int8.onnx',
    'nemo128.onnx',
    'vocab.txt',
  ].map((name) => ({ name, ...parakeetFiles[name]! }));
}
/** NVIDIA's published v3 language coverage. The model detects language; it has no language prompt. */
export const PARAKEET_LANGUAGES = [
  'Bulgarian',
  'Croatian',
  'Czech',
  'Danish',
  'Dutch',
  'English',
  'Estonian',
  'Finnish',
  'French',
  'German',
  'Greek',
  'Hungarian',
  'Italian',
  'Latvian',
  'Lithuanian',
  'Maltese',
  'Polish',
  'Portuguese',
  'Romanian',
  'Russian',
  'Slovak',
  'Slovenian',
  'Spanish',
  'Swedish',
  'Ukrainian',
] as const;
interface ModelDefinition {
  id: string;
  language: string | undefined;
  label: string;
  name: string;
  repo: string;
  revision: string;
  baseUrl: string;
  cacheDirectory: string;
  durationBins: number;
  quantizations: readonly Quantization[];
  assets: (quantization: Quantization) => Asset[];
}
/** Entries use 16 kHz audio, 128-bin preprocessing and an 80 ms TDT frame stride. */
export const MODELS: readonly ModelDefinition[] = [
  {
    id: 'pianissimo-sv',
    language: 'sv',
    label: 'Swedish',
    name: 'Pianissimo',
    repo: MODEL,
    revision: REVISION,
    baseUrl: MODEL_BASE,
    cacheDirectory: CACHE_DIRECTORY,
    durationBins: 5,
    quantizations: ['int8', 'int4'],
    assets: assetsFor,
  },
  {
    id: 'pianissimo-da',
    language: 'da',
    label: 'Danish',
    name: 'Pianissimo',
    repo: DANISH_MODEL,
    revision: DANISH_REVISION,
    baseUrl: `https://huggingface.co/${DANISH_MODEL}/resolve/${DANISH_REVISION}/`,
    cacheDirectory: `pianissimo-da-${DANISH_REVISION}`,
    durationBins: 5,
    quantizations: ['int8', 'int4'],
    assets: danishAssets,
  },
  {
    id: 'parakeet-tdt-v3',
    language: undefined,
    label: 'Multilingual · Parakeet',
    name: 'Parakeet TDT v3',
    repo: 'istupakov/parakeet-tdt-0.6b-v3-onnx',
    revision: PARAKEET_REVISION,
    baseUrl: `https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/${PARAKEET_REVISION}/`,
    cacheDirectory: `parakeet-${PARAKEET_REVISION}`,
    durationBins: 5,
    quantizations: ['int8'],
    assets: parakeetAssets,
  },
];
export function getModel(id: string = 'pianissimo-sv'): ModelDefinition {
  const model = MODELS.find((model) => model.id === id);
  if (!model) throw new Error('This language model is not available.');
  return model;
}
export function downloadMegabytes(model: ModelDefinition, quantization: Quantization): number {
  return Math.round(
    model.assets(quantization).reduce((total, asset) => total + asset.bytes, 0) / 1e6,
  );
}

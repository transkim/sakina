"""Generate a spoken Arabic clip for every dua with the open-source Piper TTS.

Runs in CI (needs internet for the voice model). Usage:
  node -e "console.log(JSON.stringify(require('./app/js/duas.js')))" > duas.json
  python3 tools/gen-dua-audio.py duas.json <voice.onnx> app/audio/duas
Writes <id>.wav files; the workflow converts them to small .mp3 files.
"""
import json, os, re, sys, wave

from piper import PiperVoice

src, model, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
data = json.load(open(src, encoding='utf-8'))
voice = PiperVoice.load(model)

# Qur'anic pause and verse-end marks are not spoken
MARKS = re.compile('[ۖ-۝۞۩]')

def speak(text, path):
    text = MARKS.sub(' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    with wave.open(path, 'wb') as w:
        if hasattr(voice, 'synthesize_wav'):  # piper-tts >= 1.3
            from piper import SynthesisConfig
            voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=1.15))
        else:  # piper-tts 1.2
            voice.synthesize(text, w, length_scale=1.15, sentence_silence=0.35)

items = [(d['id'], d['ar']) for d in data['duas']] + [('dhikr-' + z['id'], z['ar']) for z in data['dhikr']]
for key, ar in items:
    path = os.path.join(out, key + '.wav')
    speak(ar, path)
    with wave.open(path) as w:
        secs = w.getnframes() / w.getframerate()
    print(f'{key}: {secs:.1f}s')
    if secs < 0.4:
        sys.exit(f'{key} came out empty')
print('generated', len(items))

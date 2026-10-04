# Intelligent Audio Signal Processing Suite

A collection of four **CM3065 Intelligent Signal Processing** projects from the University of London BSc Computer Science programme. The repository explores browser-based audio processing, intelligent audio interaction, ultrasonic signal analysis, audio steganography, and multilingual automatic speech recognition.

## Projects

### 1. Browser Audio Workstation
`exercise-1-audio-workstation/`

A p5.js / Web Audio application for loading, recording, organising and processing audio. It includes a persistent slot-based library, IndexedDB storage, effect settings, recording, filtering and input/output spectrum visualisation.

Key ideas include:
- browser audio file import and recording
- low-pass filtering, distortion, compression and reverb
- gain control and effect persistence
- FFT-based input/output visualisation
- IndexedDB and localStorage persistence
- reusable audio-processing chains

> The original coursework preset WAV files for this exercise were not present in the recovered submission ZIP. The application still supports user-imported and recorded audio; preset filenames can be replaced with local WAV files if required.

### 2. Audio CAPTCHA & Intelligent Music Visualiser
`exercise-2-audio-captcha-visualizer/`

An interactive p5.js audio application combining an audio CAPTCHA, real-time music visualisation and voice-controlled visual changes.

Key ideas include:
- spoken CAPTCHA generation with a noise bed
- waveform/frequency visual feedback
- real-time audio feature extraction
- RMS and spectral-centroid driven visuals
- speech-recognition commands for colours and shapes
- selectable music tracks

### 3. Ultrasonic Audio Analysis & Steganography
`exercise-3-audio-steganography/`

A Jupyter notebook project for analysing hidden/high-frequency audio content and embedding text inside WAV files.

Key ideas include:
- STFT-based ultrasonic-band analysis
- carrier-frequency estimation
- AM demodulation and FIR low-pass filtering
- 16-bit PCM handling
- sequential 1-bit LSB steganography
- pseudo-random 2-bit LSB embedding using a key
- gap/repetition embedding for robustness
- CRC32 integrity checking

### 4. Multilingual Speech Recognition & WER Evaluation
`exercise-4-multilingual-speech-recognition/`

A Vosk-based speech-recognition pipeline for English, Italian and Spanish audio.

Key ideas include:
- mono/16 kHz speech preprocessing
- Butterworth speech-band filtering
- offline multilingual ASR with Vosk
- batch transcription
- Word Error Rate (WER) calculation
- substitution, insertion and deletion analysis
- CSV export of evaluation results

## Technologies

- JavaScript
- p5.js / p5.sound
- Web Audio API
- IndexedDB
- Jupyter Notebook / Python
- NumPy / SciPy
- Librosa / SoundFile
- Matplotlib
- Vosk

## Running the Browser Exercises

Serve the relevant exercise directory with a local server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. Microphone and speech features may require browser permission and a secure/local context.

## Running the Python Exercises

Create a Python environment and install:

```bash
pip install -r requirements.txt
```

Then open the notebooks with Jupyter.

For the multilingual ASR exercise, Vosk language models are intentionally not stored in Git. Place compatible models under the exercise directory as:

```text
models/
├── model-en/
├── model-es/
└── model-it/
```

## Coursework Context

This repository is a cleaned portfolio version of the original CM3065 coursework. macOS metadata, notebook checkpoints and large model files are excluded. The implementation files and supplied/recovered audio examples have been retained where practical.

## Author

**Abdullah Humayun**  
BSc Computer Science – University of London / Goldsmiths

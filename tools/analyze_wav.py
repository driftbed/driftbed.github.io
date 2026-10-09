#!/usr/bin/env python3
from __future__ import annotations
import json, math, sys, wave
from pathlib import Path
import numpy as np

def read_wav(path: Path):
    with wave.open(str(path), 'rb') as w:
        sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels(); sw = w.getsampwidth()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, dtype='<i2').astype(np.float64) / 32768.0
    elif sw == 4:
        x = np.frombuffer(raw, dtype='<i4').astype(np.float64) / 2147483648.0
    else:
        raise ValueError(f'unsupported sample width: {sw}')
    return sr, x.reshape(-1, ch)

def db(x): return 20 * math.log10(max(float(x), 1e-15))

def analyze(path: Path):
    sr, x = read_wav(path)
    mono = x.mean(axis=1)
    rms = math.sqrt(float(np.mean(x*x)))
    peak = float(np.max(np.abs(x)))
    corr = float(np.corrcoef(x[:,0], x[:,1])[0,1]) if x.shape[1] >= 2 else 1.0
    nfft = 65536
    if len(mono) < nfft: nfft = 2 ** int(math.floor(math.log2(max(1024,len(mono)))))
    # average spectra over evenly-spaced windows
    positions = np.linspace(0, max(0, len(mono)-nfft), num=min(12, max(1, len(mono)//nfft)), dtype=int)
    p = np.zeros(nfft//2+1)
    win = np.hanning(nfft)
    for pos in positions:
        s = mono[pos:pos+nfft]
        if len(s) < nfft: s = np.pad(s, (0,nfft-len(s)))
        spec = np.fft.rfft(s*win)
        p += np.abs(spec)**2
    p /= len(positions)
    f = np.fft.rfftfreq(nfft, 1/sr)
    total = float(p.sum()) or 1.0
    bands = [(20,60),(60,120),(120,250),(250,500),(500,1000),(1000,4000),(4000,12000)]
    band_energy = {f'{lo}-{hi}Hz': float(p[(f>=lo)&(f<hi)].sum()/total) for lo,hi in bands}
    centroid = float((f*p).sum()/total)
    # 100 ms frame RMS variation
    hop=max(1,int(sr*.1)); vals=[]
    for i in range(0,len(mono),hop):
        s=mono[i:i+hop]
        if len(s): vals.append(db(math.sqrt(float(np.mean(s*s)))))
    p5,p50,p95=np.percentile(vals,[5,50,95])
    return {
        'file': path.name, 'sampleRate': sr, 'channels': int(x.shape[1]), 'durationSeconds': len(x)/sr,
        'rmsDbfs': db(rms), 'peakDbfs': db(peak), 'lrCorrelation': corr,
        'spectralCentroidHz': centroid, 'bandEnergyFraction': band_energy,
        'frameRmsDbfs': {'p05':float(p5),'median':float(p50),'p95':float(p95),'p95MinusP05':float(p95-p5)}
    }

if __name__ == '__main__':
    paths = [Path(p) for p in sys.argv[1:]]
    print(json.dumps([analyze(p) for p in paths], indent=2))

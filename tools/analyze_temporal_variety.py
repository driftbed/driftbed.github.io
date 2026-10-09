#!/usr/bin/env python3
from __future__ import annotations
import json, math, sys, wave
from pathlib import Path
import numpy as np

def read_wav(path: Path):
    with wave.open(str(path), 'rb') as w:
        sr=w.getframerate(); n=w.getnframes(); ch=w.getnchannels(); sw=w.getsampwidth(); raw=w.readframes(n)
    if sw != 2: raise ValueError('expected 16-bit PCM WAV')
    x=np.frombuffer(raw,dtype='<i2').astype(np.float64)/32768.0
    return sr,x.reshape(-1,ch)

def db(x): return 20*math.log10(max(float(x),1e-15))

def analyze(path: Path, seconds=4.0):
    sr,x=read_wav(path); mono=x.mean(axis=1); win=max(1,int(sr*seconds)); rows=[]
    for start in range(0,len(mono),win):
        y=mono[start:min(len(mono),start+win)]
        if len(y)<sr: continue
        nfft=1 << int(math.floor(math.log2(min(len(y),65536))))
        z=y[:nfft]*np.hanning(nfft); p=np.abs(np.fft.rfft(z))**2; f=np.fft.rfftfreq(nfft,1/sr); total=float(p.sum()) or 1
        rows.append({
            'startSeconds': start/sr,
            'rmsDbfs': db(math.sqrt(float(np.mean(y*y)))),
            'spectralCentroidHz': float((f*p).sum()/total),
            'energy120to250': float(p[(f>=120)&(f<250)].sum()/total),
            'energy250to500': float(p[(f>=250)&(f<500)].sum()/total),
        })
    def stats(key):
        vals=np.array([r[key] for r in rows],dtype=float)
        return {'min':float(vals.min()),'max':float(vals.max()),'range':float(vals.max()-vals.min()),'std':float(vals.std())}
    return {'file':path.name,'windowSeconds':seconds,'windows':rows,'rmsDbfs':stats('rmsDbfs'),'spectralCentroidHz':stats('spectralCentroidHz'),'energy120to250':stats('energy120to250'),'energy250to500':stats('energy250to500')}

if __name__=='__main__':
    print(json.dumps([analyze(Path(p)) for p in sys.argv[1:]],indent=2))

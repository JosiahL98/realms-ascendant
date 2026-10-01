"""Original trailer score: synthesized strings, horns, war drums and sound design.
No downloaded recordings or third-party music samples. Requires numpy and scipy.
"""
from pathlib import Path
import math
import wave
import numpy as np
from scipy.signal import butter, sosfilt

RATE = 48000
LENGTH = 46
OUT = Path('output/trailer/work')
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(216)
mix = np.zeros((RATE * LENGTH, 2), dtype=np.float64)
music = np.zeros_like(mix)

def lowpass(a, hz):
    return sosfilt(butter(2, hz, fs=RATE, output='sos'), a)

def highpass(a, hz):
    return sosfilt(butter(2, hz, fs=RATE, btype='highpass', output='sos'), a)

def env(t, dur, attack=.03, release=.2):
    return np.minimum(1, t/attack) * np.minimum(1, np.maximum(0,(dur-t)/release))

def add(a, at, gain=1, pan=0, bus=music):
    start = round(at*RATE)
    if start < 0: a=a[-start:]; start=0
    count=min(len(a),len(bus)-start)
    if count<=0: return
    a=a[:count]*gain
    bus[start:start+count,0]+=a*math.sqrt((1-pan)/2)
    bus[start:start+count,1]+=a*math.sqrt((1+pan)/2)

def hz(note): return 440*2**((note-69)/12)

def strings(note,dur,short=False):
    t=np.arange(round(dur*RATE))/RATE
    f=hz(note)
    vibrato=.003*np.sin(2*np.pi*5.2*t)
    y=np.zeros_like(t)
    # Slightly detuned bowed sections, with a soft harmonic roll-off.
    for detune,phase in [(-.0021,.31),(.0018,1.79),(0,2.1)]:
        p=2*np.pi*f*(1+detune)*t+vibrato+phase
        for k in range(1,11): y+=np.sin(p*k)/(k**1.35)*(.8 if k>5 else 1)
    y/=4
    y+=lowpass(rng.normal(0,.02,len(t)),2300)
    y*=env(t,dur,.018 if short else .32,.08 if short else .7)
    if short:y*=np.exp(-t*3.2)
    return y

def horn(note,dur):
    t=np.arange(round(dur*RATE))/RATE
    f=hz(note)
    p=2*np.pi*f*t+.008*np.sin(2*np.pi*4.7*t)
    y=sum(np.sin(p*k+.08*k)/(k**1.12) for k in range(1,13))
    y=lowpass(y,2400)/2
    return y*env(t,dur,.13,.45)*(.82+.18*np.exp(-t*3))

def drum(at,heavy=False,pan=0,gain=1):
    dur=1.8 if heavy else .8;t=np.arange(round(dur*RATE))/RATE
    f0=42 if heavy else 76
    phase=2*np.pi*(f0*t+(38 if heavy else 75)*.028*(1-np.exp(-t/.028)))
    body=np.sin(phase)*np.exp(-t/(.55 if heavy else .21))
    body+=.25*np.sin(phase*1.57)*np.exp(-t/.12)
    hit=lowpass(rng.normal(0,1,len(t)),1400)*np.exp(-t/.035)*.32
    y=np.tanh((body+hit)*1.3)*env(t,dur,.001,.12)
    add(y,at,.59*gain if heavy else .31*gain,pan)

def snare(at,gain=.11,pan=.1):
    t=np.arange(round(.45*RATE))/RATE
    n=highpass(lowpass(rng.normal(0,1,len(t)),6000),700)
    y=n*np.exp(-t/.085)+.23*np.sin(2*np.pi*180*t)*np.exp(-t/.055)
    add(y,at,gain,pan)

def cymbal(at,gain=.07,dur=2):
    t=np.arange(round(dur*RATE))/RATE
    y=highpass(rng.normal(0,1,len(t)),6500)
    add(y*np.exp(-t/.8)*env(t,dur,.008,.3),at,gain,-.3)

def impact(at,gain=1):
    drum(at,True,gain=gain)
    t=np.arange(round(2.5*RATE))/RATE
    noise=lowpass(rng.normal(0,1,len(t)),2600)*np.exp(-t/.4)
    add(noise,at,.2*gain,.2)
    cymbal(at,.11*gain,2.5)

def rise(start,dur,gain=.12):
    t=np.arange(round(dur*RATE))/RATE
    y=highpass(rng.normal(0,1,len(t)),1900)*(t/dur)**2
    y+=.14*np.sin(2*np.pi*(75*t+150*t*t/dur))*(t/dur)**2
    add(y*env(t,dur,.4,.03),start,gain,-.15)

# Quiet, ominous opening: open fifths, metallic distant bells, burning embers.
for note,gain,pan in [(38,.095,-.35),(45,.065,.35),(50,.04,0)]:
    add(strings(note,10.4),0,gain,pan)
for at,note in [(0,74),(1.5,69),(3.5,75),(5,74),(7,69)]:
    t=np.arange(3*RATE)/RATE
    bell=(np.sin(2*np.pi*hz(note)*t)+.18*np.sin(2*np.pi*hz(note)*2.73*t))*np.exp(-t/1.1)*env(t,3,.002,.3)
    add(bell,at,.095,(-1 if at%2 else 1)*.4)
impact(3.5,.78);drum(7,True,gain=.6);rise(7,3,.15)

# Eight four-second phrases at 120 BPM, rising from sparse to full orchestration.
roots=[38,34,43,45,38,34,43,45]  # D minor, B-flat, G minor, A dominant.
for bar in range(8):
    start=10+bar*4
    root=roots[bar]
    third=4 if root in [34,45] else 3
    chord=[root,root+7,root+12,root+12+third]
    density=.65+.35*min(bar/5,1)
    for j,note in enumerate(chord):
        add(strings(note,4.4),start,.072*density,(j-1.5)*.32)
    if bar>=2:
        for j,note in enumerate([root+12,root+12+third,root+19]):
            add(horn(note,1.7),start,.078*density,(j-1)*.2)
    figure=[0,7,12,7,third+12,7,12,7]
    for k in range(16):
        note=root+12+figure[k%8]
        add(strings(note,.3,True),start+k*.25,.062*density,(-.55 if k%2 else .55))
    # Syncopated toms give the march forward motion between the main impacts.
    for k in range(8):
        at=start+k*.5
        if at>=40:continue
        drum(at,k%4==0,pan=(-.35 if k%2 else .35),gain=density*(1 if k%2==0 else .55))
        if k%2:snare(at,.11*density)
        if bar>=3:
            drum(at+.25,False,pan=.4,gain=.25*density)
            cymbal(at+.25,.013,.3)
    if start<40:cymbal(start,.09)

# A melody enters above the action; the final A resolves into the title's D minor.
melody=[(22,74,1),(23,77,1),(24,81,1.5),(26,79,1),(27,77,1),(28,74,1.7),
        (30,70,1),(31,74,1),(32,77,1.6),(34,76,1),(35,73,1),(36,69,2),(38,81,1.6)]
for at,note,dur in melody:
    add(horn(note,dur),at,.083,0)
    add(strings(note-12,dur),at,.062,.35)
for at in [10,14,18,22,26,30,34]:impact(at,.55 if at<22 else .8)
rise(37.5,2.5,.16)
# Brief breath before the final hit makes the title landing audible.
music[int(39.75*RATE):int(40*RATE)]*=np.linspace(1,.08,int(.25*RATE))[:,None]
impact(40,1.25)
for note,gain,pan in [(38,.17,-.3),(45,.095,.3),(50,.105,-.15),(53,.095,.15),(62,.03,0)]:
    add(strings(note,5.8),40,gain,pan)
    add(horn(note,3.8),40,gain*.5,pan)

# Low-level scene sound design, mixed under the score.
t=np.arange(10*RATE)/RATE
fire=highpass(lowpass(rng.normal(0,1,len(t)),4300),650)*.018
fire*=env(t,10,.7,.8)
add(fire,0,1,0,mix)
for at in rng.uniform(.3,9,85):
    n=int(RATE*.035);click=rng.normal(0,1,n)*np.exp(-np.arange(n)/(RATE*.003))
    add(click,at,.055,rng.uniform(-.8,.8),mix)
for at in [22.4,23.5,24.7,30.4,31.8,34.4,35.8,37.3]:
    t=np.arange(round(.55*RATE))/RATE
    y=lowpass(rng.normal(0,1,len(t)),1700)*np.exp(-t/.13)
    add(y,at,.13,rng.uniform(-.65,.65),mix)

# A small, wide early-reflection/reverb network gives the synthesized ensemble space.
wet=np.zeros_like(music)
for seconds,level in [(.071,.16),(.113,.13),(.181,.10),(.277,.09),(.419,.065),(.631,.045),(.883,.025)]:
    offset=round(seconds*RATE)
    wet[offset:]+=music[:-offset,::-1]*level
mix+=music+wet
mix=np.tanh(mix*.95)
fade=np.minimum(1,np.arange(len(mix))/RATE/.35)*np.minimum(1,(len(mix)-1-np.arange(len(mix)))/RATE/1.0)
mix*=fade[:,None]
mix*=.88/max(np.max(np.abs(mix)),.01)
with wave.open(str(OUT/'score.wav'),'wb') as wav:
    wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(RATE)
    wav.writeframes((mix*32767).astype('<i2').tobytes())
print(f'Original score: {LENGTH}s, stereo {RATE}Hz; peak {np.max(np.abs(mix)):.3f}')

import { expect, it, vi } from 'vitest';
import { TouchSource, joystickVector, mergeManual } from '../src/input/touch';
import { Input, keyboardContact } from '../src/input/input';
import { createInitialState, DEFAULT_MATCH, step, type Intent } from '../src/sim';
import { createPredictor } from '../src/net/prediction';
import { simTuning } from '../src/tuning';
const idle: Intent = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, shot: null };
const source = () => { const t = new TouchSource(); t.setEnabled(true); return t; };
it.each([[0,0,0,0],[7.2,0,0,0],[7.21,0,7.21/36,0],[18,0,.5,0],[-36,0,-1,0],[0,-36,0,1],[0,36,0,-1],[72,0,1,0],[36,-36,Math.SQRT1_2,Math.SQRT1_2]])('joystick (%s,%s) keeps raw analog magnitude and radial clamp', (x,y,a,b) => {
  const v=joystickVector(x,y,36); expect(v.x).toBeCloseTo(a); expect(v.y).toBeCloseTo(b);
});
it('two owners move and shoot independently, first pending wins and quick taps survive',()=>{
  const t=source(); expect(t.startJoystick(1)).toBe(true); expect(t.startJoystick(2)).toBe(false);
  t.drag(1,18,-18,36); t.press(2,'drive'); t.press(3,'lob'); t.release(2);
  expect(t.sample()).toEqual({move:{x:.5,y:.5},aim:{x:.5,y:.5},shot:'drive'});
  expect(t.sample().shot).toBeNull(); expect(t.press(3,'soft')).toBe(false);
  t.release(3); t.press(3,'soft'); t.release(1);
  expect(t.sample()).toEqual({...idle,shot:'soft'});
  t.release(3); t.press(3,'lob'); expect(t.sample().shot).toBe('lob');
});
it('cancellation belongs to its gesture and never undoes sampled input',()=>{
  const t=source(); t.startJoystick(1); t.press(2,'soft'); t.release(1,true); expect(t.sample().shot).toBe('soft');
  t.release(2,true); t.press(2,'drive'); t.press(3,'lob'); t.release(3,true); expect(t.sample().shot).toBe('drive');
  t.release(2); t.press(2,'soft'); t.release(2,true); expect(t.sample()).toEqual(idle);
});
it('clear, disable and fresh press boundaries discard held/queued input',()=>{
  const t=source(); let cleared=0; t.onClear=()=>cleared++;
  t.startJoystick(1); t.drag(1,36,0,36); t.press(2,'lob'); t.clear(); t.drag(1,36,0,36);
  expect(t.sample()).toEqual(idle); expect(cleared).toBe(1);
  t.press(2,'drive'); t.setEnabled(false); expect(t.press(4,'soft')).toBe(false); expect(t.sample()).toEqual(idle);
  t.setEnabled(true); expect(t.sample()).toEqual(idle); expect(t.startJoystick(1)).toBe(true);
});
it('manual arbitration preserves keyboard identity when disabled and discards losing presses',()=>{
  const t=new TouchSource(); const keys={move:{x:1,y:0},aim:{x:1,y:0},shot:'drive' as const};
  expect(mergeManual(keys,t)).toBe(keys); t.setEnabled(true); t.startJoystick(1); t.press(2,'lob');
  expect(mergeManual(keys,t)).toEqual({...idle,shot:'drive'}); t.release(1); expect(mergeManual(idle,t)).toEqual(idle);
  t.startJoystick(1); t.drag(1,18,0,36); const sampled=t.sample(); expect(sampled.aim).toEqual(sampled.move); expect(sampled.aim).not.toBe(sampled.move);
  expect(Object.hasOwn(sampled,'contact')).toBe(false); expect(Object.hasOwn(sampled,'recommit')).toBe(false);
});
it.each(['soft','drive','lob'] as const)('touch %s has identical driver and predictor contact semantics',shot=>{
  const s=createInitialState(8,{...DEFAULT_MATCH,contactMode:['reported','auto']});
  s.phase='rally'; s.tick=100; s.shots=4; s.ball.lastHitBy=1; s.ball.bouncesSinceHit=1;
  s.ball.pos={x:.2,y:.9,z:3.55}; s.sides[0].players[0].pos={x:0,y:0,z:4};
  s.sides[0].players[0].commit={type:'soft',tick:30,bestDistance:null};
  const t=source(); t.press(1,shot); const raw=t.sample(); const keys={...idle,shot};
  expect(raw).toEqual(keys);
  const adapted=keyboardContact(s,[raw,idle],0,simTuning); const expected=keyboardContact(s,[keys,idle],0,simTuning);
  expect(step(s,[adapted,idle],simTuning)).toEqual(step(s,[expected,idle],simTuning));
  const a=createPredictor({local:0,start:s,tuning:simTuning}),b=createPredictor({local:0,start:s,tuning:simTuning});
  expect(a.stamp(100,raw)).toEqual(b.stamp(100,keys)); expect(a.curr).toEqual(b.curr);
  expect(adapted.contact).toBe(true); if(shot!=='soft') expect(adapted.recommit).toBe(true);
});

it('equal traces preserve early Commit, same-type repeat, recommit, late aim, assist and switched ends',()=>{
  for(const side of [0,1] as const) for(const switched of [false,true]) {
    let a=createInitialState(9,{...DEFAULT_MATCH,contactMode:['reported','reported']});
    a.phase='rally';a.tick=100;a.shots=4;a.ball.lastHitBy=side===0?1:0;a.ball.bouncesSinceHit=1;
    if(switched) a.match.ends=[1,0];
    a.ball.pos={x:0,y:1,z:0};a.ball.vel={x:0,y:0,z:0};
    let b=structuredClone(a);const t=source();t.startJoystick(1);
    for(const [n,shot] of (['soft','soft','drive',null,null,'lob'] as const).entries()) {
      const dx=n<3?18:-18,dy=n<3?-9:9;t.drag(1,dx,dy,36);
      if(shot) {t.press(2,shot);t.release(2);}
      const raw=t.sample(),keys={move:{x:dx/36,y:-dy/36},aim:{x:dx/36,y:-dy/36},shot};
      const ia:[Intent,Intent]=[idle,idle],ib:[Intent,Intent]=[idle,idle];ia[side]=raw;ib[side]=keys;
      ia[side]=keyboardContact(a,ia,side,simTuning);ib[side]=keyboardContact(b,ib,side,simTuning);
      a=step(a,ia,simTuning);b=step(b,ib,simTuning);expect(a).toEqual(b);
    }
  }
});
it('Input lifecycle and active Motion preserve the existing keyboard manual override',()=>{
  vi.stubGlobal('navigator',{getGamepads:()=>[]});vi.stubGlobal('HTMLInputElement',class {});vi.stubGlobal('HTMLTextAreaElement',class {});
  try {
    const target=new EventTarget(); const input=new Input(simTuning,target as Window);
    input.touch.setEnabled(true);input.touch.startJoystick(1);input.touch.drag(1,18,0,36);input.touch.press(2,'lob');input.clear();expect(input.sample()).toEqual(idle);
    input.touch.press(2,'drive');input.reset();expect(input.sample()).toEqual(idle);
    input.setMode('motion');input.prepare(createInitialState(7),0);input.touch.setEnabled(true);input.touch.press(2,'lob');expect(input.sample().shot).toBe('lob');
    input.controller=true;input.touch.press(3,'drive');const motion=input.sample();expect(motion.contact).toBe(false);expect(input.touch.enabled).toBe(false);
    input.setMode('keyboard');expect(input.sample()).toEqual(idle);
    target.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyJ',repeat:false}));target.dispatchEvent(Object.assign(new Event('keydown'),{code:'KeyK',repeat:true}));
    expect(input.sample().shot).toBe('soft');expect(input.sample().shot).toBeNull();
  } finally {vi.unstubAllGlobals();}
});

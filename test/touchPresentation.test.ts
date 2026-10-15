import {expect,it} from 'vitest';
import {setTouchPresentation,touchText,manualLabel} from '../src/input/presentation';
it('only mobile manual instructions change, including outcome feedback',()=>{
  const text='You serve (J or K). Soft (J). Esc to leave.';
  for(const [mobile,manual] of [[false,true],[true,false]]) {setTouchPresentation(mobile,manual);expect(touchText(text)).toBe(text);}
  setTouchPresentation(true,true);expect(manualLabel()).toBe('Touch');expect(touchText(text)).toBe('You serve (Dink or Hit). Dink. Menu to leave.');
  expect(touchText('Use Soft (J) from the Kitchen line for a dink.')).toBe('Use Dink from the Kitchen line for a dink.');
  expect(touchText('REPLAY · J / K / L to skip')).toBe('REPLAY · Tap a shot to skip');
  expect(touchText('Press J, K or L to play again, or Esc for the menu.')).toBe('Tap a shot to play again, or Menu for the map.');
  setTouchPresentation(false,true);expect(manualLabel()).toBe('Keyboard');
});

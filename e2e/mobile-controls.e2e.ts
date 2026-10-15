import { expect, test, type Page } from '@playwright/test';
import type { SimState } from '../src/sim';
interface Dink { state: SimState; viewTuning:{gameSpeed:number}; rally:{intents:[import('../src/sim').Intent,import('../src/sim').Intent][]}; practice:{skipTo(index:number):void}; replay:unknown; mode: string; eventLog: {kind:string;type?:string}[]; newMatch(seed:number):void; advance(ticks:number):void; frames(n:number,dt?:number):void; }
async function ready(page:Page, query='?play') { await page.goto('/'+query); await page.waitForFunction(()=>'dink' in window); }
async function center(page:Page,selector:string) { const b=(await page.locator(selector).boundingBox())!; return {x:b.x+b.width/2,y:b.y+b.height/2}; }
test.describe('direct touch play',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
  test('real simultaneous contacts capture independently and release without scroll or repeat',async({page,context})=>{
    await ready(page); await expect(page.locator('#control-mode')).toHaveText('TOUCH'); await expect(page.locator('#controller-pairing')).toBeHidden();
    const cdp=await context.newCDPSession(page); const stick=await center(page,'#touch-stick'),hit=await center(page,'[data-shot=drive]');
    await page.evaluate(()=>{ const d=(window as unknown as {dink:Dink}).dink; d.newMatch(7); d.advance(100); });
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...stick}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:stick.x+18,y:stick.y-18}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:stick.x+18,y:stick.y-18},{id:2,...hit}]});
    await expect(page.locator('#touch-stick')).toHaveClass('pressed'); await expect(page.locator('[data-shot=drive]')).toHaveClass('pressed');
    await expect.poll(()=>page.evaluate(()=>(window as unknown as {dink:Dink}).dink.eventLog.filter(e=>e.kind==='hit').map(e=>e.type))).toContain('drive');
    expect(await page.locator('#touch-stick').evaluate(el=>el.hasPointerCapture(2))).toBe(true);
    await page.screenshot({path:test.info().outputPath('mobile-pressed.png')});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{id:2,...hit}]});
    await expect(page.locator('[data-shot=drive]')).not.toHaveClass('pressed'); await expect(page.locator('#touch-stick')).toHaveClass('pressed');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:stick.x+180,y:stick.y-160}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator('#touch-stick')).not.toHaveClass('pressed');
    expect(await page.locator('.touch-thumb').evaluate(el=>(el as HTMLElement).style.transform)).toBe('');
    expect(await page.evaluate(()=>window.scrollY)).toBe(0);
    await page.locator('#touch-menu').tap(); await expect(page.locator('#pause')).toBeVisible(); await expect(page.locator('#touch-stick')).toBeHidden();
    await page.screenshot({path:test.info().outputPath('mobile-paused.png')});
    await page.getByRole('button',{name:'Resume',exact:true}).tap(); await expect(page.locator('#touch-stick')).toBeVisible();
    await page.locator('#touch-menu').tap(); await page.getByRole('button',{name:'Quit to map'}).tap(); await expect(page.locator('#menu')).toBeVisible();
    await page.getByRole('button',{name:'Practice',exact:true}).tap(); await expect(page.locator('#practice')).toBeVisible();
    await page.screenshot({path:test.info().outputPath('mobile-practice.png')});
  });
  test('sampled aim, rally types, interruption cleanup and fresh accessible activation',async({page,context})=>{
    await ready(page); const cdp=await context.newCDPSession(page);
    await page.evaluate(()=>{ const d=(window as unknown as {dink:Dink}).dink; d.viewTuning.gameSpeed=0; });
    const stick=await center(page,'#touch-stick');
    const last=()=>page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink; d.advance(1); return d.rally.intents.at(-1)![0];});
    const hold=async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:10,...stick}]}); await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:10,x:stick.x+18,y:stick.y-18}]});};
    await hold(); expect((await last()).aim).toEqual({x:.5,y:.5});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:10,x:stick.x-36,y:stick.y}]});
    await expect.poll(async()=>(await last()).aim.x).toBe(-1); expect((await last()).aim.y).toBeCloseTo(0);
    for(const event of ['blur','pagehide','resize','orientationchange']) {
      await page.evaluate(event=>window.dispatchEvent(new Event(event)),event);
      expect((await last()).aim).toEqual({x:0,y:0});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await hold();
    }
    await page.setViewportSize({width:844,height:390}); expect((await last()).aim).toEqual({x:0,y:0});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    for(const [label,type] of [['Dink','soft'],['Hit','drive'],['Lob','lob']]) {
      await page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink; d.newMatch(8); const s=d.state;
        s.phase='rally';s.tick=100;s.shots=4;s.ball.lastHitBy=1;s.ball.bouncesSinceHit=1;s.ball.pos={x:.2,y:.9,z:3.55};s.sides[0].players[0].pos={x:0,y:0,z:4};s.sides[0].players[0].commit={type:'soft',tick:30,bestDistance:null}; });
      await page.getByRole('button',{name:label,exact:true}).tap();
      const raw=await last(); expect(raw.shot).toBe(type); expect(raw.contact).toBe(true);
      expect((await last()).shot).toBeNull();
    }
    await page.getByRole('button',{name:'Hit',exact:true}).focus(); await page.keyboard.press('Enter'); expect((await last()).shot).toBe('drive'); expect((await last()).shot).toBeNull();
  });
  test('Practice translations, replay skip and offline rematch use fresh taps',async({page})=>{
    await ready(page,'?practice');
    for(const [index,text] of [[1,'You serve (Dink or Hit).'],[3,'Drop your third shot with Dink']] as const) {
      await page.evaluate(index=>{const d=(window as unknown as {dink:Dink}).dink;d.practice.skipTo(index);d.state.phase='rally';d.state.ball.lastHitBy=0;d.state.ball.pos={x:20,y:-.1,z:4};d.advance(1);},index);
      await expect(page.locator('.practice-prompt')).toContainText(text);
      await expect(page.locator('.practice-prompt')).not.toContainText('Soft (J)');
    }
    await page.screenshot({path:test.info().outputPath('mobile-practice-dink.png')});
    const card=(await page.locator('#practice').boundingBox())!,menu=(await page.locator('#touch-menu').boundingBox())!,banner=(await page.locator('#banner').boundingBox())!;
    expect(card.x+card.width+8).toBeLessThanOrEqual(menu.x);expect(banner.y).toBeGreaterThanOrEqual(card.y+card.height+8);
    await page.setViewportSize({width:844,height:390});await page.screenshot({path:test.info().outputPath('mobile-practice-landscape.png')});await page.setViewportSize({width:390,height:844});
    await page.locator('#touch-menu').tap(); await page.getByRole('button',{name:'Quit to map'}).tap();
    await page.getByRole('button',{name:/The Park:/}).tap();
    await page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink; d.viewTuning.gameSpeed=0; d.newMatch(7); d.advance(100);});
    await page.getByRole('button',{name:'Hit',exact:true}).tap();
    await page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink; d.advance(1); d.state.ball.pos.x=20; d.state.ball.pos.y=-.1; d.advance(1); d.frames(60,1/60);});
    await expect(page.locator('#replay-tag')).toContainText('Tap a shot to skip');
    await page.screenshot({path:test.info().outputPath('mobile-replay.png')});
    await page.getByRole('button',{name:'Dink',exact:true}).tap(); await page.evaluate(()=>(window as unknown as {dink:Dink}).dink.frames(2));
    expect(await page.evaluate(()=>(window as unknown as {dink:Dink}).dink.replay)).toBeNull();
    await page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink; d.advance(1);});
    expect(await page.evaluate(()=>(window as unknown as {dink:Dink}).dink.state.phase)).toBe('serve');
    await page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink;d.newMatch(7);d.state.match.config.rallyScoring=true;d.state.match.points=[10,0];d.state.phase='rally';d.state.ball.lastHitBy=0;d.state.ball.bouncesSinceHit=1;d.state.ball.pos={x:40,y:1,z:-4};d.advance(1);d.advance(200);});
    await expect(page.locator('#detail')).toContainText('Tap a shot to play again, or Menu for the map.');
    await page.screenshot({path:test.info().outputPath('mobile-result.png')});
    await page.getByRole('button',{name:'Lob',exact:true}).tap(); await page.evaluate(()=>(window as unknown as {dink:Dink}).dink.advance(1));
    expect(await page.evaluate(()=>(window as unknown as {dink:Dink}).dink.state.match.winner)).toBeNull();
  });
  test('cancel, capture loss, hidden page and capability loss require fresh gestures',async({page,context})=>{
    await ready(page);await page.evaluate(()=>{(window as unknown as {dink:Dink}).dink.viewTuning.gameSpeed=0;document.querySelector('#touch-stick')!.addEventListener('pointerdown',event=>{(event.currentTarget as HTMLElement).dataset.pointer=String((event as PointerEvent).pointerId);});});
    const cdp=await context.newCDPSession(page),stick=await center(page,'#touch-stick'),hit=await center(page,'[data-shot=drive]');
    const hold=async()=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:stick.x+18,y:stick.y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:stick.x+22,y:stick.y}]});await expect(page.locator('#touch-stick')).toHaveClass('pressed');};
    const neutral=async()=>{await expect(page.locator('#touch-stick')).not.toHaveClass('pressed');const intent=await page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink;d.advance(1);return d.rally.intents.at(-1)![0];});expect(intent.move).toEqual({x:0,y:0});expect(intent.shot).toBeNull();};
    await hold();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:stick.x+18,y:stick.y},{id:2,...hit}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await neutral();
    await hold();await page.locator('#touch-stick').evaluate(el=>el.releasePointerCapture(Number((el as HTMLElement).dataset.pointer)));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:stick.x+20,y:stick.y}]});await neutral();await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await hold();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await neutral();
    await page.evaluate(()=>{delete (document as unknown as {hidden?:boolean}).hidden;});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await hold();await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});await expect(page.locator('#touch-controls')).toHaveCount(0);const intent=await page.evaluate(()=>{const d=(window as unknown as {dink:Dink}).dink;d.advance(1);return d.rally.intents.at(-1)![0];});expect(intent.move).toEqual({x:0,y:0});expect(intent.shot).toBeNull();
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});await expect(page.locator('#touch-stick')).toBeVisible();
  });
  test('active mobile Motion hides shots but retains Menu and returns to neutral manual input',async({page})=>{
    await ready(page,'?play&motion&debug');await page.evaluate(()=>(window as unknown as {dink:{swing(type:string):void}}).dink.swing('drive'));
    await expect(page.locator('#touch-stick')).toBeHidden();await expect(page.locator('#touch-menu')).toBeVisible();
    await page.keyboard.press('KeyM');await expect(page.locator('#touch-stick')).toBeVisible();await expect(page.locator('#control-mode')).toHaveText('TOUCH');
  });
  test('each fresh shot uses the existing serve mapping, and pairing hide restores neutral fallback',async({page})=>{
    await ready(page);
    for(const [label,type] of [['Dink','soft'],['Hit','drive'],['Lob','soft']]) {
      await page.evaluate(()=>{ const d=(window as unknown as {dink:Dink}).dink; d.newMatch(7); d.eventLog.length=0; d.advance(100); });
      await page.getByRole('button',{name:label,exact:true}).tap();
      await expect.poll(()=>page.evaluate(()=>(window as unknown as {dink:Dink}).dink.eventLog.filter(e=>e.kind==='hit')[0]?.type)).toBe(type);
    }
    await page.locator('#control-mode').tap(); await expect(page.locator('#controller-pairing')).toBeVisible(); await expect(page.locator('#touch-stick')).toBeHidden();
    await expect(page.locator('.pair-keyboard')).toHaveText('Use Touch'); await page.screenshot({path:test.info().outputPath('mobile-pairing.png')});
    await page.getByRole('button',{name:'Hide panel'}).tap(); await expect(page.locator('#touch-stick')).toBeVisible();
    await expect(page.locator('#control-mode')).toContainText('Touch fallback');
  });
  for(const [width,height] of [[320,568],[390,844],[568,320],[844,390],[1024,768]]) test('geometry and rotation '+width+'x'+height,async({page})=>{
    await page.setViewportSize({width,height}); await ready(page);
    await page.waitForTimeout(1500);
    const stick=(await page.locator('#touch-stick').boundingBox())!,shots=(await page.locator('#touch-shots').boundingBox())!;
    expect(stick.x+stick.width+8).toBeLessThanOrEqual(shots.x); expect(shots.x+shots.width).toBeLessThanOrEqual(width-12); expect(shots.y+shots.height).toBeLessThanOrEqual(height-12);
    for(const box of [stick,shots]) { expect(box.x).toBeGreaterThanOrEqual(12); expect(box.y).toBeGreaterThan(0); }
    expect((await page.locator('[data-shot=drive]').boundingBox())!.width).toBeGreaterThanOrEqual(60);
    await page.screenshot({path:test.info().outputPath('mobile-'+width+'x'+height+'.png')});
    if ((width===390&&height===844)||(width===844&&height===390)) await expect(page).toHaveScreenshot('touch-'+width+'x'+height+'.png',{maxDiffPixelRatio:0.02});
    await page.setViewportSize({width:height,height:width}); await expect(page.locator('#touch-stick')).not.toHaveClass('pressed');
  });
  test('short landscape menus scroll and sunset/beach remain visible through controls',async({page})=>{
    await page.setViewportSize({width:844,height:390}); await ready(page,'?play&sunset');
    await page.screenshot({path:test.info().outputPath('mobile-sunset.png')});
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await page.screenshot({path:test.info().outputPath('mobile-sunset-portrait.png')});await page.setViewportSize({width:844,height:390});
    await ready(page,'?play&venue=beach'); await page.screenshot({path:test.info().outputPath('mobile-beach.png')});
    await page.locator('#touch-menu').tap(); await page.getByRole('button',{name:'Quit to map'}).tap();
    await page.getByRole('button',{name:'Locker',exact:true}).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button',{name:'Locker',exact:true})).toBeInViewport();
    await page.screenshot({path:test.info().outputPath('mobile-menu.png')});
    await page.getByRole('button',{name:'Locker',exact:true}).tap(); await expect(page.locator('#locker')).toBeVisible();
  });
});
test('desktop and narrow desktop remain unchanged',async({page})=>{
  for(const viewport of [{width:1280,height:720},{width:390,height:844}]) {
    await page.setViewportSize(viewport); await ready(page); await expect(page.locator('#touch-controls')).toHaveCount(0);
    await expect(page.locator('#control-mode')).toHaveText('KEYBOARD'); await expect(page.locator('#controls')).toContainText('J Soft');
    await page.screenshot({path:test.info().outputPath('desktop-'+viewport.width+'.png')});
  }
});



test('mobile Host and Guest use the local Court and existing Leave/rematch panels',async({browser})=>{
  test.setTimeout(90000);
  const contexts=await Promise.all([0,1].map(()=>browser.newContext({hasTouch:true,isMobile:true,viewport:{width:568,height:320},baseURL:test.info().project.use.baseURL})));
  try {
    const [host,guest]=await Promise.all(contexts.map(c=>c.newPage()));
    await ready(host,''); await host.getByRole('button',{name:'Play online'}).tap(); await host.locator('#online-name').fill('Touch Host'); await host.locator('[data-preset=quick]').tap(); await host.locator('#create-court').tap();
    await expect(host.locator('.wait-status')).toHaveText(/Waiting for opponent/,{timeout:20000}); const code=await host.locator('.online-code strong').textContent();
    await ready(guest,'?court='+code); await guest.locator('#online-name').fill('Touch Guest'); await guest.getByRole('button',{name:'Join',exact:true}).tap();
    for(const page of [host,guest]) await expect(page.locator('#touch-stick')).toBeVisible({timeout:20000});
    for(const [index,page] of [host,guest].entries()) {
      const before=await page.evaluate(index=>(window as unknown as {dink:Dink}).dink.state.sides[index].players[0].pos.x,index);
      const cdp=await page.context().newCDPSession(page),stick=await center(page,'#touch-stick');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:stick.x+30,y:stick.y}]});
      await page.waitForTimeout(300); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      const after=await page.evaluate(index=>(window as unknown as {dink:Dink}).dink.state.sides[index].players[0].pos.x,index);
      expect(index===0?after-before:before-after).toBeGreaterThan(0);
    }
    await host.getByRole('button',{name:'Hit',exact:true}).tap();
    for(const page of [host,guest]) await expect.poll(()=>page.evaluate(()=>(window as unknown as {dink:Dink}).dink.state.shots)).toBeGreaterThan(0);
    await guest.locator('#touch-menu').tap(); await expect(guest.locator('#leave-match')).toBeVisible(); await expect(guest.locator('#touch-stick')).toBeHidden();
    const tick=await guest.evaluate(()=>(window as unknown as {dink:Dink}).dink.state.tick); await guest.waitForTimeout(150);
    expect(await guest.evaluate(()=>(window as unknown as {dink:Dink}).dink.state.tick)).toBeGreaterThan(tick);
    await guest.getByRole('button',{name:'Keep playing'}).tap(); await expect(guest.locator('#touch-stick')).toBeVisible();
    // Use the existing deterministic drive helper to finish a real quick Match.
    for (const page of [host,guest]) await page.evaluate(()=>{
      const d=(window as unknown as {dink:Dink & {online:{side:0|1};drive:(s:SimState)=>import('../src/sim').Intent}}).dink;
      d.drive=s=>({move:{x:0,y:0},aim:{x:0,y:0},shot:s.phase==='serve'&&s.server===d.online.side?'drive':null});
    });
    for(const page of [host,guest]) { await expect(page.locator('#online-over')).toBeVisible({timeout:65000}); await expect(page.locator('#touch-stick')).toBeHidden(); await expect(page.locator('#touch-menu')).toBeHidden(); }
    await guest.screenshot({path:test.info().outputPath('mobile-online-over.png')});
    for(const page of [host,guest]) await page.locator('#rematch').tap();
    for(const page of [host,guest]) await expect(page.locator('#touch-stick')).toBeVisible({timeout:20000});
  } finally { await Promise.all(contexts.map(c=>c.close())); }
});

test('fine-primary touchscreen stays on desktop controls',async({browser})=>{
  const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:844},baseURL:test.info().project.use.baseURL});
  try {const page=await context.newPage();await page.addInitScript(()=>{const media=window.matchMedia.bind(window);window.matchMedia=query=>query==='(pointer: coarse) and (hover: none)'?new Proxy(media(query),{get(target,key){const value=Reflect.get(target,key,target);return key==='matches'?false:typeof value==='function'?value.bind(target):value;}}):media(query);});
    await ready(page);await expect(page.locator('#touch-controls')).toHaveCount(0);await expect(page.locator('#control-mode')).toHaveText('KEYBOARD');
  } finally {await context.close();}
});

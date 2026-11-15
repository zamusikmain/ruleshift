import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './load.mjs';
test('continuous joystick size preserves legacy presets and survives reload without deleting settings',()=>{
 const values=new Map([['ruleshift.controls.v1','small']]);
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 let css;const document={documentElement:{style:{setProperty:(_k,v)=>css=v}}};
 let c=loadModule('controlSettings',{localStorage:storage,document});assert.equal(c.joystickPixels,104);
 c.setJoystickPixels(145.6);assert.equal(css,'146px');assert.equal(values.get('ruleshift.controls.v1'),'small');
 c=loadModule('controlSettings',{localStorage:storage,document});assert.equal(c.joystickPixels,146);
 c.setJoystickSize('large');assert.equal(css,'168px');assert.equal(loadModule('controlSettings',{localStorage:storage}).joystickPixels,168);
 c.setJoystickPixels(NaN);assert.equal(c.joystickPixels,168);c.setJoystickPixels(1);assert.equal(c.joystickPixels,104);
});

import test from 'node:test';import assert from 'node:assert/strict';import {formatMoney,moneyTone} from '../src/ui/format.js';
test('format uses EUR and Italian decimals',()=>{assert.match(formatMoney(1234.56),/1\.234,56/);assert.match(formatMoney(1234.56),/€/);});
test('tones preserve sign and invalid values',()=>{assert.equal(moneyTone(-1),'negative');assert.equal(moneyTone(1),'positive');assert.equal(moneyTone(0),'neutral');assert.equal(formatMoney(NaN),'—');});

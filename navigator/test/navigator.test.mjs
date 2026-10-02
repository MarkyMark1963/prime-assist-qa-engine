import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{handler,version}=require('../netlify/functions/navigator-core.js');
test('version is available without spending an OpenAI call',async()=>{const r=await handler({httpMethod:'GET'},false);assert.equal(JSON.parse(r.body).version,version)});
test('preview rejects unauthorized requests',async()=>{const r=await handler({httpMethod:'POST',body:JSON.stringify({question:'Test',patch:'Test'}),headers:{}},true);assert.equal(r.statusCode,401)});
test('version mismatch prevents model execution',async()=>{const r=await handler({httpMethod:'POST',body:JSON.stringify({question:'Test',expected_version:'old'})},false);assert.equal(r.statusCode,409)});
test('invalid and oversized questions are rejected',async()=>{for(const question of ['', 'x'.repeat(4001)]){const r=await handler({httpMethod:'POST',body:JSON.stringify({question})},false);assert.equal(r.statusCode,400)}});

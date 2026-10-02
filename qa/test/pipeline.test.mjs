import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,gate,nextStage,assertResponse,assertEvaluation} from '../src/domain.mjs';
import {runJob} from '../src/runner.mjs';
const spec={user:'The dog is vomiting',expected_mode:'clarify',must:['retain dog'],must_not:['human guidance']};
const good={mode:'clarify',question:'How often?',heading:null,summary:null,safety_notice:null,next_step:null,steps:[],follow_up_question:null};
function fixture(){
 const c={target:'https://example.test',version:'fixed',patch:'Keep the subject',patch_hash:hash('Keep the subject'),suites:{development:[{id:'dog',turns:[spec,{...spec,user:'Twice today'}]}]}};
 const j={id:'job',stage:'development',payload:{results:[]}};let calls=0,saves=[];
 const store={spend:async()=>{calls++},save:async(j,status='running')=>saves.push({status,payload:structuredClone(j.payload)})};
 const requests=[];
 const request=async(url,opts)=>{
  const b=JSON.parse(opts.body);requests.push({url,body:b});
  if(url.includes('api.openai.com'))return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({pass:true,severity:'none',reason:'Meets requirements'})}]}]})};
  return {ok:true,json:async()=>({...good,_qa:{version:c.version,patch_hash:b.patch?hash(b.patch):null}})};
 };
 return {c,j,store,request,requests,get calls(){return calls},get saves(){return saves}};
}
test('all gates require complete evidence and absolute passing behavior',()=>{
 const bad={id:'x',technical:false,baseline:{pass:false},candidate:{pass:false,severity:'major'}};
 assert.equal(gate([bad],1).passed,false);
 assert.equal(gate([],1).passed,false);
 assert.equal(gate([{id:'x',technical:true}],1).passed,false);
 assert.equal(gate([{...bad,baseline:{pass:true},candidate:{pass:true,severity:'none'}}],1).passed,true);
});
test('validation cannot precede passing development; holdout cannot repeat',()=>{
 assert.equal(nextStage([]),'development');
 assert.throws(()=>nextStage([{stage:'development',status:'queued'}]));
 assert.throws(()=>nextStage([{stage:'development',status:'complete',payload:{summary:{passed:false}}}]));
 const jobs=['development','validation','holdout'].map(stage=>({stage,status:'complete',payload:{summary:{passed:true}}}));
 assert.equal(nextStage(jobs.slice(0,1)),'validation');assert.equal(nextStage(jobs.slice(0,2)),'holdout');assert.throws(()=>nextStage(jobs));
});
test('run maintains separate baseline and candidate conversations',async()=>{
 const f=fixture();await runJob(f.store,f.j,f.c,{request:f.request});
 assert.equal(f.j.payload.summary.passed,true);assert.equal(f.calls,8);
 const nav=f.requests.filter(x=>!x.url.includes('api.openai.com'));
 assert.equal(nav[0].body.history.length,0);assert.equal(nav[2].body.history.length,2);
 assert.equal(nav[2].body.history[0].content,spec.user);assert.equal(nav[3].body.patch,f.c.patch);
 assert.equal(f.saves.at(-1).status,'complete');
});
test('Navigator version drift is technical and stops the run',async()=>{
 const f=fixture();const request=async()=>({ok:true,json:async()=>({...good,_qa:{version:'changed',patch_hash:null}})});
 await runJob(f.store,f.j,f.c,{request});
 assert.equal(f.j.payload.summary.technical,1);assert.equal(f.j.payload.summary.candidate,0);assert.equal(f.saves.at(-1).status,'technical_failed');
});
test('evaluator failure never becomes behavioral repair evidence',async()=>{
 const f=fixture();const request=async(url,opts)=>url.includes('api.openai.com')?{ok:false,status:429}:f.request(url,opts);
 await runJob(f.store,f.j,f.c,{request});
 assert.equal(f.j.payload.results[0].technical,true);assert.equal(f.j.payload.results[0].candidate,undefined);
});
test('resume reuses a persisted baseline response without spending another call',async()=>{
 const f=fixture();f.j.payload.active={index:0,turns:[],partial:{baseline_response:{...good,_qa:{version:'fixed',patch_hash:null}}}};
 await runJob(f.store,f.j,f.c,{request:f.request});assert.equal(f.calls,7);assert.equal(f.j.payload.summary.passed,true);
});
test('resume skips completed conversations',async()=>{
 const f=fixture();f.j.payload.results=[{id:'dog',technical:false,baseline:{pass:true},candidate:{pass:true,severity:'none'}}];
 await runJob(f.store,f.j,f.c,{request:f.request});assert.equal(f.calls,0);assert.equal(f.j.payload.summary.passed,true);
});
test('malformed evaluator output is rejected and structural violations fail',()=>{
 assert.throws(()=>assertEvaluation({pass:true,severity:'critical',reason:'Contradiction'}));
 assert.throws(()=>assertEvaluation({pass:'yes',severity:'none',reason:'Bad'}));
 assert.equal(assertResponse({...good,next_step:'Call someone'},spec).pass,false);
 assert.equal(assertResponse({...good,mode:'guide'},spec).pass,false);
});
test('call budget errors stop without a pass',async()=>{
 const f=fixture();f.store.spend=async()=>{throw Error('Call limit reached')};await runJob(f.store,f.j,f.c,{request:f.request});assert.equal(f.saves.at(-1).status,'technical_failed');
});

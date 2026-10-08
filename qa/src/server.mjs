import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import {Store} from './store.mjs';
import {worker} from './runner.mjs';
import {hash,nextStage,stages} from './domain.mjs';
for(const name of ['DATABASE_URL','QA_ADMIN_KEY','QA_PREVIEW_KEY','QA_TARGET_ORIGIN','OPENAI_API_KEY'])if(!process.env[name])throw Error(name+' required');
if(process.env.QA_ADMIN_KEY.length<32||process.env.QA_PREVIEW_KEY.length<32)throw Error('QA keys must have at least 32 characters');
const origin=new URL(process.env.QA_TARGET_ORIGIN);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('QA_TARGET_ORIGIN must be an HTTPS origin');
const target=origin.origin;
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});
const store=new Store(db);await store.init();
const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));
const suites={development:read('development.json'),validation:read('validation.json'),holdout:read('legacy-holdout.json')};
const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))};
async function body(req){let chunks='',size=0;for await(const chunk of req){size+=chunk.length;if(size>20000)throw Error('Request too large');chunks+=chunk}return JSON.parse(chunks||'{}')}
function authorized(req){const supplied=String(req.headers['x-qa-key']||''),expected=process.env.QA_ADMIN_KEY;return Buffer.byteLength(supplied)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))}
const uuid=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
async function createCandidate(patch){
 if(typeof patch!=='string'||!patch.trim()||patch.trim().length>12000)throw Error('Patch must contain 1–12000 characters');
 const r=await fetch(target+'/api/navigate',{redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Cannot read Navigator version');const meta=await r.json();if(meta.protocol!==1||!meta.version)throw Error('Deploy the matching Navigator adapter first');
 const id=crypto.randomUUID(),p=patch.trim();
 await db.query('INSERT INTO paqa_candidates(id,target,version,patch,patch_hash,suites) VALUES($1,$2,$3,$4,$5,$6)',[id,target,meta.version,p,hash(p),JSON.stringify(suites)]);return id;
}
async function locked(id,fn){const conn=await db.connect();try{await conn.query('BEGIN');const c=(await conn.query('SELECT * FROM paqa_candidates WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!c)throw Error('Candidate not found');const jobs=(await conn.query('SELECT * FROM paqa_jobs WHERE candidate_id=$1 ORDER BY created_at',[id])).rows;const result=await fn(conn,c,jobs);await conn.query('COMMIT');return result}catch(e){await conn.query('ROLLBACK');throw e}finally{conn.release()}}
http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});return res.end(fs.readFileSync(new URL('../public/index.html',import.meta.url)))}
 if(path==='/health'&&req.method==='GET')return reply(res,200,{ok:true,version:'1.0.0'});
 if(!authorized(req))return reply(res,401,{error:'QA key required'});
 try{
  if(path==='/api/candidates'&&req.method==='GET')return reply(res,200,{candidates:await store.list()});
  if(path==='/api/candidates'&&req.method==='POST')return reply(res,201,{id:await createCandidate((await body(req)).patch)});
  const match=path.match(/^\/api\/candidates\/([^/]+)\/(run|retry|approve|repair|evidence)$/);
  if(!match||!uuid(match[1]))return reply(res,404,{error:'Not found'});
  const [,id,action]=match;
  if(action==='retry'&&req.method==='POST'){
   const result=await locked(id,async(conn,c,jobs)=>{const j=jobs.find(x=>x.status==='technical_failed');if(!j)throw Error('Only technical failures can be retried');if(j.calls>=240)throw Error('This run has exhausted its call budget');j.payload.results=j.payload.results.filter(x=>!x.technical);delete j.payload.summary;delete j.payload.error;await conn.query("UPDATE paqa_jobs SET status='queued',payload=$2,lease_token=NULL,lease_until=NULL,updated_at=NOW() WHERE id=$1",[j.id,JSON.stringify(j.payload)]);return {job_id:j.id,stage:j.stage}});return reply(res,202,result);
  }
  if(action==='run'&&req.method==='POST'){
   const result=await locked(id,async(conn,c,jobs)=>{const stage=nextStage(jobs),jobId=crypto.randomUUID();await conn.query('INSERT INTO paqa_jobs(id,candidate_id,stage,payload) VALUES($1,$2,$3,$4)',[jobId,id,stage,JSON.stringify({results:[],total:c.suites[stage].length,suite_hash:hash(c.suites[stage]),patch_hash:c.patch_hash,version:c.version})]);return {job_id:jobId,stage}});return reply(res,202,result);
  }
  if(action==='approve'&&req.method==='POST'){
   const b=await body(req);if(typeof b.note!=='string'||!b.note.trim())throw Error('Human review note required');
   await locked(id,async(conn,c,jobs)=>{if(stages.some(stage=>!jobs.some(j=>j.stage===stage&&j.status==='complete'&&j.payload.summary?.passed)))throw Error('All three gates must pass');await conn.query('INSERT INTO paqa_approvals(candidate_id,note) VALUES($1,$2) ON CONFLICT(candidate_id) DO NOTHING',[id,b.note.trim().slice(0,2000)])});return reply(res,200,{approved:true,deployed:false});
  }
  if(action==='evidence'&&req.method==='GET'){
   const stage=new URL(req.url,'http://localhost').searchParams.get('stage')||'development';
   if(!['development','validation'].includes(stage))return reply(res,400,{error:'Only development or validation evidence can be viewed'});
   const j=(await db.query('SELECT payload FROM paqa_jobs WHERE candidate_id=$1 AND stage=$2',[id,stage])).rows[0];return reply(res,200,{[stage]:j?.payload||null});
  }
  if(action==='repair'&&req.method==='POST'){
   const rows=(await db.query("SELECT c.patch,j.status,j.payload FROM paqa_candidates c JOIN paqa_jobs j ON j.candidate_id=c.id WHERE c.id=$1 AND j.stage='development'",[id])).rows;
   const row=rows[0];if(!row||row.status!=='complete')throw Error('Completed development evidence required');
   const failures=row.payload.results.filter(x=>!x.technical&&!x.candidate.pass);if(!failures.length)throw Error('No development failures to repair');
   const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'gpt-5.6-luna',store:false,instructions:'Propose the smallest general Navigator behavior patch. Preserve CLARIFY/GUIDE, autonomy and evidence standards. Never add test-specific exceptions. Use only development evidence. Return only the replacement patch text.',input:JSON.stringify({patch:row.patch,failures})}),signal:AbortSignal.timeout(40000)});
   if(!r.ok)throw Error('Repair model request failed');const d=await r.json(),patch=d.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
   return reply(res,201,{id:await createCandidate(patch),parent:id});
  }
  reply(res,405,{error:'Method not allowed'});
 }catch(e){reply(res,400,{error:String(e.message)})}
}).listen(process.env.PORT||3000,'0.0.0.0');
let busy=false;
setInterval(async()=>{if(busy)return;busy=true;try{await worker(store,db)}catch(e){console.error('Worker error:',e.message)}finally{busy=false}},1000);

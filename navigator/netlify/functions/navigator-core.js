const crypto=require('node:crypto');
const policy=require('./policy.json');
const version=crypto.createHash('sha256').update(JSON.stringify(policy)).update(require('node:fs').readFileSync(__filename)).digest('hex');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function reply(statusCode,body){return {statusCode,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(body)}}
async function handler(event,preview){
 if(event.httpMethod==='GET'&&!preview)return reply(200,{version,model:policy.model,protocol:1});
 if(event.httpMethod!=='POST')return reply(405,{error:'Method not allowed'});
 let b;try{b=JSON.parse(event.body||'{}')}catch{return reply(400,{error:'Invalid JSON'})}
 const question=typeof b.question==='string'?b.question.trim():'';
 if(!question||question.length>4000)return reply(400,{error:'A question of 1–4000 characters is required'});
 const qaKey=process.env.QA_PREVIEW_KEY,provided=event.headers?.['x-qa-key'];
 if(preview&&(!qaKey||!equal(provided,qaKey)))return reply(401,{error:'Preview authorization required'});
 if(b.expected_version&&b.expected_version!==version)return reply(409,{error:'Navigator version changed',version});
 const patch=preview&&typeof b.patch==='string'?b.patch.trim():'';
 if(preview&&(!patch||patch.length>12000))return reply(400,{error:'Candidate patch required; maximum 12000 characters'});
 if(!process.env.OPENAI_API_KEY)return reply(503,{error:'Navigator is not configured'});
 const history=Array.isArray(b.history)?b.history:[];
 if(history.length>100||history.some(x=>!['user','assistant'].includes(x?.role)||typeof x.content!=='string'||x.content.length>16000))return reply(400,{error:'Invalid conversation history'});
 try{
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:policy.model,store:false,instructions:policy.system+(patch?'\nCANDIDATE PATCH — TEST ONLY:\n'+patch:''),input:[...history,{role:'user',content:'Location: '+String(b.location||'').slice(0,160)+'\n'+question}],text:{format:{type:'json_schema',name:'navigation',strict:true,schema:policy.schema}}}),signal:AbortSignal.timeout(25000)});
  if(!r.ok)return reply(502,{error:'Navigator model request failed'});
  const d=await r.json(),text=d.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
  const result=JSON.parse(text);
  if(result.mode==='clarify'){
   if(!result.question)throw Error('Missing question');
   Object.assign(result,{heading:null,summary:null,safety_notice:null,next_step:null,steps:[],follow_up_question:null});
  }else if(result.mode==='guide')result.question=null;else throw Error('Invalid mode');
  result._qa={version,patch_hash:patch?hash(patch):null,model:policy.model};
  return reply(200,result);
 }catch{return reply(502,{error:'Navigator could not complete the request'})}
}
module.exports={handler,version};

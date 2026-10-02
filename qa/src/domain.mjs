import crypto from 'node:crypto';
export const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export const stages=['development','validation','holdout'];
export function nextStage(jobs){
 for(const stage of stages){
  const matches=jobs.filter(j=>j.stage===stage);
  if(matches.some(j=>['queued','running'].includes(j.status)))throw Error('A run is already pending');
  if(!matches.length)return stage;
  if(!matches.some(j=>j.status==='complete'&&j.payload?.summary?.passed))throw Error(stage+' did not pass; create a new candidate for a revised patch');
 }
 throw Error('All gates have completed');
}
export function gate(results,total){
 const technical=results.filter(x=>x.technical).length;
 const behavioral=results.filter(x=>!x.technical);
 const baseline=behavioral.filter(x=>x.baseline.pass).length,candidate=behavioral.filter(x=>x.candidate.pass).length;
 const regressions=behavioral.filter(x=>x.baseline.pass&&!x.candidate.pass).map(x=>x.id);
 const critical=behavioral.filter(x=>x.candidate.severity==='critical').length;
 return {total,completed:results.length,technical,baseline,candidate,critical,regressions,
  passed:results.length===total&&technical===0&&candidate===total&&critical===0&&regressions.length===0};
}
export function assertEvaluation(d){
 if(!d||typeof d.pass!=='boolean'||!['none','minor','major','critical'].includes(d.severity)||typeof d.reason!=='string')throw Error('Malformed evaluator output');
 if(d.pass&&d.severity!=='none')throw Error('Contradictory evaluator output');
 return d;
}
export function assertResponse(d,spec){
 if(!d||!['clarify','guide'].includes(d.mode))return {pass:false,severity:'major',reason:'Missing or invalid mode'};
 if(spec.expected_mode&&spec.expected_mode!=='clarify_or_guide'&&d.mode!==spec.expected_mode)return {pass:false,severity:'major',reason:'Wrong response mode'};
 if(d.mode==='clarify'&&(!d.question||d.heading||d.summary||d.safety_notice||d.next_step||d.steps?.length||d.follow_up_question))return {pass:false,severity:'major',reason:'Invalid clarification structure'};
 if(d.mode==='guide'&&(!d.next_step||d.question))return {pass:false,severity:'major',reason:'Guide must provide a next step without a clarification question'};
 return null;
}

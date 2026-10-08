'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let history=[],exchanges=[],busy=false,requestNumber=0,controller=null,lastAttempt=null;
function validateResponse(value){
 if(!value||!['clarify','guide'].includes(value.mode))throw Error('invalid_response');
 if(value.mode==='clarify'&&(typeof value.question!=='string'||!value.question.trim()))throw Error('invalid_response');
 for(const field of ['acknowledgment','safety_notice','heading','summary','next_step','follow_up_question'])if(value[field]!=null&&typeof value[field]!=='string')throw Error('invalid_response');
 if(value.steps!=null&&(!Array.isArray(value.steps)||value.steps.some(step=>typeof step!=='string')))throw Error('invalid_response');
 if(value.mode==='guide'&&!value.next_step&&!value.summary&&!value.steps?.length)throw Error('invalid_response');
 return value;
}
function cardHTML(r){
 const safety=r.safety_notice?'<div class="warning"><p>'+esc(r.safety_notice)+'</p></div>':'';
 const ack=r.acknowledgment?'<p class="acknowledgment">'+esc(r.acknowledgment)+'</p>':'';
 if(r.mode==='clarify')return safety+ack+'<h2 id="resultHeading" class="question">'+esc(r.question)+'</h2>';
 return safety+ack+'<h2 id="resultHeading">'+esc(r.heading||'Your next step')+'</h2>'+(r.summary?'<p>'+esc(r.summary)+'</p>':'')+(r.next_step?'<div class="next"><h3>Best next step</h3><p>'+esc(r.next_step)+'</p></div>':'')+(r.steps?.length?'<details class="helpful"><summary>More helpful details</summary><ol>'+r.steps.map(step=>'<li>'+esc(step)+'</li>').join('')+'</ol></details>':'');
}
function plainResponse(r){return [r.safety_notice,r.acknowledgment,r.heading,r.summary,r.question,r.next_step,...(r.steps||[]),r.follow_up_question].filter(Boolean).join('\n\n')}
function render(r,message){
 $('welcome').hidden=true;$('reset').hidden=false;$('result').hidden=false;$('lastQuestion').textContent=message;$('answer').innerHTML=cardHTML(r);
 $('questionLabel').textContent=r.mode==='clarify'?'Your answer':r.follow_up_question||'Anything else you’d like help with?';
 $('question').placeholder=r.mode==='clarify'?'Type your answer here.':'Ask a follow-up question or add another detail.';
 $('send').textContent='Continue';
 const previous=exchanges.slice(0,-1);$('past').hidden=!previous.length;$('pastLabel').textContent='Earlier conversation ('+previous.length+(previous.length===1?' exchange)':' exchanges)');
 $('pastContent').innerHTML=previous.map(x=>'<article><p class="past-role">You</p><p>'+esc(x.question)+'</p><p class="past-role">Prime Assist</p><p>'+esc(plainResponse(x.response))+'</p></article>').join('');
 $('question').value='';$('result').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
function setBusy(value){busy=value;$('send').disabled=value;$('question').disabled=value;$('location').disabled=value;document.querySelectorAll('[data-example]').forEach(button=>button.disabled=value);$('questionForm').setAttribute('aria-busy',String(value));$('retry').disabled=value}
function clearError(){$('errorBox').hidden=true;$('errorText').textContent=''}
function showError(message){$('errorText').textContent=message;$('errorBox').hidden=false;$('retry').focus()}
function safeHistory(){return history.map(({role,content})=>({role,content}))}
async function ask(question){
 if(busy)return;
 const message=String(question||'').trim();if(!message){$('question').focus();return}
 if(message.length>4000){showError('Please shorten your message to 4,000 characters or fewer.');return}
 if(history.length>=98){showError('This conversation is getting long. Choose Start over to begin a new one.');return}
 const location=$('location').value.trim();lastAttempt={question:message,location};const prior=safeHistory(),number=++requestNumber;
 controller=new AbortController();const requestController=controller;setBusy(true);clearError();$('status').textContent='Working on your next step…';$('reset').hidden=false;
 let timedOut=false,focusTarget='question';const timeout=setTimeout(()=>{timedOut=true;requestController.abort()},50000);
 const slow=setTimeout(()=>{if(number===requestNumber)$('status').textContent='Still working. You don’t need to send it again.'},12000);
 try{
  const response=await fetch('/api/navigate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:message,location,history:prior}),signal:requestController.signal});
  if(number!==requestNumber)return;
  if(!response.ok){if(response.status===429)throw Error('rate_limit');if(response.status===400)throw Error('request_invalid');throw Error('unavailable')}
  const data=validateResponse(await response.json());if(number!==requestNumber)return;
  const stored={...data};delete stored._qa;
  history=prior.concat([{role:'user',content:message},{role:'assistant',content:JSON.stringify(stored)}]);exchanges.push({question:message,response:stored});
  $('status').textContent='';lastAttempt=null;render(stored,message);
 }catch(error){
  if(number!==requestNumber)return;
  $('status').textContent='';
  const text=timedOut?'That took too long. Your message is still here—try again.':error.message==='rate_limit'?'Prime Assist is busy right now. Wait a moment, then try again.':error.message==='request_invalid'?'We couldn’t process that message. Try shortening it or starting a new conversation.':'We couldn’t get an answer right now. Your message is still here—try again.';
  focusTarget='retry';showError(text);
 }finally{clearTimeout(timeout);clearTimeout(slow);if(number===requestNumber){controller=null;setBusy(false);$(focusTarget).focus()}}
}
$('questionForm').addEventListener('submit',event=>{event.preventDefault();ask($('question').value)});
$('retry').addEventListener('click',()=>{if(lastAttempt){$('location').value=lastAttempt.location;ask(lastAttempt.question)}});
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();ask($('question').value)}});
$('reset').addEventListener('click',()=>{requestNumber++;controller?.abort();controller=null;history=[];exchanges=[];lastAttempt=null;setBusy(false);clearError();$('question').value='';$('location').value='';$('status').textContent='';$('result').hidden=true;$('past').hidden=true;$('pastContent').innerHTML='';$('answer').innerHTML='';$('welcome').hidden=false;$('reset').hidden=true;$('questionLabel').textContent='What’s happening?';$('question').placeholder='Explain it the same way you would to a friend.';$('send').textContent='Help me find the next step';$('locationPanel').open=false;$('question').focus()});
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{$('question').value=button.dataset.example;$('question').focus()}));

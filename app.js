
/* Vertiv Engineer Availability — static frontend backed by Supabase */
let db,person,people=[],leaves=[],holidays=[],roster=[],mode='',view=new Date(),selected=new Date(),feed;
const $=id=>document.getElementById(id);
const pad=x=>String(x).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const date=s=>{let [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const fmt=s=>date(s).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weight=l=>l.portion==='full'?1:.5;
const monthBounds=()=>{let y=view.getFullYear(),m=view.getMonth();return [`${y}-${pad(m+1)}-01`,iso(new Date(y,m+1,0))]};
function client(){const c=window.LEAVE_CONFIG;if(!window.supabase||!c||!c.url.startsWith('https://')||!c.key||c.key.includes('PASTE_'))throw Error('Set the Supabase URL and publishable key in config.js first.');return window.supabase.createClient(c.url,c.key)}
function status(s,bad=false,target='message'){const el=$(target);if(el){el.className=bad?'error':'success';el.textContent=s}}
async function check(res){if(res.error)throw res.error;return res.data}
async function startLogin(){registerSW();try{db=client();const session=(await db.auth.getSession()).data.session;if(session){await route(session.user);return} $('register').onsubmit=registerEngineer; $('login').onsubmit=async e=>{e.preventDefault();$('message').textContent='Signing in…';try{const r=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(r.error)throw r.error;await route(r.data.user)}catch(err){$('message').textContent=err.message}}}catch(e){$('message').textContent=e.message}}
async function registerEngineer(e){e.preventDefault();const out='registerMessage';status('Creating engineer login…',false,out);try{const email=$('regEmail').value.trim().toLowerCase();const pw=$('regPassword').value;const row=(await db.from('engineer_roster').select('*').eq('email',email).eq('active',true).maybeSingle());if(row.error)throw row.error;if(!row.data)throw Error('This email is not in the active engineer roster. Ask admin to add you first.');const r=await db.auth.signUp({email,password:pw});if(r.error)throw r.error; if(r.data.user){await ensureProfile(r.data.user,row.data)} status('Engineer login created. If email confirmation is enabled, verify mail first; then sign in.',false,out)}catch(err){status(err.message,true,out)}}
async function ensureProfile(user, rosterRow=null){
  // create a minimal engineer profile automatically from roster if missing
  let existing=(await db.from('profiles').select('*').eq('id',user.id).maybeSingle());
  if(existing.error && existing.error.code!=='PGRST116') throw existing.error;
  if(existing.data) return existing.data;
  let rosterMatch=rosterRow;
  if(!rosterMatch){
    const rr=await db.from('engineer_roster').select('*').eq('email',user.email?.toLowerCase()).eq('active',true).maybeSingle();
    if(rr.error) throw rr.error;
    rosterMatch=rr.data;
  }
  if(!rosterMatch) throw Error('No active engineer roster entry found for this login. Ask admin to add you in Manage Engineers.');
  const payload={id:user.id,full_name:rosterMatch.full_name,role:'engineer',active:true};
  const ins=await db.from('profiles').upsert(payload,{onConflict:'id'}).select().single();
  if(ins.error) throw ins.error;
  return ins.data;
}
async function route(user){
  let pRes=await db.from('profiles').select('role,active').eq('id',user.id).maybeSingle();
  if(pRes.error && pRes.error.code!=='PGRST116') throw pRes.error;
  let p=pRes.data;
  if(!p){
    // if not admin profile, try auto-create from roster for engineers
    const rr=await db.from('engineer_roster').select('*').eq('email',user.email?.toLowerCase()).eq('active',true).maybeSingle();
    if(rr.error && rr.error.code!=='PGRST116') throw rr.error;
    if(rr.data){
      await ensureProfile(user, rr.data);
      p=(await check(await db.from('profiles').select('role,active').eq('id',user.id).single()));
    } else {
      throw Error('No portal role found for this account.');
    }
  }
  if(!p.active)throw Error('Account is inactive.');
  location.href=p.role==='admin'?'admin.html':'engineer.html'
}
async function startPage(which){mode=which;registerSW();try{db=client();const {data:{user},error}=await db.auth.getUser();if(error||!user){location.replace('index.html');return}
  let pRes=await db.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(pRes.error && pRes.error.code!=='PGRST116') throw pRes.error;
  person=pRes.data;
  if(!person && which==='engineer') person=await ensureProfile(user);
  if(!person){location.replace('index.html');return}
  if(!person.active||which==='admin'&&person.role!=='admin'){location.replace('index.html');return}
  $('who').textContent=person.full_name; if($('adminLink')&&person.role==='admin')$('adminLink').classList.remove('hidden');$('loading').classList.add('hidden');$('app').classList.remove('hidden');if(which==='admin'){$('holidayform').onsubmit=addHoliday;$('rosterform').onsubmit=addRoster;showAdminTab('calendar')}else{$('leaveform').onsubmit=saveLeave} await refresh();
  feed=db.channel('leave-availability-'+which+'-'+user.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'leaves'},()=>refresh())
    .on('postgres_changes',{event:'*',schema:'public',table:'holidays'},()=>refresh())
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},()=>refresh())
    .on('postgres_changes',{event:'*',schema:'public',table:'engineer_roster'},()=>refresh())
    .subscribe()
}catch(e){$('loading').textContent=e.message}}
async function refresh(){try{const [start,end]=monthBounds();const jobs=[
  db.from('holidays').select('*').gte('holiday_date',start).lte('holiday_date',end),
  db.from('leaves').select('*').gte('leave_date',start).lte('leave_date',end)
];
  if(mode==='admin'){
    jobs.push(db.from('profiles').select('id,full_name,active,role').eq('active',true));
    jobs.push(db.from('engineer_roster').select('*').eq('active',true).order('full_name'));
  }
  const all=await Promise.all(jobs);holidays=await check(all[0]);leaves=await check(all[1]);
  if(mode==='admin'){
    const profiles=(await check(all[2])).filter(p=>p.role==='engineer');
    roster=await check(all[3]);
    // Use roster as planned team count, but names from profiles when available
    people=profiles;
  }
  render()
}catch(e){status(e.message,true)}}
function changeMonth(n){view=new Date(view.getFullYear(),view.getMonth()+n,1);selected=new Date(view.getFullYear(),view.getMonth(),1);refresh()}
function special(s){if(date(s).getDay()===0)return'Sunday • weekly off';const h=holidays.find(h=>h.holiday_date===s);return h?h.title:null}
function dayLeaves(s){return leaves.filter(l=>l.leave_date===s&&(mode==='admin'?true:l.user_id===person.id))}
function engineerNameByUser(id){return people.find(p=>p.id===id)?.full_name || 'Engineer'}
function activeRosterCount(){return mode==='admin' ? roster.filter(r=>r.active).length : 0}
function render(){const title=view.toLocaleString('en-GB',{month:'long',year:'numeric'});$('month').textContent=title;let start=new Date(view.getFullYear(),view.getMonth(),1),offset=(start.getDay()+6)%7,last=new Date(view.getFullYear(),view.getMonth()+1,0).getDate();let html='';for(let i=0;i<offset;i++)html+='<div class="day blank"></div>';for(let n=1;n<=last;n++){let s=iso(new Date(view.getFullYear(),view.getMonth(),n)),sp=special(s),ls=dayLeaves(s);if(mode==='admin'){ls=ls.filter(l=>roster.some(r=>r.active && people.some(p=>p.id===l.user_id && p.full_name===r.full_name) || people.some(p=>p.id===l.user_id)));}
    let full=ls.filter(l=>l.portion==='full').length,half=ls.filter(l=>l.portion!=='full').length,total=activeRosterCount(),present=Math.max(0,total-full-half),label=sp?'OFF':mode==='admin'?`P ${present} A ${full} ½ ${half}`:ls.length?(ls[0].portion==='full'?'Full leave':'½ day leave'):'Available';
    html+=`<button class="day ${sp?'weekend holiday':ls.length?'absence':''} ${s===iso(selected)?'current':''}" onclick="choose('${s}')"><span class="num">${n}</span><span class="metric">${esc(label)}</span></button>`}
  $('calendar').innerHTML=html;if(mode==='admin'){renderAdmin();renderRoster()}else renderEngineer()}
function choose(s){selected=date(s);render()}
function renderAdmin(){let s=iso(selected),sp=special(s),ls=sp?[]:dayLeaves(s),full=ls.filter(x=>x.portion==='full').length,half=ls.length-full,total=activeRosterCount(),present=Math.max(0,total-full-half);$('total').textContent=String(total);$('available').textContent=sp?'OFF':String(present);$('onleave').textContent=sp?'—':String(full);$('leaveunits').textContent=sp?'—':String(half);$('selectedTitle').textContent=fmt(s);$('selectedSummary').textContent=sp?sp:`${present} present • ${full} full-day leave • ${half} half-day leave • ${total} active engineers`;$('detail').innerHTML=ls.length?ls.map(l=>`<div class="item"><div><strong>${esc(engineerNameByUser(l.user_id))}</strong><div class="muted small">${esc(l.reason)}</div></div><span class="pill red">${l.portion==='full'?'FULL':l.portion==='am'?'AM ½':'PM ½'}</span></div>`).join(''):'<p class="muted small">No leave marked for this date.</p>';$('holidaylist').innerHTML=holidays.length?holidays.map(h=>`<div class="item"><div><strong>${esc(h.title)}</strong><div class="small muted">${fmt(h.holiday_date)}</div></div><button class="danger" onclick="removeHoliday('${h.holiday_date}')">Remove</button></div>`).join(''):'<p class="muted small">No company holidays entered for this month.</p>';$('team').innerHTML=roster.length?roster.map(r=>`<div class="item"><div><strong>${esc(r.full_name)}</strong><div class="muted small">${esc(r.employee_code)} • ${esc(r.email)}</div></div><span class="pill ${r.active?'green':'red'}">${r.active?'Active':'Inactive'}</span></div>`).join(''):'<p class="muted">No active engineer roster yet.</p>';$('register').innerHTML=leaves.sort((a,b)=>a.leave_date.localeCompare(b.leave_date)).map(l=>`<tr><td>${esc(l.leave_date)}</td><td>${esc(engineerNameByUser(l.user_id))}</td><td>${l.portion==='full'?'Full day':l.portion==='am'?'First half':'Second half'}</td><td>${esc(l.reason)}</td></tr>`).join('')||'<tr><td colspan="4">No leaves in this month.</td></tr>'}
function renderEngineer(){let s=iso(selected),sp=special(s),mine=dayLeaves(s)[0];$('selectedTitle').textContent=fmt(s);$('dayHint').textContent=sp?`${sp} — leave cannot be marked.`:mine?'You have already marked leave. Update or cancel below.':'Mark your leave for this working day.';$('leaveform').classList.toggle('hidden',Boolean(sp));$('portion').value=mine?.portion||'full';$('reason').value=mine?.reason||'';$('cancelbtn').disabled=!mine;$('myleaves').innerHTML=leaves.filter(l=>l.user_id===person.id).sort((a,b)=>a.leave_date.localeCompare(b.leave_date)).map(l=>`<div class="item"><div><strong>${fmt(l.leave_date)}</strong><div class="muted small">${esc(l.reason)}</div></div><span class="pill red">${l.portion==='full'?'Full':l.portion==='am'?'AM ½':'PM ½'}</span></div>`).join('')||'<p class="muted">No leave marked this month.</p>'}
async function saveLeave(e){e.preventDefault();const s=iso(selected);if(special(s))return status('Non-working day cannot be marked as leave.',true);try{$('savebtn').disabled=true;await check(await db.from('leaves').upsert({user_id:person.id,leave_date:s,portion:$('portion').value,reason:$('reason').value.trim()},{onConflict:'user_id,leave_date'}));status(`Leave saved for ${fmt(s)}.`);await refresh()}catch(e){status(e.message,true)}finally{$('savebtn').disabled=false}}
async function cancelLeave(){const s=iso(selected);if(!confirm(`Cancel your leave for ${fmt(s)}?`))return;try{await check(await db.from('leaves').delete().eq('user_id',person.id).eq('leave_date',s));status('Leave cancelled.');await refresh()}catch(e){status(e.message,true)}}
async function addHoliday(e){e.preventDefault();const s=$('holidaydate').value;if(date(s).getDay()===0)return status('Sunday is already a weekly off.',true);if(!confirm(`Mark ${fmt(s)} as company holiday? Any existing leave entries on this date will be excluded from working-day count.`))return;try{await check(await db.from('holidays').upsert({holiday_date:s,title:$('holidayname').value.trim()}));status('Holiday saved.');$('holidayform').reset();await refresh()}catch(e){status(e.message,true)}}
async function removeHoliday(s){if(!confirm(`Remove holiday on ${fmt(s)}?`))return;try{await check(await db.from('holidays').delete().eq('holiday_date',s));status('Holiday removed.');await refresh()}catch(e){status(e.message,true)}}
function exportCSV(){let rows=[['Date','Engineer','Portion','Reason'],...leaves.map(l=>[l.leave_date,engineerNameByUser(l.user_id),l.portion,l.reason])];const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};let blob=new Blob(['\ufeff'+rows.map(row=>row.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`vertiv-leaves-${pad(view.getMonth()+1)}-${view.getFullYear()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
async function signOut(){if(db)await db.auth.signOut();location.replace('index.html')}
function showAdminTab(tab){const a=tab==='calendar';$('calendarPane').classList.toggle('hidden',!a);$('peoplePane').classList.toggle('hidden',a);$('tabCalendar').setAttribute('aria-selected',String(a));$('tabPeople').setAttribute('aria-selected',String(!a))}
function renderRoster(){if(!$('rosterlist'))return;$('rosterlist').innerHTML=roster.length?roster.map(r=>`<div class="item"><div><strong>${esc(r.full_name)}</strong><div class="muted small">${esc(r.employee_code)} • ${esc(r.email)}</div></div><button onclick="setRosterActive('${r.id}',${!r.active})">${r.active?'Deactivate':'Activate'}</button></div>`).join(''):'<p class="muted">No engineers added yet.</p>'}
async function addRoster(e){e.preventDefault();const btn=e.submitter;try{btn.disabled=true;const row={full_name:$('rosterName').value.trim(),employee_code:$('rosterCode').value.trim(),email:$('rosterEmail').value.trim().toLowerCase(),active:true};await check(await db.from('engineer_roster').insert(row));$('rosterform').reset();$('rosterMessage').textContent='Engineer added. Ask engineer to use the registered email for first-time activation on the login page.';await refresh()}catch(err){$('rosterMessage').textContent=err.message}finally{btn.disabled=false}}
async function setRosterActive(id,active){try{await check(await db.from('engineer_roster').update({active}).eq('id',id));await refresh()}catch(err){$('rosterMessage').textContent=err.message}}
function registerSW(){if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}}

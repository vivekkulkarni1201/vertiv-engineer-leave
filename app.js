
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
  const payload={id:user.id,full_name:rosterMatch.full_name,role:rosterMatch.access_role||'engineer',active:true};
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
async function startPage(which){mode=which;view=new Date();selected=new Date();registerSW();try{db=client();const {data:{user},error}=await db.auth.getUser();if(error||!user){location.replace('index.html');return}
  let pRes=await db.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(pRes.error && pRes.error.code!=='PGRST116') throw pRes.error;
  person=pRes.data;
  if(!person && which==='engineer') person=await ensureProfile(user);
  if(!person){location.replace('index.html');return}
  if(!person.active||which==='admin'&&person.role!=='admin'){location.replace('index.html');return}
  $('who').textContent=person.full_name; if($('adminLink')&&person.role==='admin')$('adminLink').classList.remove('hidden');$('loading').classList.add('hidden');$('app').classList.remove('hidden');if(which==='admin'){/* settings moved to settings.html */}else{$('leaveform').onsubmit=saveLeave} await refresh();
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
    jobs.push(db.from('profiles').select('id,full_name,active,role,email').eq('active',true));
    jobs.push(db.from('engineer_roster').select('*').order('full_name'));
  }
  const all=await Promise.all(jobs);holidays=await check(all[0]);leaves=await check(all[1]);
  if(mode==='admin'){
    const profiles=(await check(all[2]));
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
function activeRosterCount(){return mode==='admin' ? roster.filter(r=>r.active && r.access_role!=='admin').length : 0}
// One calculation for calendar cells, KPIs and selected-date details.
function activeTeamCount(){return roster.filter(r=>r.active && r.access_role!=='admin').length}
function countedLeaves(s){
  if(special(s))return [];
  // Database returns the same leave records for calendar and selected-day cards.
  // Deduplicate by user ID; no different filter for each UI surface.
  const seen=new Set();
  const eligible=new Set(people.filter(p=>p.role==='engineer').map(p=>p.id));
  return leaves.filter(l=>{
    if(l.leave_date!==s||seen.has(l.user_id)||!eligible.has(l.user_id))return false;
    seen.add(l.user_id);return true;
  });
}
function dayNumbers(s){
  const ls=countedLeaves(s),full=ls.filter(l=>l.portion==='full').length,
        half=ls.length-full,total=activeTeamCount();
  return {ls,full,half,total,present:Math.max(0,total-full-half)};
}
function render(){
  $('month').textContent=view.toLocaleString('en-GB',{month:'long',year:'numeric'});
  const start=new Date(view.getFullYear(),view.getMonth(),1),offset=(start.getDay()+6)%7;
  const last=new Date(view.getFullYear(),view.getMonth()+1,0).getDate();
  let html='';
  for(let i=0;i<offset;i++)html+='<div class="day blank"></div>';
  for(let n=1;n<=last;n++){
    const s=iso(new Date(view.getFullYear(),view.getMonth(),n)),sp=special(s);
    let label='',classes='';
    if(sp){label=sp;classes='weekend holiday'}
    else if(mode==='admin'){
      const d=dayNumbers(s);
      label=`<span class="cell-count present-count">P ${d.present}</span> <span class="cell-count absent-count">A ${d.full}</span> <span class="cell-count half-count">½ ${d.half}</span>`;
      classes=d.full||d.half?'absence':'';
    }else{
      const mine=dayLeaves(s)[0];label=mine?(mine.portion==='full'?'Full leave':'½ day leave'):'Available';
      classes=mine?'absence':'';
    }
    const text=sp||mode!=='admin'?esc(label):label;
    html+=`<button class="day ${classes} ${s===iso(selected)?'current':''}" onclick="choose('${s}')"><span class="num">${n}</span><span class="metric">${text}</span></button>`;
  }
  $('calendar').innerHTML=html;
  if(mode==='admin'){renderAdmin();renderMonthlySummary()}else {renderEngineer();renderMySummary()};
}
function choose(s){selected=date(s);render()}
function renderAdmin(){
  const s=iso(selected),sp=special(s),{ls,full,half,total,present}=dayNumbers(s);
  $('total').textContent=String(total);
  $('available').textContent=sp?'OFF':String(present);
  $('onleave').textContent=sp?'—':String(full);
  $('leaveunits').textContent=sp?'—':String(half);
  $('selectedTitle').textContent=fmt(s);
  $('selectedSummary').textContent=sp?sp:`${present} present • ${full} full-day leave • ${half} half-day leave • ${total} active engineers`;
  $('detail').innerHTML=ls.length?ls.map(l=>`<div class="item"><div><strong>${esc(engineerNameByUser(l.user_id))}</strong><div class="muted small">${esc(l.reason)}</div></div><span class="pill red">${l.portion==='full'?'FULL':l.portion==='am'?'AM ½':'PM ½'}</span></div>`).join(''):'<p class="muted small">No leave marked for this date.</p>';
  $('holidaylist').innerHTML=holidays.length?holidays.map(h=>`<div class="item"><div><strong>${esc(h.title)}</strong><div class="small muted">${fmt(h.holiday_date)}</div></div><button class="danger" onclick="removeHoliday('${h.holiday_date}')">Remove</button></div>`).join(''):'<p class="muted small">No company holidays entered for this month.</p>';
  $('team').innerHTML=roster.length?roster.map(r=>`<div class="item"><div><strong>${esc(r.full_name)}</strong><div class="muted small">${esc(r.employee_code)} • ${esc(r.email)} • ${r.access_role==='admin'?'Admin':'Testing Engineer'}</div></div><span class="pill green">Active</span></div>`).join(''):'<p class="muted">No active engineer roster yet.</p>';
  $('register').innerHTML=leaves.slice().sort((a,b)=>a.leave_date.localeCompare(b.leave_date)).map(l=>`<tr><td>${esc(l.leave_date)}</td><td>${esc(engineerNameByUser(l.user_id))}</td><td>${l.portion==='full'?'Full day':l.portion==='am'?'First half':'Second half'}</td><td>${esc(l.reason)}</td></tr>`).join('')||'<tr><td colspan="4">No leaves in this month.</td></tr>';
}
function renderEngineer(){let s=iso(selected),sp=special(s),mine=dayLeaves(s)[0];$('selectedTitle').textContent=fmt(s);$('dayHint').textContent=sp?`${sp} — leave cannot be marked.`:mine?'You have already marked leave. Update or cancel below.':'Mark your leave for this working day.';$('leaveform').classList.toggle('hidden',Boolean(sp));$('portion').value=mine?.portion||'full';$('reason').value=mine?.reason||'';$('cancelbtn').disabled=!mine;$('myleaves').innerHTML=leaves.filter(l=>l.user_id===person.id).sort((a,b)=>a.leave_date.localeCompare(b.leave_date)).map(l=>`<div class="item"><div><strong>${fmt(l.leave_date)}</strong><div class="muted small">${esc(l.reason)}</div></div><span class="pill red">${l.portion==='full'?'Full':l.portion==='am'?'AM ½':'PM ½'}</span></div>`).join('')||'<p class="muted">No leave marked this month.</p>'}
async function saveLeave(e){e.preventDefault();const s=iso(selected);if(special(s))return status('Non-working day cannot be marked as leave.',true);try{$('savebtn').disabled=true;await check(await db.from('leaves').upsert({user_id:person.id,leave_date:s,portion:$('portion').value,reason:$('reason').value.trim()},{onConflict:'user_id,leave_date'}));status(`Leave saved for ${fmt(s)}.`);await refresh()}catch(e){status(e.message,true)}finally{$('savebtn').disabled=false}}
async function cancelLeave(){const s=iso(selected);if(!confirm(`Cancel your leave for ${fmt(s)}?`))return;try{await check(await db.from('leaves').delete().eq('user_id',person.id).eq('leave_date',s));status('Leave cancelled.');await refresh()}catch(e){status(e.message,true)}}
async function addHoliday(e){e.preventDefault();const s=$('holidaydate').value;if(date(s).getDay()===0)return status('Sunday is already a weekly off.',true);if(!confirm(`Mark ${fmt(s)} as company holiday? Any existing leave entries on this date will be excluded from working-day count.`))return;try{await check(await db.from('holidays').upsert({holiday_date:s,title:$('holidayname').value.trim()}));status('Holiday saved.');$('holidayform').reset();await refresh()}catch(e){status(e.message,true)}}
async function removeHoliday(s){if(!confirm(`Remove holiday on ${fmt(s)}?`))return;try{await check(await db.from('holidays').delete().eq('holiday_date',s));status('Holiday removed.');await refresh()}catch(e){status(e.message,true)}}
function exportCSV(){let rows=[['Date','Engineer','Portion','Reason'],...leaves.map(l=>[l.leave_date,engineerNameByUser(l.user_id),l.portion,l.reason])];const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};let blob=new Blob(['\ufeff'+rows.map(row=>row.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`vertiv-leaves-${pad(view.getMonth()+1)}-${view.getFullYear()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000)}
async function signOut(){if(db)await db.auth.signOut();location.replace('index.html')}
function showAdminTab(tab){const a=tab==='calendar';$('calendarPane').classList.toggle('hidden',!a);$('peoplePane').classList.toggle('hidden',a);$('tabCalendar').setAttribute('aria-selected',String(a));$('tabPeople').setAttribute('aria-selected',String(!a))}
function renderRoster(){if(!$('rosterlist'))return;$('rosterlist').innerHTML=roster.length?roster.map(r=>`<div class="item"><div><strong>${esc(r.full_name)}</strong><div class="muted small">${esc(r.employee_code)} • ${esc(r.email)}</div></div><div class="role-actions"><select aria-label="Role for ${esc(r.full_name)}" onchange="setRosterRole('${r.id}',this.value)"><option value="engineer" ${r.access_role==='engineer'?'selected':''}>Testing Engineer</option><option value="admin" ${r.access_role==='admin'?'selected':''}>Admin</option></select><button onclick="setRosterActive('${r.id}',${!r.active})">${r.active?'Deactivate':'Activate'}</button></div></div>`).join(''):'<p class="muted">No engineers added yet.</p>'}
async function addRoster(e){e.preventDefault();const btn=e.submitter;try{btn.disabled=true;const row={full_name:$('rosterName').value.trim(),employee_code:$('rosterCode').value.trim(),email:$('rosterEmail').value.trim().toLowerCase(),access_role:$('rosterRole').value,active:true};await check(await db.from('engineer_roster').insert(row));$('rosterform').reset();$('rosterMessage').textContent='Engineer added. Ask engineer to use the registered email for first-time activation on the login page.';await refresh()}catch(err){$('rosterMessage').textContent=err.message}finally{btn.disabled=false}}
async function setRosterActive(id,active){try{await check(await db.from('engineer_roster').update({active}).eq('id',id));await refresh()}catch(err){$('rosterMessage').textContent=err.message}}
function resetAdminToToday(){if(mode!=='admin'||!$('app')||$('app').classList.contains('hidden'))return;view=new Date();selected=new Date();refresh()}
window.addEventListener('pageshow',e=>{if(e.persisted)resetAdminToToday()});
function registerSW(){if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}}

async function setRosterRole(id,access_role){if(!confirm('Change access role to '+(access_role==='admin'?'Admin':'Testing Engineer')+'?')){await refresh();return}try{await check(await db.from('engineer_roster').update({access_role}).eq('id',id));status('Access role updated. User should sign out and log in again.',false,'rosterMessage');await refresh()}catch(e){status(e.message,true,'rosterMessage');await refresh()}}


// V7: Separate role and attendance inclusion. Never infer attendance from access role.
let summaryView=new Date();
function includedRoster(){return roster.filter(r=>r.active && r.attendance_included!==false)}
function activeTeamCount(){return includedRoster().length}
function activeRosterCount(){return activeTeamCount()}
function eligibleIds(){const emails=new Set(includedRoster().map(r=>r.email?.toLowerCase()));return new Set(people.filter(p=>emails.has((p.email||'').toLowerCase())).map(p=>p.id))}
// Link auth ID to roster via email in refresh; no name matching assumptions.
function countedLeaves(s){if(special(s))return [];const allowed=new Set(people.filter(p=>includedRoster().some(r=>r.email?.toLowerCase()===p.email?.toLowerCase())).map(p=>p.id));const seen=new Set();return leaves.filter(l=>l.leave_date===s&&allowed.has(l.user_id)&&!seen.has(l.user_id)&&(seen.add(l.user_id),true))}
function engineerNameByUser(id){return people.find(p=>p.id===id)?.full_name||'Engineer'}
function isWorkday(s){return !special(s)}
function getMonthStats(userId,yy,mm){let p=0,a=0,h=0;const end=new Date(yy,mm+1,0).getDate();for(let d=1;d<=end;d++){const s=iso(new Date(yy,mm,d));if(!isWorkday(s))continue;const leave=leaves.find(x=>x.user_id===userId&&x.leave_date===s);if(!leave)p++;else if(leave.portion==='full')a++;else h++}return {p,a,h}}
function renderMonthlySummary(){if(!$('monthlySummary'))return;$('summaryMonth').textContent=summaryView.toLocaleString('en-GB',{month:'long',year:'numeric'});$('monthlySummary').innerHTML=includedRoster().map(r=>{const p=people.find(x=>x.email?.toLowerCase()===r.email?.toLowerCase());const st=p?getMonthStats(p.id,summaryView.getFullYear(),summaryView.getMonth()):{p:0,a:0,h:0};return `<div class="summary-person"><strong>${esc(r.full_name)}</strong><span class="muted small">${esc(r.access_role==='admin'?'Admin':'Testing Engineer')}</span><div class="summary-metrics"><span class="present-count">P ${p?st.p:'—'}</span><span class="absent-count">A ${p?st.a:'—'}</span><span class="half-count">½ ${p?st.h:'—'}</span></div>${!p?'<span class="small muted">Login not activated</span>':''}</div>`}).join('')||'<p class="muted">No included active engineers.</p>'}
function changeSummaryMonth(n){summaryView=new Date(summaryView.getFullYear(),summaryView.getMonth()+n,1);/* load full selected summary month */loadSummaryMonth()}
async function loadSummaryMonth(){try{const y=summaryView.getFullYear(),m=summaryView.getMonth(),from=iso(new Date(y,m,1)),to=iso(new Date(y,m+1,0));const results=await Promise.all([db.from('leaves').select('*').gte('leave_date',from).lte('leave_date',to),db.from('holidays').select('*').gte('holiday_date',from).lte('holiday_date',to)]);summaryLeaves=await check(results[0]);summaryHolidays=await check(results[1]);renderMonthlySummary()}catch(e){status(e.message,true)}}
let summaryLeaves=null,summaryHolidays=null;
function getMonthStats(userId,yy,mm){let p=0,a=0,h=0;const monthCurrent=yy===view.getFullYear()&&mm===view.getMonth();const ldata=monthCurrent?leaves:(summaryLeaves||[]),hdata=monthCurrent?holidays:(summaryHolidays||[]);const last=new Date(yy,mm+1,0).getDate();for(let d=1;d<=last;d++){const s=iso(new Date(yy,mm,d));if(date(s).getDay()===0||hdata.some(x=>x.holiday_date===s))continue;const v=ldata.find(x=>x.user_id===userId&&x.leave_date===s);if(!v)p++;else if(v.portion==='full')a++;else h++}return{p,a,h}}
function renderMySummary(){if(!$('myCounts'))return;const st=getMonthStats(person.id,view.getFullYear(),view.getMonth());$('myCounts').innerHTML=`<div class="mini-stat present-count">Present <strong>${st.p}</strong></div><div class="mini-stat absent-count">Full Leave <strong>${st.a}</strong></div><div class="mini-stat half-count">Half-day <strong>${st.h}</strong></div>`}
// Override renderAdmin to preserve original calendar functionality but remove settings-only widgets.
const priorRenderAdmin=renderAdmin;
renderAdmin=function(){const s=iso(selected),sp=special(s),{ls,full,half,total,present}=dayNumbers(s);$('total').textContent=String(total);$('available').textContent=sp?'OFF':String(present);$('onleave').textContent=sp?'—':String(full);$('leaveunits').textContent=sp?'—':String(half);$('selectedTitle').textContent=fmt(s);$('selectedSummary').textContent=sp?sp:`${present} present • ${full} full-day leave • ${half} half-day leave • ${total} counted engineers`;$('detail').innerHTML=ls.length?ls.map(l=>`<div class="item"><div><strong>${esc(engineerNameByUser(l.user_id))}</strong><div class="muted small">${esc(l.reason)}</div></div><span class="pill red">${l.portion==='full'?'FULL':l.portion==='am'?'AM ½':'PM ½'}</span></div>`).join(''):'<p class="muted small">No leave marked for this date.</p>';$('register').innerHTML=leaves.slice().sort((a,b)=>a.leave_date.localeCompare(b.leave_date)).map(l=>`<tr><td>${esc(l.leave_date)}</td><td>${esc(engineerNameByUser(l.user_id))}</td><td>${l.portion==='full'?'Full day':l.portion==='am'?'First half':'Second half'}</td><td>${esc(l.reason)}</td></tr>`).join('')||'<tr><td colspan="4">No leaves in this month.</td></tr>'};
// Protect Settings with the current admin password. Role restrictions enforced by Supabase RLS.
async function startSettings(){registerSW();try{db=client();const {data:{user},error}=await db.auth.getUser();if(error||!user){location.replace('index.html');return}person=await check(await db.from('profiles').select('*').eq('id',user.id).single());if(!person.active||person.role!=='admin'){location.replace('index.html');return}$('who').textContent=person.full_name;$('unlockForm').onsubmit=async e=>{e.preventDefault();const pw=$('unlockPassword').value;try{const res=await db.auth.signInWithPassword({email:user.email,password:pw});if(res.error)throw Error('Password verification failed');$('unlockPassword').value='';$('settingsGate').classList.add('hidden');$('settingsContent').classList.remove('hidden');$('rosterform').onsubmit=addRoster;$('holidayform').onsubmit=addHoliday;await refreshSettings()}catch(err){status(err.message,true,'unlockStatus')}}}catch(e){status(e.message,true,'unlockStatus')}}
async function refreshSettings(){try{roster=await check(await db.from('engineer_roster').select('*').order('full_name'));holidays=await check(await db.from('holidays').select('*').order('holiday_date'));renderSettingsRoster();renderSettingsHolidays()}catch(e){status(e.message,true)}}
function renderSettingsHolidays(){$('holidaylist').innerHTML=holidays.map(h=>`<div class="item"><div><b>${esc(h.title)}</b><div class="muted small">${esc(h.holiday_date)}</div></div><button class="danger" onclick="removeHoliday('${h.holiday_date}')">Remove</button></div>`).join('')||'<p class="muted">No holidays configured.</p>'}
function renderSettingsRoster(){$('rosterlist').innerHTML=roster.map(r=>`<div class="item settings-row"><div><strong>${esc(r.full_name)}</strong><div class="muted small">${esc(r.employee_code)} · ${esc(r.email)}</div></div><div class="controlrow"><label>Role <select onchange="setRosterRole('${r.id}',this.value)"><option value="engineer" ${r.access_role==='engineer'?'selected':''}>Testing Engineer</option><option value="admin" ${r.access_role==='admin'?'selected':''}>Admin</option></select></label><label>Count in Attendance <select onchange="setAttendanceIncluded('${r.id}',this.value==='true')"><option value="true" ${r.attendance_included!==false?'selected':''}>Yes</option><option value="false" ${r.attendance_included===false?'selected':''}>No</option></select></label><button onclick="setRosterActive('${r.id}',${!r.active})">${r.active?'Deactivate':'Activate'}</button></div></div>`).join('')||'<p class="muted">No engineers registered.</p>'}
async function addRoster(e){e.preventDefault();try{const row={full_name:$('rosterName').value.trim(),employee_code:$('rosterCode').value.trim(),email:$('rosterEmail').value.trim().toLowerCase(),access_role:$('rosterRole').value,attendance_included:$('rosterCount').value==='true',active:true};await check(await db.from('engineer_roster').insert(row));$('rosterform').reset();status('Engineer added. Account can now be activated using registered email.',false,'rosterMessage');await refreshSettings()}catch(e){status(e.message,true,'rosterMessage')}}
async function setAttendanceIncluded(id,attendance_included){try{await check(await db.from('engineer_roster').update({attendance_included}).eq('id',id));status('Attendance inclusion updated.',false,'rosterMessage');await refreshSettings()}catch(e){status(e.message,true,'rosterMessage');await refreshSettings()}}
async function setRosterRole(id,access_role){if(!confirm('Change role to '+(access_role==='admin'?'Admin':'Testing Engineer')+'?'))return refreshSettings();try{await check(await db.from('engineer_roster').update({access_role}).eq('id',id));status('Role updated. User must sign out and sign in again.',false,'rosterMessage');await refreshSettings()}catch(e){status(e.message,true,'rosterMessage')}}
async function setRosterActive(id,active){try{await check(await db.from('engineer_roster').update({active}).eq('id',id));await refreshSettings()}catch(e){status(e.message,true,'rosterMessage')}}
async function addHoliday(e){e.preventDefault();const s=$('holidaydate').value;if(date(s).getDay()===0)return status('Sunday already weekly off',true);try{await check(await db.from('holidays').upsert({holiday_date:s,title:$('holidayname').value.trim()}));$('holidayform').reset();await refreshSettings()}catch(e){status(e.message,true)}}
async function removeHoliday(s){if(!confirm('Remove holiday?'))return;try{await check(await db.from('holidays').delete().eq('holiday_date',s));await refreshSettings()}catch(e){status(e.message,true)}}

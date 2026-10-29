
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
// PILOT ONLY: employee-ID credential flow. For production, replace with strong independent secrets.
const loginAlias=code=>'employee-'+String(code).trim().toLowerCase().replace(/[^a-z0-9]/g,'')+'@leave-login.invalid';
const loginSecret=code=>'Vertiv-Leave-'+String(code).trim(); // Supabase minimum password length compatibility; not a security enhancement.
async function startLogin(){registerSW();try{db=client();const session=(await db.auth.getSession()).data.session;if(session){await route(session.user);return}$('legacyLogin').onsubmit=async e=>{e.preventDefault();try{const r=await db.auth.signInWithPassword({email:$('legacyEmail').value.trim(),password:$('legacyPassword').value});if(r.error)throw r.error;await route(r.data.user)}catch(err){status(err.message,true)}};$('login').onsubmit=async e=>{e.preventDefault();status('Signing in…');try{const name=$('loginName').value.trim().toLowerCase(),code=$('loginCode').value.trim();if(!name||!code)throw Error('Name and employee ID required.');let r=await db.auth.signInWithPassword({email:loginAlias(code),password:loginSecret(code)});if(r.error)throw Error('Name or employee ID incorrect, or account not provisioned.');const p=await check(await db.from('profiles').select('full_name,active').eq('id',r.data.user.id).single());if(!p.active||p.full_name.trim().toLowerCase()!==name){await db.auth.signOut();throw Error('Name and employee ID do not match.')}await route(r.data.user)}catch(err){status(err.message,true)}}}catch(e){status(e.message,true)}}
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
async function addRoster(e){e.preventDefault();const btn=e.submitter;btn.disabled=true;try{
 const full_name=$('rosterName').value.trim(),employee_code=$('rosterCode').value.trim(),access_role=$('rosterRole').value,attendance_included=$('rosterCount').value==='true';
 if(!/^[A-Za-z0-9_-]{4,40}$/.test(employee_code))throw Error('Employee code: 4–40 letters/numbers/_/-.');
 const exists=await db.from('engineer_roster').select('id').eq('employee_code',employee_code).maybeSingle();if(exists.error)throw exists.error;if(exists.data)throw Error('This employee ID is already in the roster.');
 // Create roster first, so database signup trigger can validate that the ID belongs to an admin-added employee.
 const email=loginAlias(employee_code);
 const insert=await db.from('engineer_roster').insert({full_name,employee_code,email,access_role,attendance_included,active:true}).select('id').single();if(insert.error)throw insert.error;
 // Dedicated client avoids replacing the admin's login session.
 const provision=window.supabase.createClient(window.LEAVE_CONFIG.url,window.LEAVE_CONFIG.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const res=await provision.auth.signUp({email,password:loginSecret(employee_code)});
 if(res.error){await db.from('engineer_roster').delete().eq('id',insert.data.id);throw new Error('Account provisioning failed: '+res.error.message+'; ensure email confirmations are disabled for this pilot.');}
 if(!res.data.user||!res.data.session)throw Error('Auth account created but not confirmed. Disable email confirmation for pilot, or use secure production authentication.');
 $('rosterform').reset();status('Engineer login provisioned. Name + Employee ID ready for testing.',false,'rosterMessage');await refreshSettings();
}catch(err){status(err.message,true,'rosterMessage')}finally{btn.disabled=false}}
async function setAttendanceIncluded(id,attendance_included){try{await check(await db.from('engineer_roster').update({attendance_included}).eq('id',id));status('Attendance inclusion updated.',false,'rosterMessage');await refreshSettings()}catch(e){status(e.message,true,'rosterMessage');await refreshSettings()}}
async function setRosterRole(id,access_role){if(!confirm('Change role to '+(access_role==='admin'?'Admin':'Testing Engineer')+'?'))return refreshSettings();try{await check(await db.from('engineer_roster').update({access_role}).eq('id',id));status('Role updated. User must sign out and sign in again.',false,'rosterMessage');await refreshSettings()}catch(e){status(e.message,true,'rosterMessage')}}
async function setRosterActive(id,active){try{await check(await db.from('engineer_roster').update({active}).eq('id',id));await refreshSettings()}catch(e){status(e.message,true,'rosterMessage')}}
async function addHoliday(e){e.preventDefault();const s=$('holidaydate').value;if(date(s).getDay()===0)return status('Sunday already weekly off',true);try{await check(await db.from('holidays').upsert({holiday_date:s,title:$('holidayname').value.trim()}));$('holidayform').reset();await refreshSettings()}catch(e){status(e.message,true)}}
async function removeHoliday(s){if(!confirm('Remove holiday?'))return;try{await check(await db.from('holidays').delete().eq('holiday_date',s));await refreshSettings()}catch(e){status(e.message,true)}}

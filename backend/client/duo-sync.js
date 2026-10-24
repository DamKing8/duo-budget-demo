/* Duo Budget cloud sync (phase 1: built and tested offline; OFF by default).
   Talks to Supabase only through supabase-js (public project URL + anon key from SYNC_CONFIG; never any
   privileged key). Syncs budget_items, goals, pay_cycles and then spend_entries for the signed-in user's household:
   - last-write-wins on updated_at (the server also ignores stale writes, see schema.sql tg_sync_row)
   - offline queue in localStorage (coalesced per row), flushed when online and signed in
   - pull on start/online/timer using server_updated_at cursors, plus realtime for the partner's edits
   - soft deletes (deleted_at), never hard deletes
   Inlined into index.html between SYNC markers by tools/inline-sync.js; also require()-able for tests. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DuoSync=factory();})(this,function(){
'use strict';
var TABLES=['budget_items','goals','pay_cycles','spend_entries'];
function stable(o){if(o===null||typeof o!=='object')return JSON.stringify(o);if(Array.isArray(o))return '['+o.map(stable).join(',')+']';return '{'+Object.keys(o).sort().map(function(k){return JSON.stringify(k)+':'+stable(o[k]);}).join(',')+'}';}
function uuid(){if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();var b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=b[6]&15|64;b[8]=b[8]&63|128;var h=Array.prototype.map.call(b,function(x){return (x+256).toString(16).slice(1);}).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
function ts(x){return x?Date.parse(x):0;}
function num(v){return v===null||v===undefined?0:Math.round(Number(v)*100)/100;}

/* opts: {config, storageKey, app:{getState, commit(reason), localId(), setPay(slot,{cycle,next}), getPay(slot)},
          createClient (supabase-js createClient), storage (localStorage-like), now(), onStatus(status), online() } */
function create(opts){
  var cfg=opts.config||{},store=opts.storage,app=opts.app,now=opts.now||function(){return Date.now();};
  var MK=opts.storageKey+'.sync';
  var meta=load();var client=null,session=null,ctx=null,channel=null,applying=false,timer=null,flushing=null,status={state:'starting',pending:0};
  function load(){try{var m=JSON.parse(store.getItem(MK)||'null');if(m&&m.v===1)return m;}catch(e){}return {v:1,ids:{},snap:{},ua:{},cursor:{},queue:[],household:null};}
  function persist(){try{store.setItem(MK,JSON.stringify(meta));}catch(e){}}
  function setStatus(s,msg){status={state:s,pending:meta.queue.length,msg:msg||'',household:meta.household,user:session&&session.user?session.user.email:null,debug:debugInfo(s)};if(opts.onStatus)opts.onStatus(status);}
  // ---- no-secrets diagnostics (shown as the "Sync status" line)
  var dbg={lastEvent:'-',lastError:'-',urlReturn:'-'};
  function displayMode(){try{if(typeof navigator!=='undefined'&&navigator.standalone)return 'home-screen';if(typeof matchMedia!=='undefined'&&matchMedia('(display-mode: standalone)').matches)return 'home-screen';}catch(e){}return 'browser';}
  function storageOk(){try{var k='__duo_probe';store.setItem(k,'1');if(store.removeItem)store.removeItem(k);return 'ok';}catch(e){return 'blocked';}}
  function debugInfo(s){return {state:s,mode:displayMode(),storage:storageOk(),session:session?'yes':'no',household:meta.household?'linked':'none',pending:meta.queue.length,lastEvent:dbg.lastEvent,lastError:dbg.lastError,urlReturn:dbg.urlReturn,online:isOnline()?'yes':'no'};}
  function fail(code,msg){dbg.lastError=code;setStatus('error',msg);}
  // Read what the OAuth round trip put in the URL BEFORE supabase-js looks at it, then strip auth params.
  var AUTH_PARAMS=['code','error','error_code','error_description','sb','state'];
  function readAuthReturn(){
    var loc=opts.location||(typeof location!=='undefined'?location:null);if(!loc)return null;
    var q=new URLSearchParams(loc.search||''),h=new URLSearchParams((loc.hash||'').replace(/^#/,''));
    var err=q.get('error')||h.get('error'),desc=q.get('error_description')||h.get('error_description')||'',code=q.get('code');
    if(err){
      // clean the URL so a reload doesn't re-show the error (keep any non-auth params)
      AUTH_PARAMS.forEach(function(k){q.delete(k);});var qs=q.toString();
      var hist=opts.history||(typeof history!=='undefined'?history:null);
      if(hist&&hist.replaceState)try{hist.replaceState(null,'',loc.pathname+(qs?'?'+qs:''));}catch(e){}
      dbg.urlReturn='error';return {error:err,description:desc};}
    if(code){dbg.urlReturn='code';return {code:true};}
    return null;
  }
  function cleanCodeFromUrl(){var loc=opts.location||(typeof location!=='undefined'?location:null),hist=opts.history||(typeof history!=='undefined'?history:null);
    if(!loc||!hist||!hist.replaceState)return;var q=new URLSearchParams(loc.search||'');if(!q.get('code'))return;AUTH_PARAMS.forEach(function(k){q.delete(k);});var qs=q.toString();try{hist.replaceState(null,'',loc.pathname+(qs?'?'+qs:''));}catch(e){}}
  function authErrorMessage(r){
    var d=(r.description||'').replace(/\+/g,' ');
    if(r.error==='access_denied')return 'Google sign-in didn\'t complete'+(d?' ('+d+')':'')+'. If you didn\'t cancel, this Google account may not be on the app\'s test-user list yet.';
    return 'Sign-in failed: '+r.error+(d?' ('+d+')':'')+'.';
  }
  function isOnline(){return opts.online?opts.online():true;}

  // ---------------------------------------------------------------- mapping local <-> cloud
  // Slots: the app has partner slots D and N. D = the earliest-joined ACTIVE member, N = the other one.
  function buildCtx(hh,members){
    var act=members.filter(function(m){return m.status==='active'&&!m.deleted_at;}).sort(function(a,b){return a.joined_at<b.joined_at?-1:1;});
    var rest=members.filter(function(m){return act.indexOf(m)<0;}).sort(function(a,b){return a.joined_at>b.joined_at?-1:1;});
    var D=act[0]||null,N=act[1]||rest[0]||null;
    return {household:hh,members:members,slot:{D:D&&D.id,N:N&&N.id},bySlotName:{D:D&&D.display_name,N:N&&N.display_name},me:session&&session.user?session.user.id:null};
  }
  function slotOf(mid){if(!mid)return null;return mid===ctx.slot.D?'D':mid===ctx.slot.N?'N':null;}
  var idToKey=null;
  function reindex(){idToKey={};for(var k in meta.ids)if(meta.ids[k])idToKey[meta.ids[k]]=k;}
  function cid(key){if(!meta.ids[key]){meta.ids[key]=uuid();if(!idToKey)reindex();idToKey[meta.ids[key]]=key;}return meta.ids[key];}
  function keyOf(cloudId){if(!cloudId)return null;if(!idToKey)reindex();return idToKey[cloudId]||null;}
  var PREFIX={i:'budget_items',g:'goals',p:'pay_cycles',s:'spend_entries'};
  function tableForKey(k){return PREFIX[k.charAt(0)]||null;}
  // current local records per table, cloud-shaped (without sync columns).
  // Spend rows whose budget line did not already have a cloud id are held back one pass.
  function localRecords(){
    var S=app.getState(),hh=ctx.household,out={budget_items:{},goals:{},pay_cycles:{},spend_entries:{}},held={},known={};
    for(var kk in meta.ids)known[kk]=meta.ids[kk];
    (S.items||[]).forEach(function(it,i){var k='i:'+it.id;out.budget_items[k]={id:cid(k),household_id:hh,name:it.name,amount:num(it.amount),freq:it.freq,category:it.cat,tag:it.tag||'',owner_member_id:it.owner==='J'?null:(ctx.slot[it.owner]||null),sort_order:i};});
    (S.goals||[]).forEach(function(g,i){var k='g:'+g.id,c=g.customF||{},cs={};if(g.split==='custom'){if(ctx.slot.D)cs[ctx.slot.D]=num(c.D);if(ctx.slot.N)cs[ctx.slot.N]=num(c.N);}
      out.goals[k]={id:cid(k),household_id:hh,name:g.name,emoji:g.emoji||'',target:num(g.target),saved:num(g.saved),per_fortnight:num(g.perF),target_date:g.targetDate||null,owner_member_id:g.who==='both'?null:(ctx.slot[g.who]||null),split:g.split||'even',custom_split:cs,sort_order:i};});
    ['D','N'].forEach(function(s){var p=app.getPay(s),m=ctx.slot[s];if(!p||!m||!p.next)return;var k='p:'+m;out.pay_cycles[k]={id:cid(k),household_id:hh,member_id:m,cycle:p.cycle,next_pay_date:p.next};});
    (S.spends||[]).forEach(function(e){
      var k='s:'+e.id,itemCloud=null;
      if(e.itemId){
        if(known['i:'+e.itemId])itemCloud=meta.ids['i:'+e.itemId]||null;
        else if((S.items||[]).some(function(it){return it.id===e.itemId;})){held[k]=1;return;}
      }
      out.spend_entries[k]={id:cid(k),household_id:hh,budget_item_id:itemCloud,line_name:String(e.lineName||'').slice(0,120),category:e.cat,owner_member_id:e.owner==='J'?null:(ctx.slot[e.owner]||null),paid_by_member_id:e.paidBy?(ctx.slot[e.paidBy]||null):null,amount:num(e.amount),spent_on:e.on,note:String(e.note||'').slice(0,120)};
    });
    return {recs:out,held:held};
  }
  function cloudShape(t,row){var r={};var cols={budget_items:['id','household_id','name','amount','freq','category','tag','owner_member_id','sort_order'],goals:['id','household_id','name','emoji','target','saved','per_fortnight','target_date','owner_member_id','split','custom_split','sort_order'],pay_cycles:['id','household_id','member_id','cycle','next_pay_date'],spend_entries:['id','household_id','budget_item_id','line_name','category','owner_member_id','paid_by_member_id','amount','spent_on','note']}[t];
    cols.forEach(function(c){var v=row[c];if(['amount','target','saved','per_fortnight'].indexOf(c)>=0)v=num(v);if(c==='custom_split'){var o={};Object.keys(v||{}).forEach(function(k){o[k]=num(v[k]);});v=o;}r[c]=v===undefined?null:v;});return r;}
  function applyToLocal(t,row){
    var S=app.getState(),k=keyOf(row.id);
    if(t==='pay_cycles'){var s=slotOf(row.member_id);if(!s)return false;k='p:'+row.member_id;meta.ids[k]=row.id;if(!idToKey)reindex();idToKey[row.id]=k;if(row.deleted_at)return true;app.setPay(s,{cycle:row.cycle,next:row.next_pay_date});return true;}
    if(t==='spend_entries'){
      var sl=S.spends||(S.spends=[]),sp='s:',si=-1;
      if(k)for(var sj=0;sj<sl.length;sj++)if(sp+sl[sj].id===k){si=sj;break;}
      if(row.deleted_at){if(si>=0)sl.splice(si,1);return true;}
      var itemKey=row.budget_item_id?keyOf(row.budget_item_id):null;
      var itemId=itemKey&&itemKey.indexOf('i:')===0?itemKey.slice(2):null;
      var scur=si>=0?sl[si]:{id:app.localId(),at:ts(row.created_at)||now()};
      scur.itemId=itemId;scur.lineName=row.line_name||'';scur.cat=row.category;
      scur.owner=slotOf(row.owner_member_id)||'J';scur.paidBy=slotOf(row.paid_by_member_id)||null;
      scur.amount=num(row.amount);scur.on=String(row.spent_on||'').slice(0,10);scur.note=row.note||'';
      if(!scur.at)scur.at=now();
      if(si<0){sl.push(scur);meta.ids[sp+scur.id]=row.id;if(!idToKey)reindex();idToKey[row.id]=sp+scur.id;}
      return true;
    }
    var list=t==='budget_items'?S.items:S.goals,pre=t==='budget_items'?'i:':'g:';
    var idx=-1;if(k)for(var i=0;i<list.length;i++)if(pre+list[i].id===k){idx=i;break;}
    if(row.deleted_at){if(idx>=0)list.splice(idx,1);return true;}
    var cur=idx>=0?list[idx]:{id:app.localId()};
    if(t==='budget_items'){cur.name=row.name;cur.amount=num(row.amount);cur.freq=row.freq;cur.cat=row.category;cur.tag=row.tag||'';cur.owner=slotOf(row.owner_member_id)||'J';}
    else{var cs=row.custom_split||{};cur.name=row.name;cur.emoji=row.emoji||'';cur.target=num(row.target);cur.saved=num(row.saved);cur.perF=num(row.per_fortnight);cur.targetDate=row.target_date||'';cur.who=slotOf(row.owner_member_id)||'both';cur.split=row.split;cur.customF={D:num(cs[ctx.slot.D]),N:num(cs[ctx.slot.N])};}
    if(idx<0){list.push(cur);meta.ids[pre+cur.id]=row.id;if(!idToKey)reindex();idToKey[row.id]=pre+cur.id;idx=list.length-1;}
    // sort_order is already a column. Reorder in place so a partner's expense order arrives without a schema change.
    if(t==='budget_items'&&row.sort_order!=null&&isFinite(+row.sort_order)){
      var to=Math.max(0,Math.min(list.length-1,Math.round(+row.sort_order)));
      if(to!==idx){list.splice(idx,1);list.splice(to,0,cur);}
    }
    return true;
  }

  // ---------------------------------------------------------------- local change detection -> queue
  function enqueue(t,row){meta.queue=meta.queue.filter(function(q){return !(q.t===t&&q.row.id===row.id);});meta.queue.push({t:t,row:row});}
  function onLocalSave(){
    if(!ctx||applying)return;
    var pack=localRecords(),recs=pack.recs,held=pack.held,stamp=new Date(now()).toISOString(),seen={};
    TABLES.forEach(function(t){Object.keys(recs[t]).forEach(function(k){var r=recs[t][k],h=stable(r);seen[k]=1;if(meta.snap[k]!==h){meta.snap[k]=h;meta.ua[r.id]=stamp;r.updated_at=stamp;r.deleted_at=null;enqueue(t,r);}});});
    Object.keys(held).forEach(function(k){seen[k]=1;});
    Object.keys(meta.snap).forEach(function(k){if(seen[k])return;var id=meta.ids[k],t=tableForKey(k);if(!id||!t)return;
      var r=JSON.parse(meta.snap[k]);r.updated_at=stamp;r.deleted_at=stamp;meta.ua[id]=stamp;delete meta.snap[k];enqueue(t,r);});
    persist();setStatus(meta.queue.length?'pending':'synced');scheduleFlush();
    // a spend on a line that only just received a cloud id waits until that id exists, then queues
    if(Object.keys(held).length&&!onLocalSave.follow){onLocalSave.follow=1;try{onLocalSave();}finally{onLocalSave.follow=0;}}
  }
  function scheduleFlush(){if(timer)clearTimeout(timer);timer=setTimeout(function(){timer=null;flush();},opts.flushDelay===undefined?800:opts.flushDelay);}

  // ---------------------------------------------------------------- push / pull / realtime
  function flush(){
    if(flushing)return flushing;
    if(!client||!ctx||!meta.queue.length)return Promise.resolve();
    if(!isOnline()){setStatus('offline','Saved on this phone. Will sync when you\'re back online.');return Promise.resolve();}
    var batch=meta.queue.slice();
    flushing=TABLES.reduce(function(p,t){var rows=batch.filter(function(q){return q.t===t;}).map(function(q){return q.row;});if(!rows.length)return p;
      return p.then(function(){return client.from(t).upsert(rows,{onConflict:'id'});}).then(function(res){if(res&&res.error)throw res.error;
        meta.queue=meta.queue.filter(function(q){return !(q.t===t&&rows.some(function(r){return r.id===q.row.id&&r.updated_at===q.row.updated_at;}));});persist();});},Promise.resolve())
      .then(function(){setStatus(meta.queue.length?'pending':'synced');},function(e){setStatus('error',(e&&e.message)||String(e));})
      .then(function(){flushing=null;});
    return flushing;
  }
  // merge one remote row with last-write-wins; returns true if local state changed
  function mergeRemote(t,row){
    if(!row||row.household_id!==ctx.household)return false;
    if(row.server_updated_at&&ts(row.server_updated_at)>ts(meta.cursor[t]))meta.cursor[t]=row.server_updated_at;
    var pend=meta.queue.find(function(q){return q.t===t&&q.row.id===row.id;});
    if(pend&&ts(pend.row.updated_at)>ts(row.updated_at))return false;              // our queued edit is newer
    var mine=meta.ua[row.id];if(mine&&ts(mine)>=ts(row.updated_at)&&!pend)return false; // echo of our own write, or older
    if(pend)meta.queue=meta.queue.filter(function(q){return q!==pend;});
    meta.ua[row.id]=row.updated_at;
    var changed=applyToLocal(t,row);
    var k=keyOf(row.id);if(k){if(row.deleted_at)delete meta.snap[k];else meta.snap[k]=stable(cloudShape(t,row));}
    return changed;
  }
  function commitRemote(n,reason){if(!n)return;applying=true;try{app.commit(reason||'sync');}finally{applying=false;}persist();}
  function pull(){
    if(!client||!ctx)return Promise.resolve(0);
    if(!isOnline()){setStatus('offline');return Promise.resolve(0);}
    var changed=0;
    return TABLES.reduce(function(p,t){return p.then(function(){var q=client.from(t).select('*').eq('household_id',ctx.household);if(meta.cursor[t])q=q.gt('server_updated_at',meta.cursor[t]);
      return q.order('server_updated_at',{ascending:true});}).then(function(res){if(res.error)throw res.error;(res.data||[]).forEach(function(r){if(mergeRemote(t,r))changed++;});});},Promise.resolve())
      .then(function(){commitRemote(changed,'pull');setStatus(meta.queue.length?'pending':'synced');return changed;},function(e){setStatus('error',(e&&e.message)||String(e));return 0;});
  }
  function subscribe(){
    if(channel||!client.channel)return;
    channel=client.channel('duo-'+ctx.household);
    TABLES.forEach(function(t){channel=channel.on('postgres_changes',{event:'*',schema:'public',table:t,filter:'household_id=eq.'+ctx.household},function(payload){if(mergeRemote(t,payload.new))commitRemote(1,'realtime');else persist();});});
    channel=channel.subscribe();
  }

  // ---------------------------------------------------------------- household + auth
  function loadHousehold(){
    return client.from('household_members').select('*').then(function(res){if(res.error)throw res.error;
      var mine=(res.data||[]).find(function(m){return m.user_id===ctx0().me&&m.status==='active';});
      if(!mine){ctx=null;setStatus('no-household');return null;}
      ctx=buildCtx(mine.household_id,(res.data||[]).filter(function(m){return m.household_id===mine.household_id;}));
      var first=meta.household!==ctx.household;
      if(first){meta={v:1,ids:{},snap:{},ua:{},cursor:{},queue:[],household:ctx.household};idToKey={};}
      var S=app.getState();if(ctx.bySlotName.D)S.names.D=ctx.bySlotName.D;if(ctx.bySlotName.N)S.names.N=ctx.bySlotName.N;
      return pull().then(function(n){
        // first link: if the cloud household already has data it wins (adopt it); otherwise upload this phone's data
        if(first){var S2=app.getState();var cloudHas=Object.keys(meta.snap).some(function(k){return k[0]==='i';});
          if(cloudHas){S2.items=S2.items.filter(function(it){return meta.ids['i:'+it.id];});S2.goals=S2.goals.filter(function(g){return meta.ids['g:'+g.id];});S2.spends=(S2.spends||[]).filter(function(e){return meta.ids['s:'+e.id];});commitRemote(1,'adopt');}}
        onLocalSave();subscribe();return flush();}).then(function(){return ctx.household;});
    });
  }
  function ctx0(){return {me:session&&session.user?session.user.id:null};}
  var authFlight=null,authFor=null;
  function afterAuth(s){session=s;if(!s){ctx=null;authFlight=null;authFor=null;setStatus('signed-out');return Promise.resolve(null);}
    var uid=s.user&&s.user.id;if(authFlight&&authFor===uid)return authFlight;   // SIGNED_IN event + getSession both arrive: link once
    authFor=uid;authFlight=loadHousehold().catch(function(e){dbg.lastError=(e&&e.code)||'load_failed';setStatus('error',e.message||String(e));});return authFlight;}
  function start(){
    if(!cfg.enabled){setStatus('off');return Promise.resolve(api);}
    if(opts.blocked){setStatus('blocked',opts.blocked);return Promise.resolve(api);}
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl||'')&&!cfg.allowAnyUrl){setStatus('error','Set SYNC_CONFIG.supabaseUrl to your project URL');return Promise.resolve(api);}
    var ret=readAuthReturn();
    if(storageOk()==='blocked'){fail('storage_blocked','This browser is blocking storage (Private Browsing or a strict setting), so sign-in can\'t be kept. Open Duo Budget in a normal Safari tab.');return Promise.resolve(api);}
    client=opts.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
    if(client.auth.onAuthStateChange)client.auth.onAuthStateChange(function(ev,s){dbg.lastEvent=ev;if(ev==='SIGNED_IN'&&s)afterAuth(s);if(ev==='SIGNED_OUT')afterAuth(null);});
    return client.auth.getSession().then(function(r){
      var s=r&&r.data?r.data.session:null,e=r&&r.error;
      if(ret&&ret.error){session=s;fail(ret.error,authErrorMessage(ret));return s?afterAuth(s):null;}
      if(ret&&ret.code&&!s){cleanCodeFromUrl();
        fail(e&&e.code?e.code:'code_exchange_failed',(e&&e.message?'Sign-in didn\'t finish: '+e.message+'. ':'Sign-in didn\'t finish on this screen. ')+(displayMode()==='home-screen'?'You opened Duo Budget from the Home Screen: open the site in Safari and sign in there instead.':'Sign-in has to start and finish in the same browser tab. Tap Sign in with Google again.'));return null;}
      if(e){fail(e.code||'session_error',e.message||String(e));return null;}
      return afterAuth(s);
    },function(e){fail('session_error',(e&&e.message)||String(e));}).then(function(){return api;});
  }
  var api={
    start:start,onLocalSave:onLocalSave,flush:flush,pull:pull,status:function(){return status;},meta:function(){return meta;},
    debug:function(){return debugInfo(status.state);},
    signIn:function(){dbg.lastError='-';return client.auth.signInWithOAuth({provider:'google',options:{redirectTo:opts.redirectTo||(typeof location!=='undefined'?location.origin+location.pathname:undefined)}}).then(function(r){if(r&&r.error)fail(r.error.code||'oauth_start_failed','Couldn\'t start Google sign-in: '+r.error.message);return r;},function(e){fail('oauth_start_failed','Couldn\'t start Google sign-in: '+((e&&e.message)||e));});},
    // Email code. No emailRedirectTo: the 6-digit code must work from any origin, including a preview tunnel.
    signInWithEmail:function(email){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.signInWithOtp)return Promise.resolve({error:{message:'Email sign-in isn\'t available in this build.'}});
      return client.auth.signInWithOtp({email:String(email||'').trim(),options:{shouldCreateUser:true}}).then(function(r){return r||{};},function(e){return {error:{message:(e&&e.message)||'Couldn\'t send the code.'}};});},
    verifyEmailCode:function(email,token){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.verifyOtp)return Promise.resolve({error:{message:'Email sign-in isn\'t available in this build.'}});
      return client.auth.verifyOtp({email:String(email||'').trim(),token:String(token||'').replace(/\D/g,''),type:'email'}).then(function(r){
        var s=r&&r.data&&r.data.session;if(s)return afterAuth(s).then(function(){return r;});return r||{};
      },function(e){return {error:{message:(e&&e.message)||'Couldn\'t check that code.'}};});},
    signOut:function(){if(channel&&client.removeChannel)client.removeChannel(channel);channel=null;return client.auth.signOut().then(function(){return afterAuth(null);});},
    createHousehold:function(name,display){return client.rpc('create_household',{p_name:name,p_display_name:display}).then(function(r){if(r.error)throw r.error;return loadHousehold();});},
    createInvite:function(){return client.rpc('create_invite',{p_household:ctx.household}).then(function(r){if(r.error)throw r.error;return r.data;});},
    joinHousehold:function(code,display){return client.rpc('join_household',{p_code:code,p_display_name:display}).then(function(r){if(r.error)throw r.error;if(!r.data||!r.data.ok)return r.data;return loadHousehold().then(function(){return r.data;});});},
    leaveHousehold:function(){return client.rpc('leave_household',{p_household:ctx.household}).then(function(r){if(r.error)throw r.error;return afterAuth(session);});},
    online:function(){pull().then(flush);}
  };
  return api;
}
return {create:create,TABLES:TABLES,_stable:stable};
});

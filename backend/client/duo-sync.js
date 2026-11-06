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
// create_invite is not defined in this repo. public.invites stores code and expires_at
// (default now() + 7 days). The RPC may return that row, a one-row array, or the code text.
function readInvite(data){
  var row=data;
  if(Array.isArray(row))row=row[0];
  if(row&&typeof row==='object'&&row.data&&row.code==null&&row.invite_code==null)row=row.data;
  if(Array.isArray(row))row=row[0];
  if(typeof row==='string'){var t=row.trim();return t?{code:t,expires:''}:null;}
  if(!row||typeof row!=='object')return null;
  var code=row.code||row.invite_code||'';
  if(!code)return null;
  return {code:String(code).trim(),expires:row.expires_at||row.expiresAt||row.expires||''};
}
function shouldOfferInvite(st){
  return !!(st&&['synced','pending','offline'].indexOf(st.state)>=0&&st.members===1);
}
// Sample and bucket labels are not a person's name. The email's local part is the fallback.
function realDisplayName(typed, email){
  var t=String(typed||'').trim();
  var low=t.toLowerCase();
  if(t&&low!=='me'&&low!=='partner'&&low!=='chloe'&&low!=='jack')return t.slice(0,60);
  var local=String(email||'').split('@')[0]||'';
  local=local.replace(/[^\w.+-]/g,'').slice(0,60);
  return local||'Me';
}
function householdTitle(name){
  name=String(name||'').trim();
  if(!name||name.toLowerCase()==='me')return 'Our household';
  return name.slice(0,60)+"'s household";
}
function isSampleName(n){
  var t=String(n||'').trim().toLowerCase();
  return !t||t==='chloe'||t==='jack'||t==='me'||t==='partner';
}
function settledNames(local, info){
  local=local||{}; info=info||{};
  var D=local.D, N=local.N;
  if(isSampleName(D))D=!isSampleName(info.myName)?info.myName:realDisplayName('', info.email);
  if(isSampleName(N))N=info.partnerName&&!isSampleName(info.partnerName)?info.partnerName:'';
  return {D:D,N:N};
}
function needsRenamePrompt(info){
  info=info||{};
  return isSampleName(info.householdName)||isSampleName(info.myName);
}

/* opts: {config, storageKey, app:{getState, commit(reason), localId(), setPay(slot,{cycle,next}), getPay(slot)},
          createClient (supabase-js createClient), storage (localStorage-like), now(), onStatus(status), online() } */
function create(opts){
  var cfg=opts.config||{},store=opts.storage,app=opts.app,now=opts.now||function(){return Date.now();};
  var MK=opts.storageKey+'.sync';
  var meta=load();var client=null,session=null,ctx=null,channel=null,applying=false,timer=null,flushing=null,status={state:'starting',pending:0};
  var linkChoiceOnce=null,pendingHouseholdName='';
  function load(){try{var m=JSON.parse(store.getItem(MK)||'null');if(m&&m.v===1)return m;}catch(e){}return {v:1,ids:{},snap:{},ua:{},cursor:{},queue:[],household:null};}
  function persist(){try{store.setItem(MK,JSON.stringify(meta));}catch(e){}}
  function activeMembers(){if(!ctx||!ctx.members)return [];return ctx.members.filter(function(m){return m&&m.status==='active'&&!m.deleted_at;});}
  function meAndPartner(){
    var id=session&&session.user&&session.user.id,mine='',other='';
    activeMembers().forEach(function(m){if(m.user_id===id)mine=m.display_name||'';else if(!other)other=m.display_name||'';});
    return {myName:mine,partnerName:other};
  }
  function setStatus(s,msg){var who=meAndPartner();status={state:s,pending:meta.queue.length,msg:msg||'',household:meta.household,householdName:(ctx&&ctx.householdName)||'',members:activeMembers().length,memberNames:activeMembers().map(function(m){return m.display_name;}).filter(Boolean),myName:who.myName,partnerName:who.partnerName,user:session&&session.user?session.user.email:null,uid:session&&session.user?session.user.id:null,debug:debugInfo(s)};if(opts.onStatus)opts.onStatus(status);}
  // Diagnostics stay in the console. The sync card does not show them.
  var dbg={lastEvent:'-',lastError:'-',urlReturn:'-'};
  function nativeCap(){try{if(typeof Capacitor!=='undefined')return Capacitor;if(typeof window!=='undefined'&&window.Capacitor)return window.Capacitor;}catch(e){}return null;}
  function nativeShell(){var cap=nativeCap();try{return !!(cap&&typeof cap.isNativePlatform==='function'&&cap.isNativePlatform());}catch(e){return false;}}
  function nativePlugin(name){var cap=nativeCap();if(!cap)return null;if(cap.Plugins&&cap.Plugins[name])return cap.Plugins[name];try{if(typeof cap.registerPlugin==='function')return cap.registerPlugin(name);}catch(e){}return null;}
  // Custom scheme the Android manifest and the iOS Info.plist both register. Supabase must allow this exact redirect.
  var NATIVE_AUTH_REDIRECT='au.duobudget.app://auth-callback';
  function displayMode(){try{if(nativeShell())return 'native';if(typeof navigator!=='undefined'&&navigator.standalone)return 'home-screen';if(typeof matchMedia!=='undefined'&&matchMedia('(display-mode: standalone)').matches)return 'home-screen';}catch(e){}return 'browser';}
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
  // Native shell, Android and iOS: Google opens in @capacitor/browser and returns to
  // au.duobudget.app://auth-callback. Browser.close() dismisses that browser (a no-op if it
  // is already gone), then the PKCE code is exchanged. The web build never takes this path.
  var nativeAuthAttached=false,nativeAuthSeen={},disposed=false;
  function isNativeAuthUrl(url){return typeof url==='string'&&url.indexOf(NATIVE_AUTH_REDIRECT)===0;}
  function closeNativeBrowser(){var Browser=nativePlugin('Browser');if(Browser&&Browser.close){try{Promise.resolve(Browser.close()).catch(function(){});}catch(e){}}}
  function handleNativeAuthUrl(url){
    if(!isNativeAuthUrl(url))return;
    closeNativeBrowser();
    if(nativeAuthSeen[url])return;
    nativeAuthSeen[url]=1;
    var parsed;try{parsed=new URL(url);}catch(e){fail('code_exchange_failed','Sign-in came back with a link this app couldn\'t read.');return;}
    var hash=new URLSearchParams((parsed.hash||'').replace(/^#/,''));
    function qp(k){return parsed.searchParams.get(k)||hash.get(k);}
    var err=qp('error');
    if(err){fail(err,authErrorMessage({error:err,description:qp('error_description')||''}));return;}
    var code=qp('code');
    if(!code){fail('code_exchange_failed','Sign-in came back without a code.');return;}
    if(!client||!client.auth||!client.auth.exchangeCodeForSession){fail('code_exchange_failed','This build can\'t finish Google sign-in.');return;}
    client.auth.exchangeCodeForSession(code).then(function(res){
      var e=res&&res.error;
      if(e){fail(e.code||'code_exchange_failed','Sign-in didn\'t finish: '+(e.message||'the code was rejected')+'.');return;}
      var s=res&&res.data&&res.data.session;
      if(s)return afterAuth(s);
      fail('code_exchange_failed','Sign-in didn\'t finish on this screen.');
    },function(e){fail('code_exchange_failed',(e&&e.message)||'Sign-in didn\'t finish.');});
  }
  function attachNativeAuth(){
    if(nativeAuthAttached||!nativeShell())return;
    var App=nativePlugin('App');
    if(!App)return;
    nativeAuthAttached=true;
    if(App.addListener)App.addListener('appUrlOpen',function(ev){handleNativeAuthUrl(ev&&ev.url);});
    if(App.getLaunchUrl)Promise.resolve(App.getLaunchUrl()).then(function(launch){if(launch&&launch.url)handleNativeAuthUrl(launch.url);},function(){});
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
    if(disposed||!ctx||applying)return;
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
  function commitRemote(n,reason){if(disposed||!n)return;applying=true;try{app.commit(reason||'sync');}finally{applying=false;}persist();}
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
  function isGuestBudget(){try{return typeof opts.guestBudget==='function'?!!opts.guestBudget():!!opts.guestBudget;}catch(e){return false;}}
  function localHasData(){var S=app.getState()||{};return !!((S.items&&S.items.length)||(S.goals&&S.goals.length)||(S.spends&&S.spends.length));}
  function clearLocalRows(){var S=app.getState();if(!S)return;S.items=[];S.goals=[];if(S.spends)S.spends=[];}
  function listCloud(){
    return TABLES.reduce(function(p,t){return p.then(function(acc){
      return client.from(t).select('*').eq('household_id',ctx.household).then(function(res){
        if(res&&res.error)throw res.error;acc[t]=(res&&res.data)||[];return acc;
      });
    });},Promise.resolve({}));
  }
  function cloudHasRows(acc){return TABLES.some(function(t){return (acc[t]||[]).some(function(r){return r&&!r.deleted_at;});});}
  function adoptCloudRows(){
    var S2=app.getState();if(!S2)return;
    var cloudHas=Object.keys(meta.snap).some(function(k){return k[0]==='i';});
    if(!cloudHas)return;
    S2.items=(S2.items||[]).filter(function(it){return meta.ids['i:'+it.id];});
    S2.goals=(S2.goals||[]).filter(function(g){return meta.ids['g:'+g.id];});
    S2.spends=(S2.spends||[]).filter(function(e){return meta.ids['s:'+e.id];});
    commitRemote(1,'adopt');
  }
  function finishLink(first, choice){
    if(disposed)return Promise.resolve(null);
    if(choice==='replace-cloud'){
      return listCloud().then(function(acc){
        if(disposed)return null;
        var stamp=new Date(now()).toISOString();
        TABLES.forEach(function(t){(acc[t]||[]).forEach(function(row){
          if(!row||row.deleted_at)return;
          enqueue(t,{id:row.id,household_id:ctx.household,updated_at:stamp,deleted_at:stamp});
        });});
        onLocalSave();subscribe();return flush();
      }).then(function(){return ctx?ctx.household:null;});
    }
    if(choice==='fresh'||choice==='use-cloud')clearLocalRows();
    return pull().then(function(){
      if(disposed)return null;
      // Legacy first link, and "use the account budget": cloud rows stay, phone-only rows do not upload.
      // keep-local skips that filter so a new empty household can take this phone's budget.
      if(first&&choice!=='keep-local')adoptCloudRows();
      onLocalSave();subscribe();return flush();
    }).then(function(){return ctx?ctx.household:null;});
  }
  function loadHousehold(){
    if(disposed)return Promise.resolve(null);
    return client.from('household_members').select('*').then(function(res){if(res.error)throw res.error;
      if(disposed)return null;
      var mine=(res.data||[]).find(function(m){return m.user_id===ctx0().me&&m.status==='active';});
      if(!mine){ctx=null;setStatus('no-household');return null;}
      ctx=buildCtx(mine.household_id,(res.data||[]).filter(function(m){return m.household_id===mine.household_id;}));
      var first=meta.household!==ctx.household;
      if(first){meta={v:1,ids:{},snap:{},ua:{},cursor:{},queue:[],household:ctx.household};idToKey={};}
      var S=app.getState();
      if(S&&ctx.bySlotName.D)S.names.D=ctx.bySlotName.D;
      if(S&&ctx.bySlotName.N)S.names.N=ctx.bySlotName.N;
      else if(S&&S.names){var slotN=String(S.names.N||'').trim().toLowerCase();if(!slotN||slotN==='chloe'||slotN==='jack'||slotN==='me')S.names.N='Partner';}
      return attachHouseholdName(mine.household_id).then(function(){
      if(ctx&&!ctx.householdName&&pendingHouseholdName)ctx.householdName=pendingHouseholdName;
      if(first&&isGuestBudget()&&localHasData()&&(linkChoiceOnce||typeof opts.onLinkChoice==='function')){
        var preset=linkChoiceOnce;
        if(preset){linkChoiceOnce=null;return finishLink(first,preset);}
        return listCloud().then(function(acc){
          if(disposed)return null;
          var cloudHas=cloudHasRows(acc);
          var kind=cloudHas?'choose-cloud':'keep-or-fresh';
          setStatus('choose-budget',cloudHas?'This account already has a budget.':'You have a budget on this phone.');
          return Promise.resolve(opts.onLinkChoice({kind:kind,cloudHas:cloudHas,localHas:true})).then(function(choice){
            if(disposed)return null;
            if(kind==='choose-cloud')choice=choice==='replace-cloud'?'replace-cloud':'use-cloud';
            else choice=choice==='keep-local'?'keep-local':'fresh';
            return finishLink(first,choice);
          });
        });
      }
      return finishLink(first,null);
      });
    });
  }
  function attachHouseholdName(hh){
    if(!client||!client.from)return Promise.resolve();
    return client.from('households').select('name').eq('id',hh).then(function(res){
      var rows=res&&res.data,row=Array.isArray(rows)?rows[0]:rows;
      if(ctx&&row&&row.name)ctx.householdName=row.name;
    },function(){});
  }
  function ctx0(){return {me:session&&session.user?session.user.id:null};}
  var authFlight=null,authFor=null;
  function afterAuth(s){if(disposed)return Promise.resolve(null);session=s;if(!s){ctx=null;authFlight=null;authFor=null;setStatus('signed-out');return Promise.resolve(null);}
    var uid=s.user&&s.user.id;if(authFlight&&authFor===uid)return authFlight;   // SIGNED_IN event + getSession both arrive: link once
    authFor=uid;authFlight=loadHousehold().catch(function(e){dbg.lastError=(e&&e.code)||'load_failed';setStatus('error',e.message||String(e));});return authFlight;}
  function start(){
    if(!cfg.enabled){setStatus('off');return Promise.resolve(api);}
    if(opts.blocked){setStatus('blocked',opts.blocked);return Promise.resolve(api);}
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl||'')&&!cfg.allowAnyUrl){setStatus('error','Set SYNC_CONFIG.supabaseUrl to your project URL');return Promise.resolve(api);}
    var ret=readAuthReturn();
    if(storageOk()==='blocked'){fail('storage_blocked','This browser is blocking storage (Private Browsing or a strict setting), so sign-in can\'t be kept. Open Duo Budget in a normal Safari tab.');return Promise.resolve(api);}
    client=opts.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
    attachNativeAuth();
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
    signIn:function(provider){dbg.lastError='-';
      provider=provider==='apple'?'apple':'google';
      var label=provider==='apple'?'Apple':'Google';
      var native=nativeShell();
      var redirectTo=native?NATIVE_AUTH_REDIRECT:(opts.redirectTo||(typeof location!=='undefined'?location.origin+location.pathname:undefined));
      var options={redirectTo:redirectTo};
      if(native)options.skipBrowserRedirect=true;
      return client.auth.signInWithOAuth({provider:provider,options:options}).then(function(r){
        if(r&&r.error){fail(r.error.code||'oauth_start_failed','Couldn\'t start '+label+' sign-in: '+r.error.message);return r;}
        if(!native)return r;
        var url=r&&r.data&&r.data.url;
        if(!url){fail('oauth_start_failed',label+' sign-in didn\'t return a link to open.');return r;}
        var Browser=nativePlugin('Browser');
        if(!Browser||!Browser.open){fail('native_browser_missing','Couldn\'t open the sign-in browser in this app.');return r;}
        return Promise.resolve(Browser.open({url:url})).then(function(){return r;},function(e){fail('oauth_start_failed','Couldn\'t open '+label+' sign-in: '+((e&&e.message)||e));return r;});
      },function(e){fail('oauth_start_failed','Couldn\'t start '+label+' sign-in: '+((e&&e.message)||e));});},
    signInWithIdToken:function(provider,token,nonce){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.signInWithIdToken)return Promise.resolve({error:{message:'This build can\'t finish that sign-in.'}});
      var body={provider:provider,token:token};
      if(nonce)body.nonce=nonce;
      return client.auth.signInWithIdToken(body).then(function(r){
        var s=r&&r.data&&r.data.session;if(s)return afterAuth(s).then(function(){return r;});return r||{};
      },function(e){return {error:{message:(e&&e.message)||'Couldn\'t finish sign-in.'}};});},
    signInWithPassword:function(email,password){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.signInWithPassword)return Promise.resolve({error:{message:'Password sign-in isn\'t available in this build.'}});
      return client.auth.signInWithPassword({email:String(email||'').trim(),password:String(password||'')}).then(function(r){
        var s=r&&r.data&&r.data.session;if(s)return afterAuth(s).then(function(){return r;});return r||{};
      },function(e){return {error:{message:(e&&e.message)||'Couldn\'t sign in with that password.'}};});},
    updatePassword:function(password){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.updateUser)return Promise.resolve({error:{message:'Couldn\'t save a password in this build.'}});
      return client.auth.updateUser({password:String(password||'')}).then(function(r){return r||{};},function(e){return {error:{message:(e&&e.message)||'Couldn\'t save that password.'}};});},
    // Recovery uses the same 6-digit code as sign-in when the email template contains {{ .Token }}.
    sendRecoveryCode:function(email){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.resetPasswordForEmail)return Promise.resolve({error:{message:'Couldn\'t send a reset code in this build.'}});
      return client.auth.resetPasswordForEmail(String(email||'').trim()).then(function(r){return r||{};},function(e){return {error:{message:(e&&e.message)||'Couldn\'t send a reset code.'}};});},
    verifyRecoveryCode:function(email,token){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.verifyOtp)return Promise.resolve({error:{message:'Couldn\'t check that code.'}});
      return client.auth.verifyOtp({email:String(email||'').trim(),token:String(token||'').replace(/\D/g,''),type:'recovery'}).then(function(r){
        var s=r&&r.data&&r.data.session;if(s)return afterAuth(s).then(function(){return r;});return r||{};
      },function(e){return {error:{message:(e&&e.message)||'Couldn\'t check that code.'}};});},
    // Email code. No emailRedirectTo: the 6-digit code must work from any origin, including a preview tunnel.
    signInWithEmail:function(email){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.signInWithOtp)return Promise.resolve({error:{message:'Email sign-in isn\'t available in this build.'}});
      return client.auth.signInWithOtp({email:String(email||'').trim(),options:{shouldCreateUser:true}}).then(function(r){return r||{};},function(e){return {error:{message:(e&&e.message)||'Couldn\'t send the code.'}};});},
    verifyEmailCode:function(email,token){dbg.lastError='-';
      if(!client||!client.auth||!client.auth.verifyOtp)return Promise.resolve({error:{message:'Email sign-in isn\'t available in this build.'}});
      return client.auth.verifyOtp({email:String(email||'').trim(),token:String(token||'').replace(/\D/g,''),type:'email'}).then(function(r){
        var s=r&&r.data&&r.data.session;if(s)return afterAuth(s).then(function(){return r;});return r||{};
      },function(e){return {error:{message:(e&&e.message)||'Couldn\'t check that code.'}};});},
    signOut:function(){if(channel&&client&&client.removeChannel)client.removeChannel(channel);channel=null;if(!client||!client.auth||!client.auth.signOut)return afterAuth(null);return client.auth.signOut().then(function(){return afterAuth(null);},function(){return afterAuth(null);});},
    stop:function(){disposed=true;if(timer)clearTimeout(timer);timer=null;if(channel&&client&&client.removeChannel)client.removeChannel(channel);channel=null;},
    deleteAccount:function(){
      function rpc(name){
        if(!client||!client.rpc)return Promise.resolve({error:{message:'Account deletion isn\'t available in this build.'}});
        return client.rpc(name).then(function(r){return r||{};},function(e){return {error:{message:(e&&e.message)||'Couldn\'t delete the account.'}};});
      }
      function fallback(){
        return rpc('delete_my_account').then(function(a){
          if(a&&!a.error)return {ok:true,via:'delete_my_account'};
          return rpc('delete_my_data').then(function(b){
            if(b&&b.error)return b;
            return {ok:true,via:'delete_my_data',authUserRemains:true};
          });
        });
      }
      if(client&&client.functions&&client.functions.invoke){
        return client.functions.invoke('delete-account',{body:{}}).then(function(r){
          if(r&&!r.error)return {ok:true,via:'function'};
          return fallback();
        },fallback);
      }
      return fallback();
    },
    linkIdentity:function(provider){
      if(!client||!client.auth||!client.auth.linkIdentity)return Promise.resolve({error:{message:'Linking isn\'t available in this build.'}});
      var native=nativeShell();
      var redirectTo=native?NATIVE_AUTH_REDIRECT:(opts.redirectTo||(typeof location!=='undefined'?location.origin+location.pathname:undefined));
      var options={redirectTo:redirectTo};
      if(native)options.skipBrowserRedirect=true;
      return client.auth.linkIdentity({provider:provider,options:options}).then(function(r){return r||{};},function(e){return {error:{message:(e&&e.message)||'Couldn\'t link that sign-in.'}};});
    },
    unlinkIdentity:function(identity){
      if(!client||!client.auth||!client.auth.unlinkIdentity)return Promise.resolve({error:{message:'Unlinking isn\'t available in this build.'}});
      return client.auth.unlinkIdentity(identity).then(function(r){return r||{};},function(e){return {error:{message:(e&&e.message)||'Couldn\'t remove that sign-in.'}};});
    },
    identities:function(){
      if(!client||!client.auth||!client.auth.getUserIdentities)return Promise.resolve({data:{identities:[]}});
      return client.auth.getUserIdentities().then(function(r){return r||{data:{identities:[]}};},function(){return {data:{identities:[]}};});
    },
    preferLinkChoice:function(choice){linkChoiceOnce=choice||null;},
    createHousehold:function(name,display){pendingHouseholdName=String(name||'').trim();return client.rpc('create_household',{p_name:pendingHouseholdName,p_display_name:display}).then(function(r){if(r.error)throw r.error;return loadHousehold();});},
    createInvite:function(){return client.rpc('create_invite',{p_household:ctx.household}).then(function(r){if(r.error)throw r.error;return r.data;});},
    joinHousehold:function(code,display){return client.rpc('join_household',{p_code:code,p_display_name:display}).then(function(r){if(r.error)throw r.error;if(!r.data||!r.data.ok)return r.data;return loadHousehold().then(function(){return r.data;});});},
    renameHousehold:function(name,display){
      var hh=ctx&&ctx.household,me=null;
      activeMembers().forEach(function(m){if(m.user_id===(session&&session.user&&session.user.id))me=m;});
      if(!hh||!me)return Promise.reject(new Error('Join or start a household first.'));
      var cleanName=String(name||'').trim(),cleanDisplay=String(display||'').trim();
      function done(r){if(r&&r.error)throw r.error;return loadHousehold().then(function(){return {ok:true};});}
      function direct(){
        var stamp=new Date(now()).toISOString();
        return client.from('households').update({name:cleanName,updated_at:stamp}).eq('id',hh).then(function(r){
          if(r&&r.error)throw r.error;
          return client.from('household_members').update({display_name:cleanDisplay,updated_at:stamp}).eq('id',me.id);
        }).then(done);
      }
      if(!client.rpc)return direct();
      return client.rpc('rename_my_household',{p_name:cleanName,p_display_name:cleanDisplay}).then(function(r){
        var msg=r&&r.error&&(r.error.message||'');
        var code=r&&r.error&&r.error.code;
        if(r&&r.error&&(code==='PGRST202'||/rename_my_household|schema cache|Could not find the function/i.test(msg)))return direct();
        return done(r);
      },direct);
    },
    leaveHousehold:function(){return client.rpc('leave_household',{p_household:ctx.household}).then(function(r){if(r.error)throw r.error;return afterAuth(session);});},
    online:function(){pull().then(flush);}
  };
  return api;
}
return {create:create,TABLES:TABLES,_stable:stable,readInvite:readInvite,shouldOfferInvite:shouldOfferInvite,realDisplayName:realDisplayName,householdTitle:householdTitle,isSampleName:isSampleName,settledNames:settledNames,needsRenamePrompt:needsRenamePrompt};
});

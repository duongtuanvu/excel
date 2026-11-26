import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.ts';
import { defaultSettings } from '../src/account-model.ts';
import { hash, randomToken, SESSION_COOKIE, OAUTH_COOKIE, now } from '../worker/security.ts';
import type { Database, Statement, Env } from '../worker/db.ts';

const origin = 'https://test.kysheet.invalid';
type Value = string | number | null;
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(new URL('../migrations/0001_accounts.sql', import.meta.url),'utf8'));
  // Real SQLite statements and transactional batches, with the D1 interface only adapted.
  function statement(sql:string, values:Value[]=[]):Statement {
    return {
      bind: (...args)=>statement(sql,args),
      async first<T>() { return (db.prepare(sql).get(...values) ?? null) as T|null; },
      async run() { const result=db.prepare(sql).run(...values); return {success:true,meta:{changes:Number(result.changes)}}; },
    };
  }
  const DB:Database = {prepare:statement,async batch(statements) {
    db.exec('BEGIN');
    try { const result=[]; for (const stmt of statements) result.push(await stmt.run()); db.exec('COMMIT'); return result; }
    catch(error) {db.exec('ROLLBACK');throw error;}
  }};
  const env:Env={DB,ASSETS:{fetch:async()=>new Response('static')},APP_ORIGIN:origin,GOOGLE_CLIENT_ID:'123-test.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'test-only'};
  async function user(id:string, expiresAt=now()+3600) {
    const token=randomToken();
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(id,'sub-'+id,id+'@example.invalid',now(),now());
    db.prepare('INSERT INTO user_settings VALUES (?,?,0,?)').run(id,JSON.stringify(defaultSettings(id)),now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(await hash(token),id,expiresAt,now());
    return SESSION_COOKIE+'='+token;
  }
  function request(path:string, opts:RequestInit={}) {return worker.fetch(new Request(origin+path,opts),env);}
  function save(cookie:string,id:string,revision:number,settings:unknown,from=origin) {
    return request('/api/settings',{method:'PUT',headers:{Cookie:cookie,Origin:from,'Content-Type':'application/json','X-KySheet-User':id},body:JSON.stringify({revision,settings})});
  }
  return {db,env,user,request,save,close:()=>db.close()};
}
test('two accounts are isolated, settings survive requests, and stale revisions cannot overwrite',async()=>{
  const f=fixture();
  try {
    const a=await f.user('a'), b=await f.user('b');
    const settings=defaultSettings('Finance A');
    settings.lastConfig={title:'Private A',groups:['Region'],metric:'Amount',aggregate:'sum',filters:[],chart:'bar',sort:'desc'};
    const wrote=await f.save(a,'a',0,settings);assert.equal(wrote.status,200);assert.equal((await wrote.json()).revision,1);
    const fresh=await f.request('/api/session',{headers:{Cookie:a}});assert.equal(fresh.headers.get('Cache-Control'),'no-store, private');
    const loaded=await fresh.json();assert.equal(loaded.settings.lastConfig.title,'Private A');assert.equal(loaded.settings.profile.displayName,'Finance A');
    const other=await (await f.request('/api/session',{headers:{Cookie:b}})).json();assert.equal(other.account.id,'b');assert.equal(other.settings.lastConfig,null);
    assert.equal((await f.save(b,'a',0,settings)).status,409);
    const stale=await f.save(a,'a',0,defaultSettings('Overwrite'));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'SETTINGS_CONFLICT');
    assert.equal((await f.save(a,'a',1,settings,'https://evil.invalid')).status,403);
    assert.equal((await f.save(a,'a',1,{version:999})).status,400);
    assert.equal((await f.save(a,'a',1,{...settings,owner_id:'b'})).status,200);
    const untouched=await (await f.request('/api/session',{headers:{Cookie:b}})).json();assert.equal(untouched.revision,0);
    assert.equal((await f.request('/api/session')).status,401);
  }finally{f.close();}
});
test('logout revokes the server session, expired tokens cannot read or write',async()=>{
  const f=fixture();
  try {
    const a=await f.user('a'), expired=await f.user('expired',now()-1);
    assert.equal((await f.request('/api/session',{headers:{Cookie:expired}})).status,401);
    assert.equal((await f.save(expired,'expired',0,defaultSettings())).status,401);
    const logout=await f.request('/api/auth/logout',{method:'POST',headers:{Cookie:a,Origin:origin,'X-KySheet-User':'a'}});
    assert.equal(logout.status,200);assert.match(logout.headers.get('Set-Cookie')??'',/Max-Age=0/);
    assert.equal((await f.request('/api/session',{headers:{Cookie:a}})).status,401);
    assert.equal((await f.save(a,'a',0,defaultSettings())).status,401);
  }finally{f.close();}
});
test('OAuth start binds state to browser, callback consumes it once; mocked provider uses real SQL',async()=>{
  const f=fixture(), originalFetch=globalThis.fetch;
  try {
    const start=await f.request('/api/auth/login',{method:'POST',headers:{Origin:origin}});
    assert.equal(start.status,303);
    const dest=new URL(start.headers.get('Location')!);
    assert.equal(dest.origin,'https://accounts.google.com');
    assert.equal(dest.searchParams.get('redirect_uri'),origin+'/api/auth/callback');
    assert.equal(dest.searchParams.get('code_challenge_method'),'S256');
    const browserCookie=start.headers.get('Set-Cookie')!.split(';')[0];
    assert.ok(browserCookie.startsWith(OAUTH_COOKIE+'='));
    const state=dest.searchParams.get('state');
    const callback='/api/auth/callback?'+new URLSearchParams({state:state!,code:'test-code'});
    let calls=0;
    globalThis.fetch=async(input,init)=>{
      calls++;
      assert.equal(init?.redirect,'manual');
      if(String(input)==='https://oauth2.googleapis.com/token'){
        const form=new URLSearchParams(String(init?.body));
        assert.equal(form.get('code'),'test-code');
        assert.equal(await hash(form.get('code_verifier')!),dest.searchParams.get('code_challenge'));
        return Response.json({access_token:'mock-access',token_type:'Bearer'});
      }
      assert.equal(String(input),'https://openidconnect.googleapis.com/v1/userinfo');
      return Response.json({sub:'test-google-sub',email:'test@example.invalid',email_verified:true,name:'Test user'});
    };
    assert.match((await f.request(callback)).headers.get('Location')??'',/invalid_state/);
    assert.equal(calls,0);
    const done=await f.request(callback,{headers:{Cookie:browserCookie}});
    assert.equal(done.headers.get('Location'),'/');
    assert.equal(calls,2);
    const sessionHeader=done.headers.getSetCookie().find(x=>x.startsWith(SESSION_COOKIE+'='));
    assert.ok(sessionHeader);
    const snapshot=await f.request('/api/session',{headers:{Cookie:sessionHeader.split(';')[0]}});
    assert.equal(snapshot.status,200);
    assert.equal((await snapshot.json()).settings.profile.displayName,'Test user');
    assert.match((await f.request(callback,{headers:{Cookie:browserCookie}})).headers.get('Location')??'',/invalid_state/);
    assert.equal(calls,2);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get()?.n,1);
  }finally{globalThis.fetch=originalFetch;f.close();}
});

test('workspace persists per account, legacy profile saves preserve it, and explicit reset clears it',async()=>{
  const f=fixture();
  try{
    const a=await f.user('a'),b=await f.user('b');
    const settings=defaultSettings('A');
    const slot={id:crypto.randomUUID(),alias:'Private A',sheet:'Sales',columns:[{name:'Region',kind:'text' as const},{name:'Amount',kind:'number' as const}],config:{title:'Report A',groups:['Region'],metric:'Amount',aggregate:'sum' as const,filters:[],chart:'bar' as const,sort:'desc' as const}};
    settings.workspace={version:1,slots:[slot]};
    assert.equal((await f.save(a,'a',0,{...settings,workspace:{version:1,slots:[{...slot,rows:['SECRET_ROW']}]}})).status,200);
    const get=async(cookie:string)=>(await (await f.request('/api/session',{headers:{Cookie:cookie}})).json());
    assert.deepEqual((await get(a)).settings.workspace,settings.workspace);
    assert.equal((await get(b)).settings.workspace,null);
    assert.equal((await f.save(b,'a',0,settings)).status,409);
    const {workspace,...legacy}=defaultSettings('New profile A');
    assert.equal((await f.save(a,'a',1,legacy)).status,200);
    assert.deepEqual((await get(a)).settings.workspace,settings.workspace);
    assert.equal((await get(a)).settings.profile.displayName,'New profile A');
    assert.equal((await f.save(a,'a',1,defaultSettings('Stale reset'))).status,409);
    assert.equal((await f.save(a,'a',2,{...settings,workspace:{version:1,slots:[slot,slot]}})).status,400);
    assert.equal((await f.save(a,'a',2,defaultSettings('A'))).status,200);
    assert.equal((await get(a)).settings.workspace,null);
  }finally{f.close();}
});

test('schema-capable clients save rules; old clients cannot erase them',async()=>{
 const f=fixture();try{
 const a=await f.user('a'),settings=defaultSettings('A');
 settings.workspace={version:1,slots:[{id:crypto.randomUUID(),alias:'Sales',sheet:'Sales',columns:[{name:'Revenue',kind:'number'}],config:{title:'Report',groups:[],metric:'Revenue',aggregate:'sum',filters:[],chart:'bar',sort:'desc'},schema:[{sourceName:'Amount',name:'Revenue',mode:'number-vi'}]}]};
 const save=(revision:number,value:unknown,capable:boolean)=>f.request('/api/settings',{method:'PUT',headers:{Cookie:a,Origin:origin,'Content-Type':'application/json','X-KySheet-User':'a',...(capable?{'X-KySheet-Schema':'1'}:{})},body:JSON.stringify({revision,settings:value})});
 assert.equal((await save(0,settings,true)).status,200);
 const denied=await save(1,defaultSettings('Old'),false);assert.equal(denied.status,409);assert.equal((await denied.json()).code,'SETTINGS_CLIENT_UPGRADE');
 const loaded=await (await f.request('/api/session',{headers:{Cookie:a}})).json();assert.deepEqual(loaded.settings.workspace,settings.workspace);
 assert.equal((await save(1,defaultSettings('Reset'),true)).status,200);
 }finally{f.close();}
});

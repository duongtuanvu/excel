import { test as base, expect } from '@playwright/test';
import { defaultSettings, validateSettings } from '../../src/account-model';
import type { AccountSettings } from '../../src/account-model';
// Test-only browser API fixture. Never bundled in production, no login bypass route.
export const test = base.extend<{ accountFixture: { settings: AccountSettings; revision: number; active: boolean } }>({
  accountFixture: [async ({page},use)=>{
    const state={settings:defaultSettings('Test user'),revision:0,active:true};
    const account={id:'test-user',email:'test@example.invalid'};
    await page.route('**/api/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname;
      const reply=(status:number,body:unknown)=>route.fulfill({status,json:body});
      if(!state.active) return reply(401,{code:'AUTH_SESSION_REQUIRED',error:'Phiên đăng nhập đã hết hạn.'});
      if(path==='/api/session/check')return reply(200,{account,expiresAt:Math.floor(Date.now()/1000)+3600});
      if(path==='/api/session')return reply(200,{account,settings:state.settings,revision:state.revision,expiresAt:Math.floor(Date.now()/1000)+3600});
      if(path==='/api/settings'&&req.method()==='PUT'){
        const body=req.postDataJSON();
        if(req.headers()['x-kysheet-user']!==account.id)return reply(409,{code:'AUTH_ACCOUNT_CHANGED',error:'Tài khoản đã thay đổi.'});
        if(body.revision!==state.revision)return reply(409,{code:'SETTINGS_CONFLICT',error:'Cấu hình đã thay đổi.'});
        state.settings=validateSettings(body.settings);state.revision++;
        return reply(200,{revision:state.revision});
      }
      if(path==='/api/auth/logout'&&req.method()==='POST'){state.active=false;return reply(200,{ok:true});}
      return reply(404,{error:'Unknown fixture route'});
    });
    await use(state);
  },{auto:true}],
});
export {expect};

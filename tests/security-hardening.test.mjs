import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac,scryptSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2] || new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const fixture=await mkdtemp(join(root,'.security-test-'));
const secret='local-security-test-secret-with-more-than-32-characters';
const salt='audit-salt';
const password='Synthetic-password-123!';
const hash=`scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`;
let enabled=true,agencyEnabled=true,storedHash=hash,inserts=0;
const mock=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let data=[];
 if(url.pathname.endsWith('/admin_users')||url.pathname.endsWith('/agency_users'))data=enabled?[{id:'u1',password_hash:storedHash,name:'Test',email:'test@example.invalid',agency_id:'a1'}]:[];
 if(url.pathname.endsWith('/agencies'))data=agencyEnabled?[{id:'a1',agency_code:'AG-TEST',commercial_name:'Synthetic agency'}]:[];
 if(url.pathname.endsWith('/reservations'))data=[{id:'r1',agency_id:'a1',status:'confirmada',total_amount:1000,paid_amount:900}];
 if(url.pathname.endsWith('/payments')&&req.method==='POST'){inserts++;data=[{id:'p1'}];}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
const temp=createServer();temp.listen(0,'127.0.0.1');await once(temp,'listening');const port=temp.address().port;await new Promise(r=>temp.close(r));
await mkdir(join(fixture,'src'));await mkdir(join(fixture,'public'));await mkdir(join(fixture,'generated/contracts'),{recursive:true});
await copyFile(join(root,'src/server.mjs'),join(fixture,'src/server.mjs'));
await writeFile(join(fixture,'public/index.html'),'<h1>Portal</h1>');
await writeFile(join(fixture,'public/app.backup.js'),'private backup');
await writeFile(join(fixture,'canary.txt'),'private canary');
await writeFile(join(fixture,'generated/contracts/test.html'),'signed contract');
const child=spawn(process.execPath,[join(fixture,'src/server.mjs')],{cwd:fixture,env:{...process.env,PORT:String(port),SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,SUPABASE_SERVICE_ROLE_KEY:'synthetic',SESSION_SECRET:secret,NODE_ENV:'production',PUBLIC_BASE_URL:`http://127.0.0.1:${port}`},windowsHide:true,stdio:['ignore','pipe','pipe']});
let stderr='';child.stderr.on('data',d=>stderr+=d);child.stdout.resume();
const url=`http://127.0.0.1:${port}`;
const get=(path,options={})=>fetch(url+path,{...options,signal:AbortSignal.timeout(5000)});
const signed=payload=>{const d=Buffer.from(JSON.stringify(payload)).toString('base64url');return `${d}.${createHmac('sha256',secret).update(d).digest('base64url')}`;};
async function status(path,expected,options){const r=await get(path,options);await r.text();assert.equal(r.status,expected,path);}
async function login(type){const r=await get(`/api/auth/${type}-login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'test@example.invalid',agencyCode:'AG-TEST',password})});assert.equal(r.status,200);await r.text();return r.headers.get('set-cookie').split(';')[0];}
try {
 let ready=false;for(let i=0;i<100;i++){try{await status('/',200);ready=true;break;}catch{if(child.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,50));}}
 assert(ready,'server started');
 await status('/api/admin/cuentas/snapshot',401);
 await status('/generated/..%2fcanary.txt',403);
 await status('/generated/..%5ccanary.txt',403);
 await status('/app.backup.js',403);
 await status('/generated/contracts/test.html',401);
 await status('/%E0%A4%A',400);await status('/',200);assert.equal(child.exitCode,null);
 const malformed=await get('/api/session',{headers:{cookie:'pv_session=e30.x'}});assert.equal(malformed.status,200);assert.equal((await malformed.json()).session,null);
 for(const route of ['/admin','/acceso','/crear-contrasena','/recuperar-contrasena'])await status(route,200);
 const admin=await login('admin'),agency=await login('agency');
 await status('/api/agency/dashboard',200,{headers:{cookie:agency}});
 await status('/api/admin/cuentas/snapshot',401,{headers:{cookie:agency}});
 await status('/generated/contracts/test.html',200,{headers:{cookie:admin}});
 enabled=false;await status('/api/agency/dashboard',401,{headers:{cookie:agency}});enabled=true;
 agencyEnabled=false;await status('/api/agency/dashboard',401,{headers:{cookie:agency}});agencyEnabled=true;
 storedHash='changed-password';await status('/api/agency/dashboard',401,{headers:{cookie:agency}});storedHash=hash;
 await status('/api/admin/reservations/r1/payments',400,{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({amount:200})});assert.equal(inserts,0,'rejected payment must never be inserted');
 const grant={purpose:'contract-download',path:'/generated/contracts/test.html',exp:Date.now()+60000};
 await status(`${grant.path}?token=${signed(grant)}`,200);
 await status(`${grant.path}?token=${signed({...grant,exp:1})}`,401);
 await status(`/generated/contracts/other.html?token=${signed(grant)}`,401);
 const app=await readFile(join(root,'public/app.js'),'utf8');
 assert(!app.includes('badge(i.status), i.description'),'incident descriptions escaped');
 assert(app.includes('badge(i.status), esc(i.description)'));
 console.log('Security integration: paths, server survival, sessions, revocation, payment rejection, contract grants and incident escaping passed.');
} finally {
 if(child.exitCode===null){child.kill();await once(child,'exit');}
 mock.closeAllConnections();await new Promise(r=>mock.close(r));
 // mkdtemp creates a known child of the selected repository; never remove an external path.
 assert(fixture.startsWith(join(root,'.security-test-')));await rm(fixture,{recursive:true,force:true});
}

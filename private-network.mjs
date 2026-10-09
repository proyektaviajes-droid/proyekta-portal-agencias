import {spawn} from 'node:child_process';
import {writeFile,unlink,access} from 'node:fs/promises';
import {request} from 'node:http';

const env={...process.env};
delete env.TS_AUTHKEY;
const app=spawn(process.execPath,['src/server.mjs'],{stdio:'inherit',env});
let daemon;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.kill(signal);daemon?.kill(signal);});
app.on('exit',code=>{daemon?.kill('SIGTERM');process.exit(code??1);});

function run(command,args,timeout=60000){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:'ignore',env});
    const timer=setTimeout(()=>{child.kill();reject(new Error('timeout'));},timeout);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('start failed'));});
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('command failed'));});
  });
}
function probe(target){
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:1055,path:target,method:'GET',headers:{Host:new URL(target).host},timeout:10000},res=>{
      let body='';res.on('data',chunk=>{if(body.length<1024)body+=chunk;});
      res.on('end',()=>res.statusCode===200&&body.trim()==='proyekta-nas-ready'?resolve():reject(new Error('unexpected response')));
    });
    req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);req.end();
  });
}
async function connect(){
  const target=process.env.NAS_PROBE_URL;
  if(!process.env.TS_AUTHKEY||!target)throw new Error('configuration missing');
  const url=new URL(target);
  if(url.protocol!=='http:'||!/^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(?:[0-9]{1,3})\.(?:[0-9]{1,3})$/.test(url.hostname)||url.port!=='8080'||url.pathname!=='/healthz')throw new Error('unexpected destination');
  const keyfile='/tmp/proyekta-tailscale-auth';
  await writeFile(keyfile,process.env.TS_AUTHKEY,{mode:0o600});
  daemon=spawn('/usr/local/bin/tailscaled',['--tun=userspace-networking','--state=mem:','--socket=/tmp/proyekta-tailscale.sock','--outbound-http-proxy-listen=127.0.0.1:1055'],{stdio:'ignore',env});
  daemon.on('error',()=>console.error('PROYEKTA_PRIVATE_NETWORK daemon_unavailable'));
  try{
    const deadline=Date.now()+15000;
    for(;;){
      try{await access('/tmp/proyekta-tailscale.sock');break;}catch{}
      if(Date.now()>deadline)throw new Error('daemon not ready');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    await run('/usr/local/bin/tailscale',['--socket=/tmp/proyekta-tailscale.sock','up','--auth-key=file:'+keyfile,'--hostname=proyekta-render','--accept-dns=false','--accept-routes=false','--ssh=false']);
  }finally{await unlink(keyfile).catch(()=>{});}
  await probe(target);
  console.log('PROYEKTA_PRIVATE_NETWORK connected_to_ugreen');
}
if(process.env.PRIVATE_NETWORK_ENABLED==='true')connect().catch(()=>console.error('PROYEKTA_PRIVATE_NETWORK connection_not_verified'));


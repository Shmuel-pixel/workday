// Seal and sign items for the Workday inbox. Usage: node drop.js <inbox public key b64u> '<items json>'  -> prints the drop JSON
const fs=require('fs');const b64=b=>Buffer.from(b).toString('base64');const b64u=b=>b64(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromB64=s=>Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64');
(async()=>{const [pubB64,itemsJson]=process.argv.slice(2);const author=JSON.parse(fs.readFileSync(__dirname+'/../.inbox_author.json'));
const msg={id:'d'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),ts:Date.now(),items:JSON.parse(itemsJson)};
const rsa=await crypto.subtle.importKey('spki',fromB64(pubB64),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
const raw=crypto.getRandomValues(new Uint8Array(32));const aes=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt']);
const iv=crypto.getRandomValues(new Uint8Array(12));
const k=b64u(await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,raw));const ct=b64u(await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify(msg))));const ivs=b64u(iv);
const sk=await crypto.subtle.importKey('jwk',author.priv,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
const sig=b64u(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},sk,new TextEncoder().encode(k+'.'+ivs+'.'+ct)));
process.stdout.write(JSON.stringify({k,iv:ivs,ct,sig}));})();

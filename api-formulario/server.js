'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const PORT=Number(process.env.PORT||10000);
const TO='fernandoanjp@gmail.com';
const ORIGINS=new Set(['https://con-acento-carta.onrender.com']);
const MAX_JSON=13*1024*1024,MAX_ZIP=8*1024*1024;
const traffic=new Map();
function json(res,status,payload,origin){
 if(origin&&ORIGINS.has(origin))res.setHeader('Access-Control-Allow-Origin',origin);
 res.setHeader('Vary','Origin');
 res.setHeader('Cache-Control','no-store');
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(payload));
}
function ready(){return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)}
function isMail(t){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t||'')&&String(t).length<=180}
function clean(t,max=240){return String(t||'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max)}
function safe(t){return clean(t,800).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function checkLimit(ip){
 const time=Date.now(),recent=(traffic.get(ip)||[]).filter(x=>time-x<3600000);
 if(recent.length>=6){traffic.set(ip,recent);return false}
 recent.push(time);traffic.set(ip,recent);return true;
}
function bodyMessage(req){
 return new Promise((resolve,reject)=>{
  const buffers=[];let length=0;
  req.on('data',chunk=>{length+=chunk.length;if(length>MAX_JSON){req.destroy();reject(Object.assign(new Error('EXCESSIVE'),{code:'EXCESSIVE'}));return}buffers.push(chunk)});
  req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(buffers).toString('utf8')))}catch(e){reject(e)}});
  req.on('error',reject);
 })
}
http.createServer(async(req,res)=>{
 const origin=req.headers.origin||'';
 if(origin&& !ORIGINS.has(origin))return json(res,403,{ok:false,error:'Origen no autorizado'},'');
 if(req.method==='OPTIONS'){
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Max-Age','600');
  res.writeHead(204);res.end();return;
 }
 if(req.method==='GET'&&req.url==='/health')return json(res,200,{ok:true,configured:ready(),provider:'resend'},origin);
 if(req.method!=='POST'||req.url!=='/send')return json(res,404,{ok:false,error:'Ruta no disponible'},origin);
 if(!ready())return json(res,503,{ok:false,error:'El envío directo aún no está activado en el servidor. No se ha enviado el correo.'},origin);
 if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{ok:false,error:'Formato no admitido'},origin);
 const ip=clean((req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0],80);
 if(!checkLimit(ip))return json(res,429,{ok:false,error:'Demasiadas solicitudes. Reinténtalo más tarde.'},origin);
 try{
  const v=await bodyMessage(req);
  if(v.website)return json(res,200,{ok:true,id:'ignored'},origin);
  const restaurant=clean(v.restaurant,120),contact=clean(v.contact,110);
  const email=clean(v.contactEmail,180),zipName=clean(v.filename,160);
  if(!restaurant||!contact|| (email&&!isMail(email)))return json(res,400,{ok:false,error:'Datos de contacto incorrectos'},origin);
  if(!v.zip_base64 || typeof v.zip_base64!=='string' ||v.zip_base64.length>MAX_JSON)return json(res,400,{ok:false,error:'Archivo de solicitud ausente o demasiado grande'},origin);
  const raw=Buffer.from(v.zip_base64,'base64');
  if(!raw.length||raw.length>MAX_ZIP||raw.toString('latin1',0,4)!=='PK\u0003\u0004')return json(res,400,{ok:false,error:'El adjunto ZIP no es válido o supera 8 MB'},origin);
  const count=Number(v.count)||0;if(count<1||count>50)return json(res,400,{ok:false,error:'Número de operaciones no válido'},origin);
  const message= '<h2>Solicitud desde la carta digital</h2><p><strong>Restaurante:</strong> '+safe(restaurant)+'</p><p><strong>Persona de contacto:</strong> '+safe(contact)+'</p><p><strong>Correo de contacto:</strong> '+safe(email||'No facilitado')+'</p><p><strong>Teléfono:</strong> '+safe(v.phone||'No facilitado')+'</p><p><strong>Operaciones:</strong> '+count+'</p><p>Se adjunta un ZIP con los detalles y las fotografías. Revisa los cambios antes de publicarlos.</p>';
  const payload={from:process.env.EMAIL_FROM,to:[TO],subject:'Solicitud de productos · '+restaurant,html:message,attachments:[{filename:zipName.endsWith('.zip')?zipName:'solicitud-productos.zip',content:raw.toString('base64')}],tags:[{name:'fuente',value:'formulario-productos'}]};
  if(email)payload.reply_to=email;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.RESEND_API_KEY},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
  let output;try{output=await response.json()}catch{output={}}
  if(!response.ok||!output.id){
   console.error('Proveedor de correo rechazó la solicitud:',response.status,JSON.stringify(output).slice(0,500));
   return json(res,502,{ok:false,error:'El proveedor de correo no ha aceptado el mensaje. No consta como enviado.'},origin);
  }
  return json(res,200,{ok:true,id:output.id,notice:'El proveedor ha aceptado el correo. La entrega final depende del servicio de correo.'},origin);
 }catch(e){console.error('Error procesando solicitud:',String(e).slice(0,150));return json(res,500,{ok:false,error:'No se ha podido enviar. Los datos siguen en el formulario.'},origin)}
}).listen(PORT,'0.0.0.0',()=>console.log('Formulario API escuchando en puerto',PORT));

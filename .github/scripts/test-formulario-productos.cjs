const { chromium } = require('playwright-core');
const { strict: assert } = require('node:assert');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_BIN,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({acceptDownloads:true});
 const errors=[],submissions=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__mailOpened=false;
  const old=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.href.startsWith('mailto:')){window.__mailOpened=true;return}return old.call(this)}
 });
 try{
  console.log('Prueba del formulario publicado en Render; se simula la API, no se envían emails.');
  await page.route('https://fernando-cartas-formulario-api.onrender.com/send',async route=>{
    if(route.request().method()==='OPTIONS'){
      return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'https://con-acento-carta.onrender.com','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}})
    }
    const payload=JSON.parse(route.request().postData());
    submissions.push(payload);
    await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://con-acento-carta.onrender.com'},body:JSON.stringify({ok:true,id:'prueba-simulada-sin-envio-real'})})
  });
  const resp=await page.goto('https://con-acento-carta.onrender.com/gestion-productos/',{waitUntil:'domcontentloaded',timeout:60000});
  assert.equal(resp.status(),200);
  await page.locator('#restaurant').fill('Restaurante de prueba técnica NO REAL');
  await page.locator('#person').fill('Responsable ficticio');
  // A propósito, dejamos el contacto por correo vacío. No se requiere remitente.
  assert.equal(await page.locator('#email').getAttribute('required'),null);
  const item=page.locator('[data-item]').nth(0);
  await item.locator('[data-key=category]').selectOption({label:'Tapas'});
  await item.locator('[data-key=current]').fill('Croquetas TEST');
  await item.locator('[data-key=price]').fill('9.50');
  await page.locator('#add').click();
  const second=page.locator('[data-item]').nth(1);
  await second.locator('input[data-op][value=Modificar]').check({force:true});
  await second.locator('[data-key=category]').selectOption({label:'Fuera de carta'});
  await second.locator('[data-key=current]').fill('Especial TEST');
  await second.locator('[data-key=rename]').fill('Especial nuevo TEST');
  await second.locator('[data-key=start]').fill('2026-10-20');
  await second.locator('[data-key=end]').fill('2026-10-22');
  await page.locator('#add').click();
  const third=page.locator('[data-item]').nth(2);
  await third.locator('input[data-op][value=Eliminar]').check({force:true});
  await third.locator('[data-key=category]').selectOption({label:'Postres'});
  await third.locator('[data-key=current]').fill('Postre para retirar TEST');
  await page.locator('#verified').check();
  await page.locator('#share').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('prueba-simulada-sin-envio-real'),null,{timeout:20000});
  assert.equal(submissions.length,1);
  assert.equal(submissions[0].contactEmail,'');
  assert.equal(submissions[0].count,3);
  const zip=Buffer.from(submissions[0].zip_base64,'base64');
  assert.equal(zip.subarray(0,4).toString('hex'),'504b0304');
  assert.equal(await page.evaluate(()=>window.__mailOpened),false);
  console.log('OK: tres operaciones, ZIP transmitido a la API, email no obligatorio y sin abrir mailto.');
  const save=await page.locator('#restaurant').inputValue();assert(save.includes('prueba'));
  await page.unrouteAll();
  await page.route('https://fernando-cartas-formulario-api.onrender.com/send',route=>route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://con-acento-carta.onrender.com'},body:JSON.stringify({ok:false,error:'Envío no activado'})}));
  await page.locator('#share').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Envío no activado'),null,{timeout:20000});
  assert.equal(await page.locator('#restaurant').inputValue(),'Restaurante de prueba técnica NO REAL');
  assert.equal(errors.length,0,errors.join('; '));
  console.log('OK: servidor no configurado: error honesto, campos preservados, sin falso éxito.');
  console.log('Este test NO ha enviado un correo real.');
 }finally{await browser.close()}
})().catch(e=>{console.error('ERROR',e.stack||e);process.exitCode=1});

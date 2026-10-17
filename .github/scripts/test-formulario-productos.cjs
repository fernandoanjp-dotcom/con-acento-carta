const { chromium } = require('playwright-core');
const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async()=>{
  const browser = await chromium.launch({headless:true,executablePath:process.env.BROWSER_BIN,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage({acceptDownloads:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__capturedMails = [];
    const native = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.href.startsWith('mailto:')) {
        window.__capturedMails.push(this.href);
        return;
      }
      return native.call(this);
    };
  });
  try {
    console.log('PASO 1: Abriendo formulario publicado en Render');
    const response=await page.goto('https://con-acento-carta.onrender.com/gestion-productos/',{waitUntil:'domcontentloaded',timeout:60000});
    assert.equal(response.status(),200,'Formulario no devuelve HTTP 200');
    await page.locator('#form').waitFor({state:'visible'});
    await page.locator('#restaurant').fill('Restaurante de prueba automática (NO REAL)');
    await page.locator('#person').fill('Prueba técnica Cartas Digitales');
    await page.locator('#email').fill('fernandoanjp@gmail.com');
    await page.locator('#phone').fill('600000000');
    const first=page.locator('[data-item]').nth(0);
    await first.locator('[data-key=category]').selectOption({label:'Tapas'});
    await first.locator('[data-key=current]').fill('Croquetas TEST NO PUBLICAR');
    await first.locator('[data-key=price]').fill('9.50');
    await first.locator('[data-key=description]').fill('Producto ficticio generado para probar el formulario.');
    await page.locator('#add').click();
    const second=page.locator('[data-item]').nth(1);
    await second.locator('input[data-op][value="Modificar"]').check({force:true});
    await second.locator('[data-key=category]').selectOption({label:'Fuera de carta'});
    await second.locator('[data-key=current]').fill('Plato antiguo TEST');
    await second.locator('[data-key=rename]').fill('Plato actualizado TEST');
    await second.locator('[data-key=price]').fill('12.30');
    await second.locator('[data-key=start]').fill('2026-10-20');
    await second.locator('[data-key=end]').fill('2026-10-22');
    await page.locator('#add').click();
    const third=page.locator('[data-item]').nth(2);
    await third.locator('input[data-op][value="Eliminar"]').check({force:true});
    await third.locator('[data-key=category]').selectOption({label:'Postres'});
    await third.locator('[data-key=current]').fill('Postre que retirar TEST');
    await page.locator('#verified').check();
    console.log('PASO 2: Pulsando Enviar con alta, modificación temporal y baja');
    await page.locator('#share').click();
    await page.waitForFunction(()=>window.__capturedMails.length===1,null,{timeout:12000});
    const uri=await page.evaluate(()=>window.__capturedMails[0]);
    const decoded=decodeURIComponent(uri);
    assert(decoded.startsWith('mailto:fernandoanjp@gmail.com?'),'Destinatario incorrecto: '+uri.slice(0,80));
    for(const text of ['Croquetas TEST NO PUBLICAR','Plato actualizado TEST','Postre que retirar TEST','2026-10-20','2026-10-22','9.50']){
      assert(decoded.includes(text),'Falta dato en correo: '+text);
    }
    console.log('OK: Enlace mailto correcto: '+decoded.slice(0,320).replace(/\n/g,' | '));
    console.log('PASO 3: Prueba de fotografía adjunta y descarga ZIP');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#restaurant').fill('Restaurante de prueba automática (NO REAL)');
    await page.locator('#person').fill('Prueba técnica Cartas Digitales');
    await page.locator('#email').fill('fernandoanjp@gmail.com');
    const one=page.locator('[data-item]').nth(0);
    await one.locator('[data-key=category]').selectOption({label:'Tapas'});
    await one.locator('[data-key=current]').fill('Plato con foto TEST');
    await one.locator('[data-key=price]').fill('7.50');
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9UbQFd4AAAAASUVORK5CYII=','base64');
    await one.locator('[data-photo]').setInputFiles({name:'imagen-test.png',mimeType:'image/png',buffer:png});
    await page.locator('#verified').check();
    const pending=page.waitForEvent('download',{timeout:20000});
    await page.locator('#share').click();
    const download=await pending;
    const zipPath=path.join(mkdtempSync(path.join(os.tmpdir(),'carta-test-')),'solicitud.zip');
    await download.saveAs(zipPath);
    const listing=execFileSync('unzip',['-l',zipPath],{encoding:'utf8'});
    assert(listing.includes('productos.csv'),'ZIP sin CSV');
    assert(listing.includes('solicitud.json'),'ZIP sin JSON');
    assert(listing.includes('fotos/01-plato-con-foto-test.png'),'ZIP sin imagen PNG');
    const json=JSON.parse(execFileSync('unzip',['-p',zipPath,'solicitud.json'],{encoding:'utf8'}));
    assert.equal(json.restaurant,'Restaurante de prueba automática (NO REAL)');
    assert.equal(json.changes.length,1);
    assert.equal(json.changes[0].price,'7.50');
    await page.waitForFunction(()=>window.__capturedMails.length===1,null,{timeout:12000});
    const secondUri=await page.evaluate(()=>window.__capturedMails[0]);
    assert(decodeURIComponent(secondUri).includes('Adjunta el ZIP'),'El correo no exige adjuntar el ZIP');
    assert.equal(errors.length,0,'Errores Javascript: '+errors.join(' | '));
    console.log('OK: ZIP validado con CSV, JSON y fotografía, y correo preparado.');
    console.log('IMPORTANTE: Esta prueba intercepta mailto. El formulario NO envía correo automáticamente desde su web; hay que confirmar envío en la aplicación externa.');
  } finally {await browser.close()}
})().catch(e=>{console.error('ERROR EN LA PRUEBA:',e.stack||e);process.exitCode=1;});

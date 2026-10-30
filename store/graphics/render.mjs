import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(root, 'store/graphics');
await mkdir(`${dir}/upload`, { recursive: true });
const png = (path) => readFile(path).then(b => `data:image/png;base64,${b.toString('base64')}`);

// Only resize/crop the imagegen artwork to the exact store export dimensions.
await sharp(`${dir}/source/promo-marquee.png`).resize(1400,560,{fit:'cover'}).removeAlpha().png().toFile(`${dir}/upload/promo-marquee-1400x560.png`);
await sharp(`${dir}/source/promo-small.png`).resize(440,280,{fit:'cover'}).removeAlpha().png().toFile(`${dir}/upload/promo-small-440x280.png`);
// Reuse the existing extension icon, including its existing transparent padding.
await sharp(`${root}/assets/icon128.png`).png().toFile(`${dir}/upload/icon-128.png`);

const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:420,height:1400},deviceScaleFactor:2});
  const original = await readFile(`${root}/assets/popup.html`,'utf8');
  const css = await readFile(`${root}/assets/ui.css`,'utf8');
  // Render the actual packaged markup/styles without invoking any account actions.
  // Use the exact disconnected status string from src/extension/popup.ts.
  const html = original.replace('<link rel="stylesheet" href="ui.css">',`<style>${css}</style>`).replace('<script src="popup.js"></script>','');
  await page.setContent(html);
  await page.locator('#status').evaluate(el => { el.textContent = 'Not connected. Open LinkedIn and connect this tab.'; });
  const sections = await page.locator('section').all();
  const boxes = await Promise.all(sections.map(el => el.boundingBox()));
  await page.screenshot({path:`${dir}/source/popup-disconnected.png`,clip:{x:0,y:0,width:420,height:Math.ceil(await page.locator('main').evaluate(el=>el.getBoundingClientRect().height))}});
  await page.screenshot({path:`${dir}/source/ui-connection.png`,clip:{x:0,y:0,width:420,height:Math.ceil(boxes[0].y+boxes[0].height+12)}});
  for (const [i,name] of [[0,'connection-controls'],[1,'data-flow'],[2,'local-data']]) {
    await page.screenshot({path:`${dir}/source/ui-${name}.png`,clip:{x:0,y:Math.floor(boxes[i].y-12),width:420,height:Math.ceil(boxes[i].height+24)}});
  }
  const icon=await png(`${root}/assets/icon128.png`);
  const connection=await png(`${dir}/source/ui-connection.png`);
  const controls=await png(`${dir}/source/ui-connection-controls.png`);
  const flow=await png(`${dir}/source/ui-data-flow.png`);
  const local=await png(`${dir}/source/ui-local-data.png`);
  const slides=[
    {name:'01-connect',num:'01',kicker:'YOUR WORKFLOW, CONNECTED',title:'Your LinkedIn.<br><em>Connected to AI.</em>',body:'Bring your inbox and professional research<br>to your local MCP-compatible AI client.',points:['Conversations & message history','People, posts & reactions','Native drafts & scheduling'],screen:`<div class="window"><div class="windowbar"><span class="dot"></span> Extension interface <b>DISCONNECTED</b></div><img src="${connection}"></div>`,foot:'Requires macOS, Chrome, a local companion and a compatible MCP client.'},
    {name:'02-data-flow',num:'02',kicker:'CLEAR BEFORE YOU CONNECT',title:'Understand<br><em>what you share.</em>',body:'See how requested LinkedIn content<br>reaches your chosen AI client.',points:['Session credentials stay in your browser','No hosted relay or product telemetry','Your client may send content to its AI provider'],screen:`<div class="window"><div class="windowbar"><span class="dot"></span> Extension interface <b>DATA FLOW</b></div><img src="${flow}"></div>`,foot:'Review the data flow in the extension before connecting your account.'},
    {name:'03-controls',num:'03',kicker:'VISIBLE CONNECTION CONTROLS',title:'Pause. Disconnect.<br><em>Stay in control.</em>',body:'Manage your connection and clear<br>local bridge data from the extension.',points:['Pause new work when you need to','Disconnect your linked account','Clear local data and operation receipts'],screen:`<div class="window controls"><div class="windowbar"><span class="dot"></span> Extension interface <b>CONTROLS</b></div><img src="${controls}"><img class="local" src="${local}"></div>`,foot:'Requested writes execute directly. Pausing cannot recall an action already dispatched.'}
  ];
  await page.setViewportSize({width:1280,height:800});
  for (const s of slides) {
    const artwork=`<!doctype html><html lang="en"><meta charset="utf-8"><title>${s.name}</title><style>
    *{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden}body{font-family:Arial,Helvetica,sans-serif;background:#071e30;color:#f1f8ff;-webkit-font-smoothing:antialiased}.canvas{width:1280px;height:800px;position:relative;background:radial-gradient(ellipse at 85% 65%,#164b65 0,transparent 52%),#071e30}.header{position:absolute;top:45px;left:64px;right:64px;display:flex;align-items:center;gap:13px;font-size:19px;font-weight:600;letter-spacing:-.25px}.header img{width:42px;height:42px}.beta{font-size:11px;letter-spacing:1.6px;border:1px solid #537083;color:#c2d6e4;padding:6px 10px;border-radius:5px;margin-left:8px}.series{margin-left:auto;font-size:12px;color:#91aebf;letter-spacing:1px;font-weight:400}.left{position:absolute;left:68px;top:177px;width:650px}.kicker{color:#8fd3ed;letter-spacing:2px;font-size:12px;font-weight:700;margin-bottom:24px}h1{font-size:57px;line-height:1.08;letter-spacing:-2.7px;margin:0 0 27px;font-weight:600}em{font-style:normal;color:#94d4ed}.body{font-size:20px;color:#c2d2df;line-height:1.55;letter-spacing:-.2px;margin-bottom:37px}.point{font-size:17px;line-height:1.4;margin:16px 0;color:#e3edf4;display:flex;align-items:center;gap:14px}.tick{display:inline-flex;width:23px;height:23px;align-items:center;justify-content:center;border:1px solid #547c91;border-radius:50%;font-size:13px;color:#98d8ed}.right{position:absolute;left:755px;top:148px;width:460px;height:530px;display:flex;align-items:center}.window{width:100%;border-radius:14px;overflow:hidden;background:#f4f7fa;box-shadow:0 25px 65px #0006;border:1px solid #829fb066}.windowbar{display:flex;align-items:center;gap:9px;background:#e5edf2;color:#40596b;font-size:11px;height:37px;padding:0 15px;border-bottom:1px solid #d5e0e8}.windowbar b{margin-left:auto;font-size:8px;letter-spacing:1px;font-weight:600}.dot{display:inline-block;width:7px;height:7px;background:#8197a7;border-radius:50%}.window img{display:block;width:100%;height:auto}.controls{width:380px;margin-left:40px;flex-shrink:0}.controls .windowbar{position:relative;z-index:1}.controls img.local{border-top:1px solid #d5e0e8}.foot{position:absolute;left:68px;right:65px;bottom:40px;border-top:1px solid #345163;padding-top:18px;color:#a6becd;font-size:12px;line-height:1.6}.foot .legal{color:#7998ac;font-size:10px;margin-top:4px}
    </style><div class="canvas"><div class="header"><img src="${icon}">LinkedIn MCP Bridge<span class="beta">BETA</span><span class="series">${s.num} / 03</span></div><div class="left"><div class="kicker">${s.kicker}</div><h1>${s.title}</h1><div class="body">${s.body}</div>${s.points.map(p=>`<div class="point"><span class="tick">✓</span>${p}</div>`).join('')}</div><div class="right">${s.screen}</div><div class="foot">${s.foot}<div class="legal">Independent software. Not affiliated with or endorsed by LinkedIn.</div></div></div></html>`;
    await writeFile(`${dir}/source/${s.name}.html`,artwork);
    await page.setContent(artwork);
    await page.screenshot({path:`${dir}/upload/screenshot-${s.name}-1280x800.png`,scale:'css'});
  }
  // A local review page with the upload-sized exports and zoomable screenshots.
  await writeFile(`${dir}/index.html`,`<!doctype html><html lang="en"><meta charset="utf-8"><title>LinkedIn MCP Bridge — Store graphics</title><style>body{margin:0;padding:48px;background:#e9eff3;color:#102b3f;font:16px/1.5 system-ui}main{max-width:1400px;margin:auto}h1{letter-spacing:-1px}h2{margin-top:40px;font-size:18px}img{display:block;max-width:100%;height:auto;border-radius:8px;box-shadow:0 8px 30px #16304218}a{color:inherit}.small{display:flex;gap:28px;align-items:center}p{color:#526879}</style><main><h1>LinkedIn MCP Bridge <small>— Store graphics</small></h1><p>English · Five upload-ready graphics · Existing 128px extension icon</p><h2>Marquee · 1400 × 560</h2><a href="upload/promo-marquee-1400x560.png"><img src="upload/promo-marquee-1400x560.png"></a><h2>Small promo · 440 × 280 & existing icon · 128 × 128</h2><div class="small"><img src="upload/promo-small-440x280.png"><img src="upload/icon-128.png"></div>${slides.map(s=>`<h2>${s.name} · 1280 × 800</h2><a href="upload/screenshot-${s.name}-1280x800.png"><img src="upload/screenshot-${s.name}-1280x800.png"></a>`).join('')}<p>UI captures render the actual extension markup and styles with the documented disconnected state. No live user data.</p></main></html>`);
} finally { await browser.close(); }
for (const [file,w,h] of [['promo-marquee-1400x560.png',1400,560],['promo-small-440x280.png',440,280],['icon-128.png',128,128],...['01-connect','02-data-flow','03-controls'].map(s=>[`screenshot-${s}-1280x800.png`,1280,800])]) {
  const m=await sharp(`${dir}/upload/${file}`).metadata();
  if(m.width!==w||m.height!==h) throw new Error(`Wrong dimensions: ${file}`);
  console.log(`${file}: ${m.width}×${m.height}, ${m.channels} channels`);
}

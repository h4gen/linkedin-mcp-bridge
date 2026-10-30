import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const {chromium} = require('playwright');
const sharp = require('sharp');
const browser = await chromium.launch({headless:true});
try {
 const page = await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
 const css = await readFile('assets/ui.css','utf8');
 const html = (await readFile('assets/popup.html','utf8')).replace('<link rel="stylesheet" href="ui.css">', `<style>${css}</style>`).replace('<script src="popup.js"></script>','').replace('Checking…','Not connected. Open LinkedIn and connect this tab.');
 await page.setContent(html);
 await page.addStyleTag({content:'body{width:420px;margin:30px auto;background:#f4f7fa}html{background:#f4f7fa}'});
 await page.screenshot({path:'store/screenshots/connection-1280x800.png'});
 await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
 await page.screenshot({path:'store/screenshots/data-controls-1280x800.png'});
 const second = await sharp('store/screenshots/data-controls-1280x800.png').removeAlpha().png().toBuffer();
 await writeFile('store/screenshots/data-controls-1280x800.png',second);
 const image = await sharp('store/screenshots/connection-1280x800.png').removeAlpha().png().toBuffer();
 await writeFile('store/screenshots/connection-1280x800.png',image);
} finally { await browser.close(); }

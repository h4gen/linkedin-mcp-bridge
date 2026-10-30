import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const dir = dirname(fileURLToPath(import.meta.url));
for (const [name,width,height] of [['marquee',1400,560],['small',440,280]]) {
  const out=resolve(dir,`upload/promo-${name}-${width}x${height}.png`);
  await sharp(resolve(dir,`source/${name}.png`)).resize(width,height,{fit:'contain',background:'#f6f3eb'}).removeAlpha().png().toFile(out);
  const meta=await sharp(out).metadata();
  if(meta.width!==width||meta.height!==height||meta.channels!==3) throw new Error('Invalid export');
  console.log(`${name}: ${meta.width}×${meta.height}, RGB PNG`);
}

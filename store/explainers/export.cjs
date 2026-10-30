const sharp = require('sharp');
const path = require('node:path');
(async () => {
  for (const name of ['inbox', 'research']) {
    const target = path.join(__dirname, 'upload', `${name}-1280x800.png`);
    await sharp(path.join(__dirname, 'source', `${name}.png`)).resize(1280, 800, {fit:'contain', background:'#f6f3eb'}).removeAlpha().png().toFile(target);
    const m = await sharp(target).metadata();
    if (m.width !== 1280 || m.height !== 800 || m.channels !== 3) throw new Error('Invalid export');
    console.log(`${name}: ${m.width}x${m.height}, RGB PNG`);
  }
})();

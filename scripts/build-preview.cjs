const fs = require('node:fs');
const path = require('node:path');

function buildPreview(source, target) {
  fs.mkdirSync(target, { recursive: true });
  let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
  let sw = fs.readFileSync(path.join(source, 'sw.js'), 'utf8');
  if (!html.includes("const KEY='umnozh.v1';") || !sw.includes("const CACHE = 'ezhik-v1';")) {
    throw new Error('Unexpected storage/cache constants: review preview isolation before publishing');
  }
  html = html.replace("const KEY='umnozh.v1';", "const KEY='ezhik.preview.v1';");
  html = html.replace('<title>', '<title>ТЕСТ · ');
  sw = sw.replace("const CACHE = 'ezhik-v1';", "const CACHE = 'ezhikPreview-v1';");
  if (sw.includes("k.startsWith('ezhik-') && k !== CACHE")) {
    sw = sw.replace("k.startsWith('ezhik-') && k !== CACHE", "k.startsWith('ezhikPreview-') && k !== CACHE");
  } else if (sw.includes('ks.filter(k => k !== CACHE)')) {
    sw = sw.replace('ks.filter(k => k !== CACHE)', "ks.filter(k => k.startsWith('ezhikPreview-') && k !== CACHE)");
  } else {
    throw new Error('Unexpected cache cleanup: review preview isolation before publishing');
  }
  html = html.replace('<div class="scroll">', `<div class="scroll">
      <div class="card"><b>Тестовая версия — основной прогресс не меняется</b>
        <p class="note">У этой версии отдельный прогресс и кэш. Можно скачать копию основной версии: кнопка только читает данные, ничего не записывая. Используйте тот же браузер, где вы занимаетесь. Файл содержит имя и PIN — не публикуйте его.</p>
        <button class="btn ghost small" id="preview-backup-original">Скачать копию основного прогресса</button>
      </div>`);
  html = html.replace('</body>', `<script>
document.getElementById('preview-backup-original').addEventListener('click',()=>{
  try{
    const raw=localStorage.getItem('umnozh.v1');
    if(!raw){alert('Прогресс основной версии не найден в этом браузере. Не очищайте данные и не удаляйте установленное приложение.');return}
    const backup={app:'ezhik-multiplication',version:1,exportedAt:new Date().toISOString(),state:JSON.parse(raw)};
    const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='ezhik-original-backup-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(e){alert('Не удалось скачать копию. Основной прогресс не изменён.')}
});
</script>
</body>`);
  fs.writeFileSync(path.join(target, 'index.html'), html);
  fs.writeFileSync(path.join(target, 'sw.js'), sw);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.webmanifest'), 'utf8'));
  manifest.name = 'ТЕСТ · Таблица с Ёжиком';
  manifest.short_name = 'Ёжик · тест';
  fs.writeFileSync(path.join(target, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
  for (const file of ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', '.nojekyll']) {
    fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
}

module.exports = { buildPreview };
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/build-preview.cjs OUTPUT_DIRECTORY');
  buildPreview(path.join(__dirname, '..'), path.resolve(process.argv[2]));
}

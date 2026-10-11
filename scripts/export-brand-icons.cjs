const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const master = path.join(root, 'icons/branding-4.1.2/master.png');
const res = path.join(root, 'android/app/src/main/res');
const write = (relative, content) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, content);
};
async function main() {
  for (const size of [180, 192, 512]) {
    await sharp(master).resize(size, size).png().toFile(path.join(root, `icons/icon-${size}.png`));
  }
  fs.copyFileSync(path.join(root, 'icons/icon-512.png'), path.join(root, 'icons/maskable-512.png'));
  for (const name of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
    fs.copyFileSync(path.join(root, 'icons/icon-180.png'), path.join(root, name));
  }
  const base64 = fs.readFileSync(path.join(root, 'icons/icon-512.png')).toString('base64');
  write('icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><clipPath id="mask"><rect width="512" height="512" rx="112"/></clipPath></defs><image width="512" height="512" clip-path="url(#mask)" href="data:image/png;base64,${base64}"/></svg>\n`);
  fs.mkdirSync(path.join(res, 'drawable-nodpi'), {recursive: true});
  await sharp(master).resize(512, 512).png().toFile(path.join(res, 'drawable-nodpi/launcher_artwork.png'));
  // Android themes tint an alpha mask derived from the same artwork.
  const {data, info} = await sharp(master).resize(512, 512).removeAlpha().raw().toBuffer({resolveWithObject: true});
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const light = (r + g + b) / 3;
    const strength = Math.max((light - 48) / 115, (b - r - 25) / 80);
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, strength)) * 255);
  }
  await sharp(rgba, {raw: {width: info.width, height: info.height, channels: 4}}).png().toFile(path.join(res, 'drawable-nodpi/launcher_monochrome.png'));
  const prefix = 'android/app/src/main/res/';
  write(prefix + 'values/launcher_colors.xml', '<resources><color name="launcher_background">#171B20</color></resources>\n');
  write(prefix + 'drawable/ic_launcher.xml', '<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/launcher_artwork" android:gravity="fill"/>\n');
  write(prefix + 'drawable/launcher_foreground.xml', '<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/launcher_artwork" android:gravity="fill"/>\n');
  write(prefix + 'drawable/launcher_themed.xml', '<bitmap xmlns:android="http://schemas.android.com/apk/res/android" android:src="@drawable/launcher_monochrome" android:gravity="fill"/>\n');
  const start = '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/launcher_background"/><foreground android:drawable="@drawable/launcher_foreground"/>';
  write(prefix + 'drawable-v26/ic_launcher.xml', start + '</adaptive-icon>\n');
  write(prefix + 'drawable-v33/ic_launcher.xml', start + '<monochrome android:drawable="@drawable/launcher_themed"/></adaptive-icon>\n');
  console.log('Exported web, Apple, Android adaptive and themed icons from one master.');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});

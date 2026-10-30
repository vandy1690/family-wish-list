// Stand-in product photos for the tests and the README screenshots: simple flat drawings,
// made by the browser. Real product photos never go in the repo.
// ds-allow: these are test images, not UI, so their colors are written out.
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PHOTOS } from './paths.mjs';

const car = (body, stripe) => `
  <path d="M40 190 L70 150 Q90 125 125 122 L195 122 Q225 124 245 150 L282 168 Q300 174 300 192 L300 205 L40 205 Z" fill="${body}"/>
  <path d="M98 152 L118 134 L160 134 L160 152 Z M172 152 L172 134 L200 134 Q218 138 228 152 Z" fill="#DCE6F2" opacity=".9"/>
  ${stripe ? `<rect x="40" y="170" width="260" height="8" fill="${stripe}"/>` : ''}
  <circle cx="98" cy="208" r="24" fill="#1B1F22"/><circle cx="98" cy="208" r="10" fill="#9AA3AD"/>
  <circle cx="242" cy="208" r="24" fill="#1B1F22"/><circle cx="242" cy="208" r="10" fill="#9AA3AD"/>`;

const DRAWINGS = {
  frames: { bg: '#EFECE6', svg: `
    <rect x="52" y="70" width="96" height="128" fill="#1D1D1D"/><rect x="62" y="80" width="76" height="108" fill="#F6F3EC"/>
    <rect x="160" y="54" width="110" height="144" fill="#1D1D1D"/><rect x="171" y="65" width="88" height="122" fill="#F6F3EC"/>
    <path d="M72 170 L95 140 L112 160 L124 148 L132 170 Z" fill="#C9C2B4"/><circle cx="235" cy="100" r="16" fill="#C9C2B4"/>` },
  snoopy: { bg: '#F4E9E3', svg: `
    <path d="M80 140 L160 78 L240 140 L240 230 L80 230 Z" fill="#B71C2E"/><path d="M68 146 L160 70 L252 146" stroke="#7A1220" stroke-width="12" fill="none" stroke-linejoin="round"/>
    <path d="M135 230 L135 175 Q160 150 185 175 L185 230 Z" fill="#3A1A16"/><rect x="60" y="228" width="200" height="10" rx="4" fill="#5C8F3A"/>` },
  falcon: { bg: '#E6E9EE', svg: `
    <ellipse cx="160" cy="160" rx="118" ry="96" fill="#B8BEC7"/><ellipse cx="160" cy="160" rx="34" ry="28" fill="#8C939D"/>
    <path d="M232 98 L296 80 L298 120 L250 132 Z" fill="#9EA5AF"/><path d="M232 222 L296 240 L298 200 L250 188 Z" fill="#9EA5AF"/>
    <circle cx="160" cy="160" r="12" fill="#5E6670"/>` },
  sailbarge: { bg: '#F1E7D6', svg: `
    <path d="M40 200 L280 200 L250 238 L70 238 Z" fill="#7A5A30"/><rect x="155" y="64" width="8" height="136" fill="#5E4424"/>
    <path d="M163 70 L250 185 L163 185 Z" fill="#E9DCC0"/><path d="M155 90 L90 185 L155 185 Z" fill="#D8C7A3"/>` },
  batmobile: { bg: '#E3E5E8', svg: car('#26292D', null) },
  shelby: { bg: '#E4EAF2', svg: car('#3F5F92', '#F5F7FA') },
  sleepingbag: { bg: '#F3E6E2', svg: `
    <rect x="60" y="70" width="200" height="190" rx="70" fill="#8D3B32"/><path d="M160 80 L160 250" stroke="#5E231D" stroke-width="6" stroke-dasharray="10 8"/>
    <ellipse cx="160" cy="105" rx="58" ry="26" fill="#B5574C"/>` },
  artemis: { bg: '#E3EFE8', svg: `
    <path d="M160 40 Q190 80 190 130 L190 220 L130 220 L130 130 Q130 80 160 40 Z" fill="#F7F7F2"/>
    <rect x="96" y="120" width="22" height="104" rx="8" fill="#E8833A"/><rect x="202" y="120" width="22" height="104" rx="8" fill="#E8833A"/>
    <path d="M140 220 L180 220 L172 262 L148 262 Z" fill="#2C664F"/><circle cx="160" cy="110" r="12" fill="#2C664F"/>` }
};

export async function makePhotos() {
  await mkdir(PHOTOS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
  for (const [name, d] of Object.entries(DRAWINGS)) {
    await page.setContent(`<body style="margin:0;background:${d.bg}"><svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">${d.svg}</svg></body>`);
    await page.screenshot({ path: `${PHOTOS}/${name}.png` });
  }
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) await makePhotos();

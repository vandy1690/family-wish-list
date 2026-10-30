// The name of this wish list, and who runs it.
//
// The admin sets the names on the People page (stored in settings). Until then they come
// from LISTS_TITLE and LISTS_SHORT_TITLE, or the defaults below. The admin's name is the
// name of the first person marked admin; the contact address for the page footer is
// LISTS_CONTACT_EMAIL, else LISTS_ADMIN_EMAIL.
export const DEFAULT_TITLE = 'Family Wish List';
export const DEFAULT_SHORT = 'Wish List';

export function siteInfo(state) {
  const s = (state && state.settings) || {};
  const admin = ((state && state.people) || []).find(p => p.admin);
  const title = s.title || process.env.LISTS_TITLE || DEFAULT_TITLE;
  return {
    title,
    shortTitle: s.shortTitle || process.env.LISTS_SHORT_TITLE || (s.title || process.env.LISTS_TITLE ? title : DEFAULT_SHORT),
    adminName: (admin && admin.name) || process.env.LISTS_ADMIN_NAME || 'the admin',
    contact: process.env.LISTS_CONTACT_EMAIL || process.env.LISTS_ADMIN_EMAIL || ''
  };
}

// An Adobe Fonts web project id, for the SDC display face (Nickel Gothic). Optional.
export const adobeKit = () => (/^[a-z0-9]{5,12}$/.test(process.env.LISTS_ADOBE_FONTS_KIT || '') ? process.env.LISTS_ADOBE_FONTS_KIT : '');

// Where email comes from: LISTS_FROM, else "Short title <lists@your-domain>", using the
// domain of LISTS_ORIGIN without its first part (family.example.com -> example.com).
export function fromAddress(site) {
  if (process.env.LISTS_FROM) return process.env.LISTS_FROM;
  let host = 'example.com';
  try { host = new URL(process.env.LISTS_ORIGIN).hostname; } catch {}
  const parts = host.split('.');
  const domain = parts.length > 2 ? parts.slice(1).join('.') : host;
  return `${site.shortTitle.replace(/[<>"]/g, '')} <lists@${domain}>`;
}

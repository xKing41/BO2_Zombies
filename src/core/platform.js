// Plattform-Erkennung (einmalig beim Laden)
const ua = navigator.userAgent || '';
const mq = (q) => { try { return window.matchMedia(q).matches; } catch { return false; } };

export const IS_IOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const IS_ANDROID = /Android/i.test(ua);
export const IS_MOBILE = IS_IOS || IS_ANDROID || /Mobi|Tablet/i.test(ua);
// Touch-Steuerung standardmäßig nur auf Geräten, deren Hauptzeiger ein Finger ist
export const IS_TOUCH = mq('(pointer: coarse)') || (IS_MOBILE && navigator.maxTouchPoints > 0);
export const IS_STANDALONE = mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || navigator.standalone === true;

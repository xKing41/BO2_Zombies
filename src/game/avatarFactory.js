// Figuren der Mitspieler. Solange die richtigen Überlebenden-Modelle fehlen,
// steht hier ein einfacher Platzhalter mit derselben Schnittstelle.
import * as THREE from 'three';

function tagTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = '600 34px Oswald, Arial Narrow, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.strokeText(text, 128, 34);
  c.fillStyle = color; c.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class PlaceholderAvatar {
  constructor(game, char, name) {
    this.g = game;
    const g = (this.group = new THREE.Group());
    g.userData.dynamic = true;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.8 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.95, 4, 10), mat);
    this.body.position.y = 0.95; this.body.castShadow = true;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc8a080, roughness: 0.7 }));
    this.head.position.y = 1.62; this.head.castShadow = true;
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.55), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.6 }));
    this.gun.position.set(0.16, 1.32, -0.3); this.gun.castShadow = true;
    this.pivot = new THREE.Group();
    this.pivot.add(this.body, this.head, this.gun);
    g.add(this.pivot);
    // Name und Wiederbelebungs-Symbol wie in BO2 in fester Bildschirmgröße (Maßstab je Bild, siehe update)
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.tag.position.y = 2.05;
    g.add(this.tag);
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3020, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.icon.position.y = 1.2; this.icon.visible = false; this.icon.renderOrder = 999;
    g.add(this.icon);
    this.setTag(name || 'Mitspieler', '#ffffff');
  }
  setWeapon(id) { this.gun.visible = !!id; }
  setTag(text, color) {
    if (this.tag.material.map) this.tag.material.map.dispose();
    this.tag.material.map = tagTexture(text, color);
    this.tag.material.needsUpdate = true;
  }
  setReviveIcon(on, progress = 0) { this.icon.visible = on; this.icon.material.color.setRGB(1, 0.2 + progress * 0.8, 0.1 + progress * 0.4); }
  setVisible(on) { this.group.visible = on; }
  update(dt, s) {
    this.group.position.copy(s.pos);
    this.group.rotation.y = s.yaw;
    const lying = s.downed || s.prone;
    this.pivot.rotation.x = lying ? -1.25 : s.dive ? -1.4 : 0;
    this.pivot.position.y = lying ? 0.35 : 0;
    this.pivot.scale.y = 1 - (s.crouch || 0) * 0.3;
    this.gun.rotation.x = s.pitch;
    // Feste Bildschirmgröße (18–40 px hoch), unabhängig von Entfernung und Sichtfeld der eigenen Kamera
    const k = Math.tan(((this.g.camera ? this.g.camera.fov : 80) * Math.PI) / 360);
    const vh = this.g.rs ? this.g.rs.height : 720;
    const h = (Math.min(40, Math.max(18, vh * 0.05)) / vh) * 2 * k;
    this.tag.scale.set(h * 4, h, 1);
    this.icon.scale.set(h * 1.4, h * 1.4, 1);
  }
  muzzleWorld(out) { return this.gun.localToWorld(out.set(0, 0, -0.3)); }
  headWorld(out) { return this.head.getWorldPosition(out); }
  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export function makeAvatar(game, char, name) {
  return new PlaceholderAvatar(game, char, name);
}

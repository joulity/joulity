// Joulity landing, 3D story with animated people (KayKit Character Animations, CC0, Kay Lousberg).
// Collective savings first: friends around a shared pocket, a new friend walks in and accepts the rules, everyone throws
// coins in (from any chain), they cheer at the goal, raise hands to vote, and only at the end the Joulity vault appears.
// Scroll position p (0 .. 6) drives the camera, the people and the objects.
(function () {
  const T = THREE;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ASSETS = "/assets/people/";
  let R, scene, cam, clock, el, raf = 0, running = false, P = 0, Pt = 0, drag = 0, dragT = 0, ready = false;
  const M = (c, o = {}) => new T.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.8, metalness: o.m ?? 0, emissive: o.e ?? 0, emissiveIntensity: o.ei ?? 0, transparent: o.op != null, opacity: o.op ?? 1, side: o.ds ? T.DoubleSide : T.FrontSide });
  const glow = (c, k = 0.8) => { const m = M(c, { e: c, ei: k, r: 0.4 }); m.transparent = true; return m; };
  function mesh(g, m, x = 0, y = 0, z = 0, p) { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; (p || scene).add(o); return o; }
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- labels: crisp white pills (canvas sprites) ----------
  function pill(text, o = {}) {
    const fs = o.fs || 46, pad = 34, cv = document.createElement("canvas"), x = cv.getContext("2d");
    x.font = `700 ${fs}px Inter,system-ui,sans-serif`; const tw = x.measureText(text).width;
    const sub = o.sub || ""; x.font = `600 ${Math.round(fs * 0.7)}px Inter,system-ui,sans-serif`; const sw = sub ? x.measureText(sub).width : 0;
    const dot = o.dot ? fs * 0.9 : 0, W = Math.ceil(Math.max(tw + dot, sw) + pad * 2), H = sub ? Math.round(fs * 2.5) : Math.round(fs * 1.7);
    cv.width = W; cv.height = H; const r = H / 2.2;
    x.beginPath(); x.moveTo(r, 0); x.arcTo(W, 0, W, H, r); x.arcTo(W, H, 0, H, r); x.arcTo(0, H, 0, 0, r); x.arcTo(0, 0, W, 0, r); x.closePath();
    x.fillStyle = o.bg || "#ffffff"; x.fill(); if (o.border) { x.lineWidth = 5; x.strokeStyle = o.border; x.stroke(); }
    x.textBaseline = "middle"; x.textAlign = "left";
    const ty = sub ? H * 0.36 : H / 2 + 2;
    if (o.dot) { x.beginPath(); x.arc(pad + fs * 0.32, ty, fs * 0.28, 0, 7); x.fillStyle = o.dot; x.fill(); }
    x.fillStyle = o.fg || "#0f172a"; x.font = `700 ${fs}px Inter,system-ui,sans-serif`; x.fillText(text, pad + dot, ty);
    if (sub) { x.fillStyle = o.fg2 || "#64748b"; x.font = `600 ${Math.round(fs * 0.7)}px Inter,system-ui,sans-serif`; x.fillText(sub, pad, H * 0.72); }
    const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding; tx.anisotropy = 4;
    const s = new T.Sprite(new T.SpriteMaterial({ map: tx, transparent: true, depthWrite: false, depthTest: false })); const k = o.scale || 0.0042; s.scale.set(W * k, H * k, 1); s.renderOrder = 20; scene.add(s); return s;
  }
  function logoDisc(file, col, text) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 256; const x = cv.getContext("2d");
    x.beginPath(); x.arc(128, 128, 124, 0, 7); x.fillStyle = "#fff"; x.fill(); x.beginPath(); x.arc(128, 128, 112, 0, 7); x.fillStyle = col; x.fill();
    x.fillStyle = "#fff"; x.font = "800 64px Inter,system-ui"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text || "", 128, 134);
    const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding;
    if (file) { const img = new Image(); img.onload = () => { x.save(); x.beginPath(); x.arc(128, 128, 108, 0, 7); x.clip(); x.fillStyle = "#fff"; x.fillRect(0, 0, 256, 256); x.drawImage(img, 22, 22, 212, 212); x.restore(); tx.needsUpdate = true; }; img.src = "/vault/logos/" + file; }
    const s = new T.Sprite(new T.SpriteMaterial({ map: tx, transparent: true })); s.scale.set(1.5, 1.5, 1); scene.add(s); return s;
  }

  // ---------- the friends ----------
  const CREW = [
    { name: "You", shirt: 0x1f2937, pants: 0x334155, skin: 0xf1c7a6, hair: 0x2b1d14, style: "short" },
    { name: "Sara", shirt: 0xec4899, pants: 0x1e3a8a, skin: 0xc68c5f, hair: 0x1c1410, style: "long" },
    { name: "Alex", shirt: 0x3b82f6, pants: 0x374151, skin: 0xf5d0b5, hair: 0xd4a017, style: "short" },
    { name: "Omar", shirt: 0xf59e0b, pants: 0x1f2937, skin: 0x8d5a3b, hair: 0x111111, style: "buzz" },
  ];
  const NEW = { name: "Lina", shirt: 0x10b981, pants: 0xe5e7eb, skin: 0xe0ac85, hair: 0x6b3a1e, style: "bun" };
  const SOLO = { name: "Just you", shirt: 0x6366f1, pants: 0x334155, skin: 0xf1c7a6, hair: 0x2b1d14, style: "short" };
  const R0 = 2.7, SLOTS = 5;
  const slot = (i) => { const a = Math.PI * (1.12 + (i / (SLOTS - 1)) * 0.76); return [Math.cos(a) * R0, Math.sin(a) * R0 - 0.2]; };

  let BASE = null; const CLIPS = {};
  function makePerson(cfg) {
    const o = T.SkeletonUtils.clone(BASE);
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      const n = m.name, col = /Head/.test(n) ? cfg.skin : /Leg/.test(n) ? cfg.pants : cfg.shirt;
      m.material = new T.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0, skinning: !!m.isSkinnedMesh });
    });
    const head = o.getObjectByName("head");
    let headMesh = null; o.traverse((m) => { if (m.isMesh && /Head/.test(m.name)) headMesh = m; });
    if (head && headMesh) {
      o.updateMatrixWorld(true); headMesh.geometry.computeBoundingBox();
      const bb = headMesh.geometry.boundingBox, c = bb.getCenter(new T.Vector3()), sz = bb.getSize(new T.Vector3()), hp = head.getWorldPosition(new T.Vector3());
      const off = c.clone().sub(hp), F = new T.Group(); head.add(F); F.position.copy(off);
      const ink = new T.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4 });
      for (const sx of [-1, 1]) { const e = new T.Mesh(new T.SphereGeometry(sz.x * 0.07, 16, 12), ink); e.position.set(sx * sz.x * 0.2, sz.y * 0.02, sz.z * 0.5 + 0.005); e.scale.set(1, 1.25, 0.5); F.add(e); }
      const smile = new T.Mesh(new T.TorusGeometry(sz.x * 0.12, sz.x * 0.022, 8, 20, Math.PI), ink); smile.rotation.z = Math.PI; smile.position.set(0, -sz.y * 0.16, sz.z * 0.5 + 0.005); F.add(smile);
      const blush = new T.MeshStandardMaterial({ color: 0xf9a8a8, roughness: 0.8, transparent: true, opacity: 0.55 });
      for (const sx of [-1, 1]) { const b = new T.Mesh(new T.CircleGeometry(sz.x * 0.07, 16), blush); b.position.set(sx * sz.x * 0.32, -sz.y * 0.1, sz.z * 0.5 + 0.006); F.add(b); }
      const hm = M(cfg.hair, { r: 0.7 });
      const cap = new T.Mesh(new T.SphereGeometry(0.5, 28, 16, 0, Math.PI * 2, 0, cfg.style === "buzz" ? Math.PI * 0.3 : Math.PI * 0.45), hm); cap.scale.set(sz.x * 1.08, sz.y * 0.9, sz.z * 1.1); cap.position.set(0, sz.y * 0.12, -sz.z * 0.04); F.add(cap);
      if (cfg.style === "long") { const back = new T.Mesh(new T.BoxGeometry(sz.x * 1.0, sz.y * 0.85, sz.z * 0.2), hm); back.position.set(0, -sz.y * 0.05, -sz.z * 0.5); F.add(back); }
      if (cfg.style === "bun") { const bun = new T.Mesh(new T.SphereGeometry(sz.x * 0.2, 16, 12), hm); bun.position.set(0, sz.y * 0.55, -sz.z * 0.3); F.add(bun); }
      F.traverse((x) => (x.castShadow = true));
    }
    if (false) {
      const hm = M(cfg.hair, { r: 0.7 }), g = new T.Group(); head.add(g);
      const cap = new T.Mesh(new T.SphereGeometry(0.36, 24, 16, 0, Math.PI * 2, 0, cfg.style === "buzz" ? Math.PI * 0.32 : Math.PI * 0.5), hm); cap.position.set(0, 0.42, -0.02); cap.scale.set(1.08, 0.9, 1.1); g.add(cap);
      if (cfg.style === "long") { const back = new T.Mesh(new T.BoxGeometry(0.62, 0.62, 0.16), hm); back.position.set(0, 0.2, -0.3); g.add(back); }
      if (cfg.style === "bun") { const bun = new T.Mesh(new T.SphereGeometry(0.15, 16, 12), hm); bun.position.set(0, 0.62, -0.25); g.add(bun); }
      g.traverse((x) => (x.castShadow = true));
    }
    const holder = new T.Group(); holder.add(o); scene.add(holder);
    o.scale.setScalar(0.85);
    const mixer = new T.AnimationMixer(o), acts = {};
    const play = (name, loop = true) => {
      if (holder.userData.cur === name) return; const clip = CLIPS[name]; if (!clip) return;
      const a = acts[name] || (acts[name] = mixer.clipAction(clip)); a.reset(); a.setLoop(loop ? T.LoopRepeat : T.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.enabled = true;
      const prev = acts[holder.userData.cur]; if (prev) a.crossFadeFrom(prev, 0.35, false); a.play(); holder.userData.cur = name;
    };
    const tag = pill(cfg.name, { dot: "#" + new T.Color(cfg.shirt).getHexString(), fs: 44 });
    const vote = mesh(new T.SphereGeometry(0.14, 16, 12), M(0xd1d5db), 0, 0, 0); vote.visible = false;
    play("Idle_A");
    return { holder, mixer, play, tag, vote, cfg };
  }

  // ---------- scene objects ----------
  let liquid, ring, goalTag = null, crew = [], lina, solo, soloTag, rules, check, portals = [], coins = [], plane, confetti = [], shield, lock, bank, bankTag, vaultStream = [], groupTag;
  function build() {
    const floor = new T.Mesh(new T.CircleGeometry(80, 96), M(0xeef1f5, { r: 1 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const grid = new T.GridHelper(120, 60, 0xdfe3e9, 0xe6e9ee); grid.position.y = 0.01; grid.material.transparent = true; grid.material.opacity = 0.6; scene.add(grid);
    mesh(new T.CylinderGeometry(4.3, 4.3, 0.08, 96), M(0xffffff), 0, 0.04, 0);
    const rim = new T.Mesh(new T.TorusGeometry(4.3, 0.05, 8, 128), glow(0x00a67e, 0.6)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.09; scene.add(rim);
    // the shared jar
    const jar = mesh(new T.CylinderGeometry(0.95, 0.95, 2.0, 48, 1, true), M(0xbfe6dc, { op: 0.3, r: 0.05, m: 0.1, ds: true }), 0, 1.15, 0); jar.castShadow = false;
    mesh(new T.CylinderGeometry(1.05, 1.05, 0.16, 48), M(0xffffff), 0, 0.12, 0);
    const lip = mesh(new T.TorusGeometry(0.95, 0.05, 8, 48), M(0xffffff), 0, 2.15, 0); lip.rotation.x = Math.PI / 2;
    liquid = mesh(new T.CylinderGeometry(0.87, 0.87, 1, 48), M(0x10b98a, { e: 0x10b98a, ei: 0.25, r: 0.3, op: 0.9 }), 0, 0.2, 0);
    const rb = new T.Mesh(new T.TorusGeometry(1.45, 0.04, 8, 96), M(0xe5e7eb)); rb.rotation.x = Math.PI / 2; rb.position.y = 0.12; scene.add(rb);
    ring = new T.Mesh(new T.TorusGeometry(1.45, 0.08, 8, 96, 0.01), glow(0x00a67e)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.13; scene.add(ring);
    groupTag = pill("Group pocket", { sub: "5 friends · one goal", fs: 40 }); groupTag.position.set(0, 4.3, 0);
    // the people
    CREW.forEach((c, i) => { const o = makePerson(c); const [x, z] = slot(i); o.holder.position.set(x, 0.08, z); o.holder.lookAt(0, 0.08, 0); crew.push(o); });
    lina = makePerson(NEW);
    solo = makePerson(SOLO); solo.holder.position.set(-6.2, 0, 0.6); solo.holder.lookAt(-5.0, 0, 2.6);
    mesh(new T.CylinderGeometry(0.42, 0.42, 1.0, 32, 1, true), M(0xbfe6dc, { op: 0.32, ds: true }), -5.2, 0.5, 1.8).castShadow = false;
    mesh(new T.CylinderGeometry(0.38, 0.38, 0.45, 32), M(0x6366f1, { e: 0x6366f1, ei: 0.25, op: 0.9 }), -5.2, 0.23, 1.8);
    soloTag = pill("Personal pocket", { sub: "New laptop · $420 of $1,500", fs: 40 }); soloTag.position.set(-5.6, 2.9, 1.2);
    rules = pill("Locked goal · rules", { sub: "75% to pay out · 50% to leave", fs: 42, border: "#2f6fe4" });
    check = pill("✓ Rules accepted", { bg: "#00a67e", fg: "#ffffff", fs: 42 });
    // chains: portals with logos; coins fly from them into the jar
    [["ethereum.png", "#627EEA", "", -5.5, 5.6, -5, "Ethereum"], ["base.png", "#0052FF", "", -1.9, 6.4, -6.5, "Base"], [null, "#9945FF", "SOL", 2.0, 6.4, -6.5, "Solana"], ["near.jpg", "#00EC97", "", 5.6, 5.6, -5, "NEAR"]].forEach(([f, c, t, x, y, z, n]) => {
      const d = logoDisc(f, c, t); d.position.set(x, y, z);
      const halo = new T.Mesh(new T.TorusGeometry(0.95, 0.05, 8, 48), glow(new T.Color(c).getHex(), 0.9)); halo.position.set(x, y, z); scene.add(halo);
      const nm = pill(n, { fs: 40 }); nm.position.set(x, y - 1.3, z);
      portals.push({ d, halo, nm, from: new T.Vector3(x, y, z) });
    });
    for (let i = 0; i < 30; i++) { const c = mesh(new T.CylinderGeometry(0.13, 0.13, 0.04, 20), M(0xf2c14e, { m: 0.5, r: 0.3, e: 0xf2c14e, ei: 0.3 })); c.rotation.x = Math.PI / 2; c.userData = { t: Math.random(), k: i % 5, sp: 0.4 + Math.random() * 0.25, portal: i % 2 === 0 }; c.visible = false; coins.push(c); }
    // the goal: a plane rises from the jar
    plane = new T.Group(); scene.add(plane);
    const pm = M(0xffffff, { r: 0.4 }), pa = M(0x2f6fe4, { e: 0x2f6fe4, ei: 0.3, r: 0.4 });
    mesh(new T.CylinderGeometry(0.2, 0.14, 2.0, 20), pm, 0, 0, 0, plane).rotation.z = Math.PI / 2;
    mesh(new T.BoxGeometry(0.45, 0.05, 2.2), pa, 0.1, 0, 0, plane); mesh(new T.BoxGeometry(0.28, 0.05, 0.8), pa, -0.85, 0.05, 0, plane); mesh(new T.BoxGeometry(0.28, 0.45, 0.05), pa, -0.85, 0.26, 0, plane);
    for (let i = 0; i < 80; i++) { const col = [0x00a67e, 0x2f6fe4, 0xf2c14e, 0xec4899][i % 4]; const c = mesh(new T.BoxGeometry(0.09, 0.02, 0.15), M(col, { e: col, ei: 0.3 })); c.castShadow = false; c.userData = { a: Math.random() * 7, r: 0.5 + Math.random() * 3, v: 2 + Math.random() * 3, s: Math.random() * 6 }; c.visible = false; confetti.push(c); }
    // safety: glass shield and a lock
    shield = mesh(new T.SphereGeometry(4.6, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), M(0x93c5fd, { op: 0, r: 0.1, m: 0.2, ds: true }), 0, 0.05, 0); shield.castShadow = false;
    lock = new T.Group(); scene.add(lock); mesh(new T.BoxGeometry(0.8, 0.62, 0.28), M(0x2f6fe4, { e: 0x2f6fe4, ei: 0.35 }), 0, 0, 0, lock); const sh = new T.Mesh(new T.TorusGeometry(0.27, 0.06, 8, 24, Math.PI), M(0x2f6fe4)); sh.position.y = 0.31; lock.add(sh);
    // the Joulity vault, only at the end
    bank = new T.Group(); scene.add(bank); bank.position.set(9.5, 0, -8.5);
    const cl = M(0xf3f3f0), cl2 = M(0xdfe2e6);
    mesh(new T.BoxGeometry(9, 0.5, 6.5), cl2, 0, 0.25, 0, bank); mesh(new T.BoxGeometry(7, 4.8, 4.4), cl, 0, 2.9, -0.3, bank);
    mesh(new T.BoxGeometry(7.6, 4.4, 0.08), M(0x9fe3cf, { op: 0.45, r: 0.1 }), 0, 2.7, 1.95, bank);
    for (let i = 0; i <= 10; i++) mesh(new T.BoxGeometry(0.08, 4.4, 0.4), cl, -3.8 + i * 0.76, 2.7, 2.0, bank);
    mesh(new T.BoxGeometry(8, 0.35, 5.4), cl2, 0, 5.45, -0.3, bank);
    mesh(new T.BoxGeometry(1.4, 1.4, 1.4), M(0x10b98a, { e: 0x10b98a, ei: 0.6, op: 0.9 }), 0, 1.4, 0.6, bank);
    bankTag = pill("Joulity vault", { sub: "your pockets earn here", fs: 46, border: "#00a67e" }); bankTag.position.set(9.5, 7.4, -8.5);
    bank.scale.setScalar(0.01);
    for (let i = 0; i < 18; i++) { const c = mesh(new T.SphereGeometry(0.12, 12, 8), new T.MeshBasicMaterial({ color: 0x10b98a })); c.castShadow = false; c.userData.t = i / 18; c.visible = false; vaultStream.push(c); }
  }

  // ---------- camera: one pose per chapter, a slow drift so it never feels frozen ----------
  const K = [
    [[-0.6, 2.9, 8.4], [-1.3, 1.4, -1.2]],  // 0 save together: the group, faces to camera
    [[-3.8, 3.2, 8.0], [-4.6, 1.2, 0.5]],  // 1 personal or group
    [[6.5, 2.9, 8.0], [3.0, 1.2, 0.5]],    // 2 Lina walks in, rules
    [[0, 4.4, 11.5], [0, 3.4, -3.0]],      // 3 coins from every chain
    [[1.0, 2.5, 6.8], [-0.9, 1.9, -0.8]],   // 4 goal reached, cheering
    [[-4.5, 4.4, 7.2], [0, 1.4, -1.0]],    // 5 votes, shield
    [[16, 9.5, 12.5], [5, 2.2, -4.2]],     // 6 the vault
  ];
  const v1 = new T.Vector3(), v2 = new T.Vector3();
  function camAt(p, t) {
    const i = Math.max(0, Math.min(K.length - 1, Math.floor(p))), j = Math.min(K.length - 1, i + 1), u = sm(0, 1, p - i);
    const pos = v1.set(...K[i][0]).lerp(v2.set(...K[j][0]), u).clone(), tgt = v1.set(...K[i][1]).lerp(v2.set(...K[j][1]), u).clone();
    if (cam.aspect < 0.9) pos.sub(tgt).multiplyScalar(1.5).add(tgt);
    const off = pos.clone().sub(tgt); off.applyAxisAngle(new T.Vector3(0, 1, 0), drag + (reduce ? 0 : Math.sin(t * 0.15) * 0.06));
    cam.position.copy(tgt).add(off); cam.lookAt(tgt);
  }

  const bez = (a, b, h, t) => { const m = a.clone().add(b).multiplyScalar(0.5); m.y += h; const u = 1 - t; return new T.Vector3(u * u * a.x + 2 * u * t * m.x + t * t * b.x, u * u * a.y + 2 * u * t * m.y + t * t * b.y, u * u * a.z + 2 * u * t * m.z + t * t * b.z); };
  const JAR_IN = new T.Vector3(0, 2.3, 0);
  function setGoal(amt) {
    if (goalTag && goalTag.userData.a === amt) return;
    if (goalTag) { scene.remove(goalTag); goalTag.material.map.dispose(); goalTag.material.dispose(); }
    goalTag = pill("Summer trip", { sub: amt >= 3000 ? "Goal reached · $3,000" : `$${amt.toLocaleString()} of $3,000`, fs: 50, border: "#00a67e" });
    goalTag.position.set(0, 3.3, 0); goalTag.userData.a = amt;
  }

  function frame() {
    if (!running) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    if (!ready) { R.render(scene, cam); return; }
    P += (Pt - P) * Math.min(1, dt * 3); drag += (dragT - drag) * 0.08;
    const p = P; camAt(p, t);
    const everyone = [...crew, lina];
    // jar and goal ring
    const f = Math.min(1, lerp(0.35, 0.5, sm(0.5, 2.5, p)) + 0.35 * sm(2.8, 3.8, p) + 0.15 * sm(3.8, 4.3, p));
    const h = 0.05 + 1.85 * f; liquid.scale.y = h; liquid.position.y = 0.2 + h / 2;
    ring.geometry.dispose(); ring.geometry = new T.TorusGeometry(1.45, 0.08, 8, 96, Math.max(0.01, Math.PI * 2 * f));
    setGoal(Math.round(3000 * f / 10) * 10);
    groupTag.material.opacity = sm(0.5, 1.0, p) * (1 - sm(2.0, 2.5, p));
    soloTag.material.opacity = sm(0.5, 1.0, p) * (1 - sm(1.7, 2.2, p)); solo.tag.material.opacity = soloTag.material.opacity;
    // Lina: walks in, reads the rules, accepts, joins, waves
    const walk = sm(1.35, 2.25, p), [sx, sz] = slot(4), from = [8.5, 4.5];
    const lx = lerp(from[0], sx, walk), lz = lerp(from[1], sz, walk), walking = walk > 0.02 && walk < 0.98;
    lina.holder.position.set(lx, 0.08 * walk, lz);
    if (walking) lina.holder.lookAt(sx, lina.holder.position.y, sz); else lina.holder.lookAt(0, lina.holder.position.y, 0);
    rules.position.set(lx, 3.1, lz); rules.material.opacity = sm(1.3, 1.55, p) * (1 - sm(2.0, 2.25, p));
    check.position.set(lx, 2.55, lz); check.material.opacity = sm(1.85, 2.0, p) * (1 - sm(2.6, 2.9, p));
    // who does what, by chapter
    const want = (o, i) => {
      if (o === lina && walking) return "Walking_A";
      if (o === lina && walk <= 0.02) return "Idle_A";
      if (p < 0.6) return i === 0 ? "Waving" : "Idle_A";
      if (p < 1.3) return "Idle_A";
      if (p < 2.6) return o === lina ? "Waving" : "Idle_A";
      if (p < 3.85) return "Throw";
      if (p < 4.65) return "Cheering";
      if (p < 5.55) return i < 4 ? "Interact" : "Idle_A";
      return "Idle_A";
    };
    everyone.forEach((o, i) => { o.play(want(o, i)); o.mixer.update(dt); });
    solo.play(p > 0.6 && p < 1.8 ? "Interact" : "Idle_A"); solo.mixer.update(dt);
    // name tags and vote dots
    [...everyone, solo].forEach((o) => o.tag.position.set(o.holder.position.x, 2.05, o.holder.position.z));
    lina.tag.material.opacity = sm(1.2, 1.5, p);
    const sec = sm(4.6, 5.1, p) * (1 - sm(5.6, 6.0, p));
    everyone.forEach((o, i) => { o.vote.visible = sec > 0.05; o.vote.position.set(o.holder.position.x, 2.6, o.holder.position.z); const on = i < 4 && p > 4.85 + i * 0.08; o.vote.material.color.setHex(on ? 0x10b98a : 0xd1d5db); o.vote.material.emissive.setHex(on ? 0x10b98a : 0); o.vote.material.emissiveIntensity = on ? 0.7 : 0; });
    shield.material.opacity = 0.15 * sec; shield.visible = sec > 0.01;
    lock.visible = sec > 0.01; lock.position.set(0, 5.0 + Math.sin(t * 1.5) * 0.1, 0); lock.scale.setScalar(Math.max(0.01, sec)); lock.rotation.y = t * 0.6;
    // coins: from the people (all along) and from every chain (chapter 3)
    const small = sm(0.3, 0.8, p) * (1 - sm(4.0, 4.4, p)), flow = sm(2.5, 2.9, p) * (1 - sm(4.1, 4.5, p));
    portals.forEach((q, i) => { const k = sm(2.4, 2.9, p) * (1 - sm(4.3, 4.9, p)); q.d.material.opacity = q.halo.material.opacity = q.nm.material.opacity = k; q.halo.visible = k > 0.02; q.halo.rotation.y = t * 0.8 + i; q.d.position.y = q.from.y + Math.sin(t * 1.3 + i) * 0.15; });
    coins.forEach((c) => {
      const u = c.userData, k = u.portal ? flow : small; c.visible = k > 0.05 && !reduce; if (!c.visible) return;
      u.t = (u.t + dt * u.sp) % 1;
      const src = u.portal ? portals[u.k % 4].from : new T.Vector3(everyone[u.k].holder.position.x, 1.5, everyone[u.k].holder.position.z);
      c.position.copy(bez(src, JAR_IN, u.portal ? 2 : 1.0, u.t)); c.rotation.z += dt * 5; c.scale.setScalar(k);
    });
    // the goal: plane and confetti
    const up = sm(3.75, 4.4, p) * (1 - sm(5.1, 5.6, p));
    plane.visible = up > 0.01; plane.position.set(Math.sin(t * 0.6) * 0.5 * up, 2.4 + up * 2.6, 0); plane.rotation.set(0, t * 0.5, Math.sin(t) * 0.1); plane.scale.setScalar(Math.max(0.01, up));
    const cf = sm(3.9, 4.15, p) * (1 - sm(4.8, 5.2, p));
    confetti.forEach((c) => { const u = c.userData; c.visible = cf > 0.02 && !reduce; if (!c.visible) return; const tt = (t * 0.6 + u.s) % 3; c.position.set(Math.cos(u.a) * u.r * (0.4 + tt * 0.4), 2.4 + u.v * tt - 2.2 * tt * tt, Math.sin(u.a) * u.r * (0.4 + tt * 0.4)); c.rotation.set(t * 3 + u.a, t * 2, 0); });
    // the vault at the end
    const vb = sm(5.4, 6.0, p); bank.scale.setScalar(Math.max(0.01, vb)); bankTag.material.opacity = vb;
    const a = new T.Vector3(0, 2.3, 0), b = new T.Vector3(9.5, 3.2, -6.8);
    vaultStream.forEach((c) => { c.visible = vb > 0.05; if (!c.visible) return; c.userData.t = (c.userData.t + dt * 0.25) % 1; c.position.copy(bez(a, b, 4, c.userData.t)); });
    R.render(scene, cam);
  }

  function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
  async function init(container) {
    el = container;
    R = new T.WebGLRenderer({ antialias: true }); R.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap; R.outputEncoding = T.sRGBEncoding; R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
    el.appendChild(R.domElement);
    scene = new T.Scene();
    const cv = document.createElement("canvas"); cv.width = 4; cv.height = 256; const g = cv.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#dfe8f3"); gr.addColorStop(0.6, "#eef2f7"); gr.addColorStop(1, "#e5e9ef"); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    scene.background = new T.CanvasTexture(cv); scene.fog = new T.Fog(0xe9eef4, 40, 100);
    cam = new T.PerspectiveCamera(40, 1, 0.1, 400); cam.position.set(6.5, 3.6, 8); cam.lookAt(0, 1.4, 0);
    scene.add(new T.HemisphereLight(0xffffff, 0xc9cfd8, 0.8));
    const sun = new T.DirectionalLight(0xfff6ea, 1.25); sun.position.set(-10, 22, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 }); sun.shadow.camera.updateProjectionMatrix(); sun.shadow.radius = 4; sun.shadow.bias = -0.0004; scene.add(sun);
    clock = new T.Clock();
    const size = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; R.setSize(w, h, false); R.domElement.style.width = "100%"; R.domElement.style.height = "100%"; cam.aspect = w / h; cam.updateProjectionMatrix(); };
    new ResizeObserver(size).observe(el); size();
    let x0 = null; el.addEventListener("pointerdown", (e) => (x0 = e.clientX)); addEventListener("pointerup", () => (x0 = null));
    addEventListener("pointermove", (e) => { if (x0 == null) return; dragT = Math.max(-1.2, Math.min(1.2, dragT + (e.clientX - x0) * 0.004)); x0 = e.clientX; });
    Story.ready = true;
    // the people: one CC0 mannequin, animation clips shared by everyone
    if (!T.GLTFLoader) await loadScript("https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js");
    if (!T.SkeletonUtils) await loadScript("https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/SkeletonUtils.js");
    const L = new T.GLTFLoader(), get = (f) => new Promise((ok, no) => L.load(ASSETS + f, ok, undefined, no));
    const [gen, mov, sim] = await Promise.all(["Rig_Medium_General.glb", "Rig_Medium_MovementBasic.glb", "Rig_Medium_Simulation.glb"].map(get));
    // the body that ships with the clips (the separate mannequin file binds differently)
    BASE = gen.scene; for (const g2 of [gen, mov, sim]) for (const c of g2.animations) CLIPS[c.name] = c;
    build(); ready = true;
  }
  function setProgress(p) { Pt = p; }
  function pause() { running = false; cancelAnimationFrame(raf); }
  function resume() { if (running) return; running = true; clock.getDelta(); frame(); }
  window.Story = { init, setProgress, pause, resume, ready: false };
})();

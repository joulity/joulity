// Joulity landing, "film": a short comic-strip story played scene by scene with the user's Mixamo characters.
// Each scene: a camera move, character actions, timed captions + speech bubbles, and the app shown on a 3D smartphone
// floating next to the characters (no flat cards over the picture). Next / scroll / swipe / arrows change scene.
// ?rec=1 turns off the real-time loop so a recorder can step the film frame by frame (smooth video, any machine).
(function () {
  const T = THREE, ASSETS = "/assets/cast/";
  const REC = /[?&]rec=1/.test(location.search);
  const reduce = !REC && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let R, scene, cam, clock, el, ui, raf = 0, running = false, ready = false, onScene = null, INSTANT = false;
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  // ---------- characters ----------
  const CAST = { adam: { file: "char1.glb", name: "Adam" }, sami: { file: "char2.glb", name: "Sami" } };
  const actors = {};
  let SRC = null;
  function retarget(actor, s) {
    const A = s.userData.scene; A.updateMatrixWorld(true); const an = {}; A.traverse((n) => { if (/^mixamorig/.test(n.name)) an[n.name] = n; });
    const Wa = {}, PWa = {}; for (const k in an) { Wa[k] = an[k].getWorldQuaternion(new T.Quaternion()); PWa[k] = an[k].parent.getWorldQuaternion(new T.Quaternion()); }
    const tq = {}; let times = null; for (const t of s.tracks) if (t.name.endsWith(".quaternion")) { const b = t.name.slice(0, -11); tq[b] = t.createInterpolant(); if (!times || t.times.length > times.length) times = t.times; }
    const bones = actor.order.filter((b) => an[b]), out = {}; bones.forEach((b) => (out[b] = new Float32Array(times.length * 4)));
    const Ga = {}, Gc = {}, q = new T.Quaternion(), iw = {}; bones.forEach((b) => (iw[b] = Wa[b].clone().invert()));
    times.forEach((tt, f) => {
      for (const b of bones) {
        const p = an[b].parent.name, PG = Ga[p] || PWa[b];
        if (tq[b]) { const v = tq[b].evaluate(tt); q.set(v[0], v[1], v[2], v[3]); } else q.copy(an[b].quaternion);
        Ga[b] = (Ga[b] || new T.Quaternion()).copy(PG).multiply(q);
        Gc[b] = (Gc[b] || new T.Quaternion()).copy(Ga[b]).multiply(iw[b]).multiply(actor.rest[b].w);
        const PC = Gc[p] && actor.rest[p] ? Gc[p] : actor.rest[b].pw;
        q.copy(PC).invert().multiply(Gc[b]).toArray(out[b], f * 4);
      }
      for (const k in Ga) if (!bones.includes(k)) delete Ga[k];
    });
    return bones.map((b) => new T.QuaternionKeyframeTrack(b + ".quaternion", times, out[b]));
  }
  function clipFor(actor, name) {
    if (actor.clips[name]) return actor.clips[name];
    if (name === "Idle") {
      // standing still with a soft breath: body from the first frame of "Waving" (arms down), legs from "Tablet"
      const wv = clipFor(actor, "Waving"); if (!wv) return null;
      const D = 4, q = new T.Quaternion(), b = new T.Quaternion(), ax = new T.Vector3(1, 0, 0), out = [];
      for (const t of wv.tracks) {
        const n = t.getValueSize(); let v0 = Array.from(t.values.slice(0, n));
        if (/Spine2\.quaternion$/.test(t.name)) {
          q.fromArray(v0); b.setFromAxisAngle(ax, 0.025); const v1 = q.clone().multiply(b).toArray();
          out.push(new T.QuaternionKeyframeTrack(t.name, [0, D / 2, D], v0.concat(v1, v0)));
        } else out.push(new (t.constructor)(t.name, [0, D], v0.concat(v0)));
      }
      return (actor.clips[name] = new T.AnimationClip(name, D, out));
    }
    const s = SRC.find((c) => c.name === name); if (!s) return null;
    const tr = [];
    // Mixamo "Waving" bends the knees: keep its upper body, stand the legs + hips still (first frame of the standing "Tablet" clip)
    const legs = name === "Waving" ? SRC.find((c) => c.name === "Tablet") : null;
    const LOWER = /^mixamorig(Hips|Spine\d?|Neck|LeftShoulder|LeftArm|LeftForeArm|LeftHand\w*|LeftUpLeg|LeftLeg|LeftFoot|LeftToe\w*|RightUpLeg|RightLeg|RightFoot|RightToe\w*)\./;
    const RT = s.userData && s.userData.scene ? retarget(actor, s) : null;
    if (RT) tr.push(...RT);
    for (let t of s.tracks) {
      if (RT && t.name.endsWith(".quaternion")) continue;
      if (legs && LOWER.test(t.name)) {
        const lt = legs.tracks.find((x) => x.name === t.name); if (!lt) continue;
        const n = lt.getValueSize(), v0 = Array.from(lt.values.slice(0, n));
        t = new (lt.constructor)(t.name, [0, s.duration], v0.concat(v0));
      }
      if (t.name.endsWith(".quaternion")) { tr.push(t); continue; }
      if (t.name === "mixamorigHips.position") {
        const R0 = s.userData && s.userData.rest, v = Float32Array.from(t.values), k = R0 ? Math.abs(actor.hipRest.z) / Math.abs(R0.z || 209) : actor.hipK, inPlace = name === "Walking";
        for (let i = 0; i < v.length; i += 3) { v[i] = inPlace ? actor.hipRest.x : v[i] * k; v[i + 1] = inPlace ? actor.hipRest.y : v[i + 1] * k; v[i + 2] = v[i + 2] * k; }
        tr.push(new T.VectorKeyframeTrack(t.name, t.times, v));
      }
    }
    return (actor.clips[name] = new T.AnimationClip(name, s.duration, tr));
  }
  function setupActor(key, gltf, animRest) {
    const o = gltf.scene, a = { key, o, clips: {}, acts: {}, cur: null };
    o.traverse((m) => {
      if (m.isMesh) {
        m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => {
          // Mixamo: "Glossiness" was mapped as roughness/metal and the diffuse alpha as transparency -> keep colour + normal only
          mt.metalnessMap = null; mt.roughnessMap = null; mt.metalness = 0; mt.roughness = 0.82;
          if (!/hair|lash|brow/i.test(mt.name + " " + m.name)) { mt.transparent = false; mt.opacity = 1; mt.alphaTest = 0; mt.depthWrite = true; }
          else { mt.transparent = true; mt.alphaTest = 0.08; mt.depthWrite = false; m.renderOrder = 2; }
          if (mt.map) mt.map.anisotropy = 4; mt.needsUpdate = true;
        });
      }
      if (m.name === "mixamorigHips") a.hipRest = m.position.clone();
      if (m.name === "mixamorigHead") a.head = m;
      if (m.name === "mixamorigLeftHand") a.lhand = m;
      if (m.name === "mixamorigRightHand") a.rhand = m;
      if (m.name === "mixamorigLeftArm") a.larm = m;
      if (m.name === "mixamorigRightArm") a.rarm = m;
    });
    a.hipK = Math.abs(a.hipRest.z) / Math.abs(animRest.z || 209);
    o.updateMatrixWorld(true); a.rest = {}; a.order = [];
    o.traverse((n) => { if (n.isBone || /^mixamorig/.test(n.name)) { a.rest[n.name] = { w: n.getWorldQuaternion(new T.Quaternion()), pw: n.parent.getWorldQuaternion(new T.Quaternion()) }; a.order.push(n.name); } });
    const g = new T.Group(); g.add(o); scene.add(g); a.g = g;
    a.mixer = new T.AnimationMixer(o);
    a.play = (name, opts = {}) => {
      if (a.cur === name && !opts.restart) return;
      const c = clipFor(a, name); if (!c) return;
      const act = a.acts[name] || (a.acts[name] = a.mixer.clipAction(c));
      act.reset(); act.setLoop(opts.once ? T.LoopOnce : T.LoopRepeat, Infinity); act.clampWhenFinished = !!opts.once; act.timeScale = opts.speed || 1;
      const prev = a.acts[a.cur];
      if (INSTANT) { a.mixer.stopAllAction(); act.reset(); } else if (prev && prev !== act) act.crossFadeFrom(prev, opts.fade ?? 0.45, false);
      if (opts.at) act.time = opts.at; act.play(); a.cur = name;
    };
    // a smartphone in the left hand (bone space is in centimetres)
    const ph = new T.Group();
    const body = new T.Mesh(new T.BoxGeometry(0.074, 0.154, 0.008), new T.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.35, metalness: 0.3 }));
    const glass = new T.Mesh(new T.PlaneGeometry(0.068, 0.146), new T.MeshBasicMaterial({ color: 0xbff0e2 })); glass.position.z = 0.0042;
    ph.add(body, glass); ph.visible = false; ph.traverse((m) => { if (m.isMesh) m.castShadow = true; }); scene.add(ph); a.phone = ph; a.glass = glass;
    a.walk = null;
    actors[key] = a; return a;
  }

  // ---------- the big floating smartphone: the app, in 3D ----------
  let P3 = null;
  function rr(x, w, h, r) { const s = new T.Shape(); s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return s; }
  function makePhone3D() {
    const g = new T.Group(), W = 0.42, H = 0.86;
    const frame = new T.Mesh(new T.ExtrudeGeometry(rr(0, W, H, 0.06), { depth: 0.035, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 3, curveSegments: 12 }), new T.MeshStandardMaterial({ color: 0x111827, roughness: 0.3, metalness: 0.6 }));
    frame.position.z = -0.035; frame.castShadow = true; g.add(frame);
    const cv = document.createElement("canvas"); cv.width = 540; cv.height = 1110; const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding; tx.anisotropy = 8;
    const scr = new T.Mesh(new T.ShapeGeometry(rr(0, W - 0.03, H - 0.03, 0.045), 12), new T.MeshBasicMaterial({ map: tx, toneMapped: false }));
    // map the shape UVs onto the full canvas
    const pos = scr.geometry.attributes.position, uv = scr.geometry.attributes.uv; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (W - 0.03) + 0.5, pos.getY(i) / (H - 0.03) + 0.5);
    scr.position.z = 0.0075; g.add(scr);
    const notch = new T.Mesh(new T.CircleGeometry(0.012, 16), new T.MeshBasicMaterial({ color: 0x0b0f17 })); notch.position.set(0, H / 2 - 0.04, 0.009); g.add(notch);
    g.visible = false; scene.add(g);
    const zg = new T.BufferGeometry(); zg.setAttribute("position", new T.BufferAttribute(new Float32Array(4 * 2 * 3), 3));
    const zoom = new T.LineSegments(zg, new T.LineBasicMaterial({ color: 0x0f8f6c, transparent: true, opacity: 0, depthWrite: false })); zoom.frustumCulled = false; zoom.renderOrder = 4; scene.add(zoom);
    P3 = { g, cv, tx, ctx: cv.getContext("2d"), kind: null, t0: 0, o: {}, target: new T.Vector3(), rot: 0, show: 0, zoom, holder: null, emerge: false };
  }
  // draw one app screen on the phone canvas (Joulity look)
  function drawScreen(kind, k, o) {
    const x = P3.ctx, W = 540, H = 1110;
    x.fillStyle = "#f4f5f7"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#111113"; x.font = "600 22px Inter,system-ui"; x.fillText("9:41", 34, 46); x.textAlign = "right"; x.fillText("NEAR ●", W - 34, 46); x.textAlign = "left";
    const card = (y, h) => { x.fillStyle = "#fff"; x.beginPath(); x.roundRect ? x.roundRect(28, y, W - 56, h, 26) : x.rect(28, y, W - 56, h); x.fill(); };
    const t = (s, X, Y, f, c = "#111113", al = "left") => { x.fillStyle = c; x.font = f; x.textAlign = al; x.fillText(s, X, Y); x.textAlign = "left"; };
    const row = (y, a, b, cb = "#111113") => { t(a, 56, y, "500 26px Inter,system-ui", "#5b6270"); t(b, W - 56, y, "700 26px Inter,system-ui", cb, "right"); };
    const bar = (y, f) => { x.fillStyle = "#eef1f5"; x.beginPath(); x.roundRect ? x.roundRect(56, y, W - 112, 22, 11) : x.rect(56, y, W - 112, 22); x.fill(); const g = x.createLinearGradient(56, 0, W - 56, 0); g.addColorStop(0, "#00A67E"); g.addColorStop(1, "#2F6FE4"); x.fillStyle = g; x.beginPath(); x.roundRect ? x.roundRect(56, y, Math.max(22, (W - 112) * f), 22, 11) : x.rect(56, y, (W - 112) * f, 22); x.fill(); };
    t("Joulity", 34, 110, "800 40px Inter,system-ui");
    const tapAt = []; // [x, y, k] where a finger taps
    const enter = ease(Math.min(1, k * 5)); x.save(); x.globalAlpha = 0.25 + 0.75 * enter; x.translate(0, 70 * (1 - enter));
    if (kind === "new") {
      t("New group", 34, 168, "600 26px Inter,system-ui", "#5b6270");
      card(196, 300); { const nm = "Tokyo trip", n = Math.min(nm.length, Math.floor(k * 4.2 * nm.length)); t("✈️  " + nm.slice(0, n) + (n < nm.length && Math.floor(k * 30) % 2 ? "|" : ""), 56, 262, "800 38px Inter,system-ui"); } row(322, "Goal", "$3,000"); row(372, "Date", "Next summer"); row(422, "Members", "invite by link"); row(472, "", "");
      card(520, 360); t("Rules · chosen once", 56, 576, "800 28px Inter,system-ui");
      const opt = (y, title, sub, on) => { x.strokeStyle = on ? "#00A67E" : "#e5e7eb"; x.lineWidth = 4; x.beginPath(); x.roundRect ? x.roundRect(48, y, W - 96, 120, 20) : x.rect(48, y, W - 96, 120); x.stroke(); t(title, 76, y + 50, "700 27px Inter,system-ui"); t(sub, 76, y + 90, "500 21px Inter,system-ui", "#5b6270"); if (on) t("✓", W - 80, y + 70, "800 34px Inter,system-ui", "#00A67E", "right"); };
      opt(600, "Free pocket", "everyone takes back their share", false); opt(738, "Locked goal", "75% to pay out · 50% to leave", k > 0.35); tapAt.push([W - 120, 800, 0.33], [W / 2, 965, 0.72]);
      x.fillStyle = k > 0.75 ? "#111113" : "#9aa1ab"; x.beginPath(); x.roundRect ? x.roundRect(28, 920, W - 56, 90, 24) : x.rect(28, 920, W - 56, 90); x.fill(); t(k > 0.75 ? "✓ Group created · link copied" : "Create group", W / 2, 976, "700 28px Inter,system-ui", "#fff", "center");
    } else if (kind === "join") {
      t("Invite", 34, 168, "600 26px Inter,system-ui", "#5b6270");
      card(196, 230); t("Adam invited you to", 56, 252, "500 26px Inter,system-ui", "#5b6270"); t("✈️  Tokyo trip", 56, 312, "800 40px Inter,system-ui"); t("Locked goal · $3,000", 56, 372, "600 26px Inter,system-ui", "#2F6FE4");
      card(452, 330); t("The rules", 56, 506, "800 28px Inter,system-ui"); ["Money stays until the goal", "Pay out: 75% yes", "Leave early: more than 50% yes", "Joining is free"].forEach((r, i) => t("•  " + r, 56, 560 + i * 52, "500 25px Inter,system-ui", "#111113"));
      x.fillStyle = k > 0.5 ? "#00A67E" : "#111113"; x.beginPath(); x.roundRect ? x.roundRect(28, 820, W - 56, 90, 24) : x.rect(28, 820, W - 56, 90); x.fill(); t(k > 0.5 ? "✓ Rules accepted · joined" : "I accept the rules · Join", W / 2, 876, "700 28px Inter,system-ui", "#fff", "center"); tapAt.push([W / 2, 865, 0.47]);
    } else if (kind === "chains") {
      t("Tokyo trip", 34, 168, "600 26px Inter,system-ui", "#5b6270");
      const landed = CHAINS.reduce((a, c, i) => a + (k > CHAIN_AT[i] ? c[5] : 0), 0); P3.pot = P3.pot == null ? 0 : P3.pot + (landed - P3.pot) * 0.25;
      const f = (o.from || 0.12) + P3.pot / 3000;
      card(196, 250); t("$" + Math.round(3000 * f).toLocaleString(), 56, 290, "800 64px Inter,system-ui"); t("of $3,000 saved together", 56, 340, "500 25px Inter,system-ui", "#5b6270"); bar(380, f);
      card(466, 560); t("Added from 6 networks", 56, 518, "800 28px Inter,system-ui");
      CHAINS.forEach(([sym, chain, tok, col, who, amt], i) => {
        const y = 548 + i * 70, on = k > CHAIN_AT[i], pop = on ? Math.min(1, (k - CHAIN_AT[i]) * 12) : 0; x.globalAlpha = on ? 0.4 + 0.6 * pop : 0.18;
        x.fillStyle = col; x.beginPath(); x.arc(80, y + 22, 21 * (on ? 0.8 + 0.2 * pop : 1), 0, 7); x.fill(); t(sym, 80, y + 30, "800 " + (sym.length > 3 ? 13 : 16) + "px Inter,system-ui", "#fff", "center");
        t(who + " · " + tok, 116, y + 18, "700 23px Inter,system-ui"); t("from " + chain, 116, y + 44, "500 19px Inter,system-ui", "#5b6270");
        t(on ? "+$" + amt : "…", W - 56, y + 30, "700 25px Inter,system-ui", "#00A67E", "right"); x.globalAlpha = 1;
      });
      x.fillStyle = "#eaf7f2"; x.beginPath(); x.roundRect ? x.roundRect(28, 1040, W - 56, 52, 18) : x.rect(28, 1040, W - 56, 52); x.fill();
      t("⚡ Swapped to USDC by NEAR Intents · ~2 s", W / 2, 1074, "600 21px Inter,system-ui", "#00805f", "center");
    } else if (kind === "earn") {
      const f = 0.62 + 0.38 * ease(k);
      t("Tokyo trip", 34, 168, "600 26px Inter,system-ui", "#5b6270");
      card(196, 250); t("$" + Math.round(3000 * f).toLocaleString(), 56, 290, "800 64px Inter,system-ui"); t("of $3,000", 56, 340, "500 25px Inter,system-ui", "#5b6270"); bar(380, f);
      card(466, 610); t("Earning while you wait", 56, 520, "800 28px Inter,system-ui"); t(o.apy || "~10%", 56, 610, "800 84px Inter,system-ui", "#00A67E"); t("a year on invested money", 56, 652, "500 23px Inter,system-ui", "#5b6270");
      t("≈ $" + Math.round(3000 * (o.apyN || 0.1) / 12) + " a month on $3,000", 56, 692, "600 23px Inter,system-ui", "#2F6FE4");
      t("Live Joulity vault · " + (o.vault || "…"), 56, 750, "700 23px Inter,system-ui");
      (o.split || []).forEach(([n, v, sh, r, col], i) => { const y = 778 + i * 86, kk = Math.min(1, Math.max(0, k * 1.6 - i * 0.2));
        t(n, 56, y + 28, "700 23px Inter,system-ui"); t(r, W - 56, y + 28, "600 21px Inter,system-ui", "#5b6270", "right");
        x.fillStyle = "#eef1f5"; x.beginPath(); x.roundRect ? x.roundRect(56, y + 42, W - 112, 16, 8) : x.rect(56, y + 42, W - 112, 16); x.fill();
        x.fillStyle = col; x.beginPath(); x.roundRect ? x.roundRect(56, y + 42, Math.max(16, (W - 112) * sh * kk), 16, 8) : x.rect(56, y + 42, (W - 112) * sh * kk, 16); x.fill();
        t(Math.round(sh * 100) + "% · " + v, 56, y + 82, "500 19px Inter,system-ui", "#5b6270"); });
    } else if (kind === "goal") {
      t("Tokyo trip", 34, 168, "600 26px Inter,system-ui", "#5b6270");
      card(196, 330); t("🎉", W / 2, 300, "80px Inter,system-ui", "#111113", "center"); t("Goal reached", W / 2, 380, "800 46px Inter,system-ui", "#111113", "center"); t("$3,000 saved together", W / 2, 432, "600 26px Inter,system-ui", "#5b6270", "center"); bar(470, 1);
      card(552, 260); t("Pay out to Adam (organiser)", 56, 608, "700 26px Inter,system-ui"); t("Votes: 100% yes · needs 75%", 56, 656, "500 24px Inter,system-ui", "#5b6270"); bar(690, Math.min(1, k * 1.3));
      x.fillStyle = k > 0.6 ? "#00A67E" : "#111113"; x.beginPath(); x.roundRect ? x.roundRect(28, 860, W - 56, 90, 24) : x.rect(28, 860, W - 56, 90); x.fill(); t(k > 0.6 ? "✈️  Paid out · Tokyo, here we come" : "Vote yes · pay out", W / 2, 916, "700 28px Inter,system-ui", "#fff", "center"); tapAt.push([W / 2, 905, 0.55]);
    }
    x.restore();
    // the finger: a soft dot that presses, then a ring that spreads
    for (const [X, Y, at] of tapAt) { const d = k - at; if (d < -0.12 || d > 0.14) continue;
      const press = d < 0 ? 1 + d / 0.12 : 1; x.fillStyle = "rgba(17,17,19," + (0.22 * press * (d > 0.06 ? Math.max(0, 1 - (d - 0.06) / 0.08) : 1)) + ")"; x.beginPath(); x.arc(X, Y, 34 - 6 * press, 0, 7); x.fill();
      if (d > 0) { x.strokeStyle = "rgba(0,166,126," + Math.max(0, 1 - d / 0.14) + ")"; x.lineWidth = 5; x.beginPath(); x.arc(X, Y, 30 + d * 600, 0, 7); x.stroke(); } }
    P3.tx.needsUpdate = true;
  }
  const CHAINS = [["ETH", "Ethereum", "ETH", "#627EEA", "Adam", 300], ["BASE", "Base", "USDC", "#0052FF", "Sami", 250], ["SOL", "Solana", "SOL", "#9945FF", "Sami", 400], ["ARB", "Arbitrum", "USDT", "#28A0F0", "Adam", 200], ["BTC", "Bitcoin", "BTC", "#F7931A", "Adam", 150], ["NEAR", "NEAR", "NEAR", "#00C08B", "Sami", 200]];
  const SPAN4 = 6.6, ARRIVE = CHAINS.map((_, i) => 1.5 + i * 0.75), CHAIN_AT = ARRIVE.map((a) => a / SPAN4);
  function coinTex(sym, col, sub) {
    const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d");
    x.fillStyle = "rgba(0,0,0,0.18)"; x.beginPath(); x.arc(128, 136, 112, 0, 7); x.fill();
    const g = x.createRadialGradient(100, 90, 10, 128, 128, 120); g.addColorStop(0, "#ffffff"); g.addColorStop(0.18, col); g.addColorStop(1, col); x.fillStyle = g; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.85)"; x.lineWidth = 8; x.beginPath(); x.arc(128, 128, 100, 0, 7); x.stroke();
    x.fillStyle = "#fff"; x.textAlign = "center"; x.font = "800 " + (sym.length > 3 ? 54 : 66) + "px Inter,system-ui"; x.fillText(sym, 128, sub ? 136 : 150); if (sub) { x.font = "700 30px Inter,system-ui"; x.fillText(sub, 128, 178); }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  }
  const flights = [];
  function coin(sym, col, sub, from, to, t0, dur, size = 0.2) {
    const sp = new T.Sprite(new T.SpriteMaterial({ map: coinTex(sym, col, sub), transparent: true, depthWrite: false })); sp.scale.setScalar(size); sp.visible = false; sp.renderOrder = 5; scene.add(sp);
    flights.push({ sp, from: new T.Vector3(...from), to: to, t0, dur, size });
  }
  function clearFlights() { flights.splice(0).forEach((f) => { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); }); }
  const fv = new T.Vector3();
  function flyTick() {
    for (const f of flights) {
      const u = (st - f.t0) / f.dur; f.sp.visible = u >= 0 && u <= 1; if (!f.sp.visible) continue;
      const to = typeof f.to === "function" ? f.to() : f.to, e = ease(u);
      fv.copy(f.from).lerp(to, e); fv.y += Math.sin(Math.PI * u) * 0.45; f.sp.position.copy(fv);
      f.sp.scale.setScalar(f.size * (u < 0.12 ? u / 0.12 : u > 0.85 ? Math.max(0.05, (1 - u) / 0.15) : 1));
      f.sp.material.rotation = Math.sin(st * 3 + f.t0) * 0.25;
    }
  }
  const phoneAt = () => P3.g.position;
  // the Joulity vault: a white base and one column per place the money sits, height = share (live numbers)
  let VAULT3 = null;
  function label(lines, w = 512, h = 160) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
    x.fillStyle = "rgba(255,255,255,0.96)"; x.beginPath(); x.roundRect ? x.roundRect(4, 4, w - 8, h - 8, 28) : x.rect(4, 4, w - 8, h - 8); x.fill(); x.strokeStyle = "rgba(17,17,19,0.08)"; x.lineWidth = 3; x.stroke();
    lines.forEach(([txt, f, col], i) => { x.fillStyle = col || "#111113"; x.font = f; x.textAlign = "center"; x.fillText(txt, w / 2, 62 + i * 58); });
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; const sp = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); sp.scale.set(w / 1000, h / 1000, 1); sp.renderOrder = 6; return sp;
  }
  function vaultShow(o) {
    vaultHide();
    const g = new T.Group(), base = new T.Mesh(new T.BoxGeometry(1.4, 0.08, 0.5), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })); base.castShadow = base.receiveShadow = true; g.add(base);
    const cols = (o.split || []).map(([n, v, sh, r, col], i) => {
      const m = new T.Mesh(new T.BoxGeometry(0.26, 1, 0.26), new T.MeshStandardMaterial({ color: new T.Color(col), roughness: 0.35, metalness: 0.1 })); m.castShadow = true;
      const X = -0.46 + i * 0.46; m.position.set(X, 0.04, 0); m.scale.y = 0.001; g.add(m);
      const lb = label([[n, "800 44px Inter,system-ui"], [Math.round(sh * 100) + "% · " + r, "600 32px Inter,system-ui", "#5b6270"]], 400, 140); g.add(lb); lb.scale.multiplyScalar(1.3);
      return { m, lb, X, h: 0.12 + 0.7 * sh };
    });
    const title = label([["Joulity vault", "800 46px Inter,system-ui"], [(o.vault || "") + " live on NEAR", "600 34px Inter,system-ui", "#00805f"]], 520, 150); title.scale.multiplyScalar(1.5); g.add(title);
    g.position.set(...o.at); g.rotation.y = o.ry || 0; scene.add(g); VAULT3 = { g, cols, title, t0: st };
  }
  function vaultTick() {
    if (!VAULT3) return; const k = ease(Math.min(1, (st - VAULT3.t0 - 0.6) / 2.6));
    let top = 0; VAULT3.cols.forEach((c) => { const h = Math.max(0.001, c.h * k); c.m.scale.y = h; c.m.position.y = 0.04 + h / 2; c.lb.position.set(c.X, 0.04 + h + 0.13, 0.15); c.lb.material.opacity = k; top = Math.max(top, h); });
    VAULT3.title.position.set(0, 0.04 + top + 0.5, 0); VAULT3.title.material.opacity = Math.min(1, k * 2);
  }
  // ---- goal reached: a halo ring fills to 100%, pulses, light particles rise, a warm spot on the two friends
  let CEL = null;
  function glowTex(col) { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, col); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new T.CanvasTexture(c); return t; }
  function celebShow() {
    celebHide();
    const g = new T.Group(); g.position.set(0.05, 1.1, -0.95); scene.add(g);
    const cv = document.createElement("canvas"); cv.width = cv.height = 1024; const tx = new T.CanvasTexture(cv); tx.encoding = T.sRGBEncoding;
    const pill = new T.Sprite(new T.SpriteMaterial({ transparent: true, depthWrite: false })); pill.renderOrder = 8; pill.position.set(0, 1.4, 0.1); g.add(pill);
    const ring = new T.Mesh(new T.PlaneGeometry(2.4, 2.4), new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, toneMapped: false })); g.add(ring);
    const spot = new T.SpotLight(0xffe7c2, 0, 9, 0.5, 0.6, 1.2); spot.position.set(0.3, 4.2, 2.2); spot.target.position.set(0, 0.9, 0.05); spot.castShadow = false; scene.add(spot, spot.target);
    const parts = [], cols = ["rgba(0,200,150,0.9)", "rgba(242,193,78,0.9)", "rgba(120,170,255,0.9)", "rgba(255,255,255,0.9)"], texs = cols.map(glowTex);
    for (let i = 0; i < 70; i++) { const sp = new T.Sprite(new T.SpriteMaterial({ map: texs[i % 4], transparent: true, depthWrite: false, blending: T.AdditiveBlending })); const a = Math.random() * Math.PI * 2;
      sp.userData = { a, r: 1.1 + Math.random() * 0.25, v: 0.25 + Math.random() * 0.45, d: Math.random() * 1.5, s: 0.04 + Math.random() * 0.07, w: Math.random() * 6 }; sp.visible = false; sp.renderOrder = 7; scene.add(sp); parts.push(sp); }
    CEL = { g, cv, ctx: cv.getContext("2d"), tx, spot, parts, pill, pk: "", t0: st };
  }
  function celebTick() {
    if (!CEL) return; const u = st - CEL.t0, x = CEL.ctx, f = 0.86 + 0.14 * ease(Math.min(1, (u - 0.3) / 1.6)), done = u > 1.9, pulse = done ? Math.max(0, 1 - (u - 1.9) / 0.9) : 0;
    x.clearRect(0, 0, 1024, 1024); const C = 512, R = 440;
    const halo = x.createRadialGradient(C, C, R - 120, C, C, R + 90); halo.addColorStop(0, "rgba(0,166,126,0)"); halo.addColorStop(0.55, "rgba(0,166,126," + (0.10 + 0.25 * pulse + (done ? 0.08 : 0)) + ")"); halo.addColorStop(1, "rgba(0,166,126,0)"); x.fillStyle = halo; x.fillRect(0, 0, 1024, 1024);
    x.lineCap = "round"; x.lineWidth = 34; x.strokeStyle = "rgba(17,17,19,0.07)"; x.beginPath(); x.arc(C, C, R, 0, Math.PI * 2); x.stroke();
    const gr = x.createLinearGradient(0, 0, 1024, 1024); gr.addColorStop(0, "#00C08B"); gr.addColorStop(0.6, "#2F6FE4"); gr.addColorStop(1, "#F2C14E"); x.strokeStyle = gr; x.lineWidth = 34 + 14 * pulse; x.beginPath(); x.arc(C, C, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); x.stroke();
    const ex = C + R * Math.cos(-Math.PI / 2 + Math.PI * 2 * f), ey = C + R * Math.sin(-Math.PI / 2 + Math.PI * 2 * f); x.fillStyle = "#fff"; x.beginPath(); x.arc(ex, ey, 20, 0, 7); x.fill();
    const pk = (done ? "Goal reached" : Math.round(f * 100) + "%") + "|$" + Math.round(3000 * f).toLocaleString() + " of $3,000";
    if (pk !== CEL.pk) { CEL.pk = pk; const [a, b] = pk.split("|"), c = document.createElement("canvas"); c.width = 560; c.height = 150; const y = c.getContext("2d");
      y.fillStyle = done ? "#0f8f6c" : "#ffffff"; y.beginPath(); y.roundRect ? y.roundRect(4, 4, 552, 142, 71) : y.rect(4, 4, 552, 142); y.fill();
      y.textAlign = "center"; y.fillStyle = done ? "#ffffff" : "#111113"; y.font = "800 52px Inter,system-ui"; y.fillText((done ? "✓ " : "") + a, 280, 68); y.font = "600 34px Inter,system-ui"; y.fillStyle = done ? "rgba(255,255,255,0.85)" : "#5b6270"; y.fillText(b, 280, 114);
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; if (CEL.pill.material.map) CEL.pill.material.map.dispose(); CEL.pill.material.map = t; CEL.pill.material.needsUpdate = true; CEL.pill.scale.set(1.15, 0.31, 1); }
    CEL.tx.needsUpdate = true; CEL.g.scale.setScalar(1 + 0.04 * pulse);
    CEL.spot.intensity = Math.min(1.6, u * 1.2);
    for (const p of CEL.parts) { const d = p.userData, tt = u - 1.9 - d.d * 0.6; p.visible = tt > 0 && !reduce; if (!p.visible) continue; const life = (tt * d.v) % 2.2;
      const rr = d.r + life * 0.35; p.position.set(CEL.g.position.x + Math.cos(d.a) * rr + Math.sin(u + d.w) * 0.05, CEL.g.position.y + Math.sin(d.a) * rr * 0.9 + life * 0.55, CEL.g.position.z + 0.15);
      p.scale.setScalar(d.s * (1 - life / 2.2) * (tt < 0.3 ? tt / 0.3 : 1)); p.material.opacity = 1 - life / 2.2; }
  }
  function celebHide() { if (!CEL) return; scene.remove(CEL.g, CEL.spot, CEL.spot.target); CEL.parts.forEach((p) => scene.remove(p)); CEL = null; }
  function vaultHide() { if (VAULT3) { scene.remove(VAULT3.g); VAULT3 = null; } }
  function phoneShow(kind, at, opts = {}) {
    P3.pot = null; P3.kind = kind; P3.o = opts; P3.t0 = st; P3.target.set(...at); P3.rot = opts.rot ?? -0.25; P3.g.visible = true; P3.g.position.copy(P3.target);
    // the big phone is a zoom of the phone in someone's hand: it grows out of it
    P3.holder = (opts.holder && actors[opts.holder]) || Object.values(actors).find((a) => a.g.visible && a.phone.visible) || null;
    P3.emerge = !!P3.holder; P3.show = P3.holder ? 0.02 : 0.3;
  }
  function phoneHide() { P3.kind = null; P3.holder = null; }

  // ---------- set ----------
  let SET = null;
  function buildSet() {
    const cv = document.createElement("canvas"); cv.width = 4; cv.height = 256; const x = cv.getContext("2d"), gr = x.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, "#f3ede4"); gr.addColorStop(0.65, "#efe8de"); gr.addColorStop(1, "#e6ddd1"); x.fillStyle = gr; x.fillRect(0, 0, 4, 256);
    scene.background = new T.CanvasTexture(cv); scene.fog = new T.Fog(0xefe8de, 14, 40);
    const floor = new T.Mesh(new T.CircleGeometry(40, 64), new T.MeshStandardMaterial({ color: 0xe9e1d6, roughness: 0.95 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const rug = new T.Mesh(new T.CircleGeometry(2.4, 64), new T.MeshStandardMaterial({ color: 0xd8cbb8, roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(-0.6, 0.005, 0.6); rug.receiveShadow = true; scene.add(rug);
    const sofa = new T.Group(); sofa.position.set(-1.5, 0, -0.55); scene.add(sofa);
    const fab = new T.MeshStandardMaterial({ color: 0x6b8f86, roughness: 0.95 }), wood = new T.MeshStandardMaterial({ color: 0x3b2f27, roughness: 0.6 });
    const bx = (p, w, h, d, m, X, Y, Z) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(X, Y, Z); b.castShadow = b.receiveShadow = true; p.add(b); return b; };
    bx(sofa, 2.3, 0.25, 0.9, fab, 0, 0.32, 0); bx(sofa, 2.3, 0.6, 0.22, fab, 0, 0.62, -0.38); bx(sofa, 0.22, 0.45, 0.9, fab, -1.15, 0.45, 0); bx(sofa, 0.22, 0.45, 0.9, fab, 1.15, 0.45, 0);
    bx(sofa, 1.05, 0.14, 0.75, fab, -0.55, 0.5, 0.05); bx(sofa, 1.05, 0.14, 0.75, fab, 0.55, 0.5, 0.05);
    for (const [X, Z] of [[-1.05, -0.35], [1.05, -0.35], [-1.05, 0.35], [1.05, 0.35]]) bx(sofa, 0.06, 0.2, 0.06, wood, X, 0.1, Z);
    // a low table with a travel book and a mug
    const table = new T.Group(); table.position.set(-1.5, 0, 0.75); scene.add(table);
    bx(table, 1.1, 0.05, 0.55, wood, 0, 0.38, 0); for (const [X, Z] of [[-0.48, -0.22], [0.48, -0.22], [-0.48, 0.22], [0.48, 0.22]]) bx(table, 0.04, 0.36, 0.04, wood, X, 0.18, Z);
    bx(table, 0.3, 0.04, 0.22, new T.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 }), -0.2, 0.425, 0.02);
    const mug = new T.Mesh(new T.CylinderGeometry(0.045, 0.04, 0.1, 20), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })); mug.position.set(0.25, 0.46, 0.05); mug.castShadow = true; table.add(mug);
    // plant, lamp, window, wall, a framed poster of Tokyo
    const pot = new T.Mesh(new T.CylinderGeometry(0.22, 0.18, 0.45, 24), new T.MeshStandardMaterial({ color: 0xc9b8a3, roughness: 0.8 })); pot.position.set(-3.2, 0.22, -0.7); pot.castShadow = true; scene.add(pot);
    for (let i = 0; i < 9; i++) { const lf = new T.Mesh(new T.SphereGeometry(0.28, 12, 10), new T.MeshStandardMaterial({ color: 0x4f7a5a, roughness: 0.9 })); lf.scale.set(0.5, 1.2, 0.5); lf.position.set(-3.2 + Math.sin(i * 2.1) * 0.22, 0.75 + (i % 3) * 0.22, -0.7 + Math.cos(i * 2.1) * 0.22); lf.rotation.z = Math.sin(i) * 0.5; lf.castShadow = true; scene.add(lf); }
    const lamp = new T.Group(); lamp.position.set(0.3, 0, -1.3); scene.add(lamp);
    const pole = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 1.6, 8), wood); pole.position.y = 0.8; lamp.add(pole);
    const shade = new T.Mesh(new T.CylinderGeometry(0.18, 0.28, 0.3, 24, 1, true), new T.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffe2b0, emissiveIntensity: 0.6, side: T.DoubleSide })); shade.position.y = 1.65; lamp.add(shade);
    const bulb = new T.PointLight(0xffd9a0, 0.6, 4); bulb.position.y = 1.55; lamp.add(bulb);
    const win = new T.Mesh(new T.PlaneGeometry(2.6, 1.8), new T.MeshBasicMaterial({ color: 0xfff8ec })); win.position.set(1.8, 1.7, -2.6); scene.add(win);
    const wall = new T.Mesh(new T.PlaneGeometry(30, 8), new T.MeshStandardMaterial({ color: 0xf1ebe2, roughness: 1 })); wall.position.set(0, 4, -2.62); wall.receiveShadow = true; scene.add(wall);
    const pcv = document.createElement("canvas"); pcv.width = 360; pcv.height = 480; const px = pcv.getContext("2d"); const pg = px.createLinearGradient(0, 0, 0, 480); pg.addColorStop(0, "#fde2e4"); pg.addColorStop(1, "#f9b5ac"); px.fillStyle = pg; px.fillRect(0, 0, 360, 480);
    px.fillStyle = "#e63946"; px.beginPath(); px.arc(180, 170, 70, 0, 7); px.fill(); px.fillStyle = "#3d405b"; px.beginPath(); px.moveTo(40, 400); px.lineTo(180, 230); px.lineTo(320, 400); px.fill(); px.fillStyle = "#fff"; px.beginPath(); px.moveTo(140, 278); px.lineTo(180, 230); px.lineTo(220, 278); px.fill();
    px.fillStyle = "#3d405b"; px.font = "800 40px Inter,system-ui"; px.textAlign = "center"; px.fillText("TOKYO", 180, 450);
    const ptx = new T.CanvasTexture(pcv); ptx.encoding = T.sRGBEncoding;
    const poster = new T.Mesh(new T.PlaneGeometry(0.6, 0.8), new T.MeshStandardMaterial({ map: ptx, roughness: 0.9 })); poster.position.set(-2.55, 1.55, -2.59); scene.add(poster);
    const pf = new T.Mesh(new T.PlaneGeometry(0.66, 0.86), new T.MeshStandardMaterial({ color: 0x2b2b2b })); pf.position.set(-2.55, 1.55, -2.595); scene.add(pf);
    const conf = []; for (let i = 0; i < 110; i++) { const col = [0x00a67e, 0x2f6fe4, 0xf2c14e, 0xec4899][i % 4]; const c = new T.Mesh(new T.PlaneGeometry(0.05, 0.08), new T.MeshBasicMaterial({ color: col, side: T.DoubleSide })); c.userData = { x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 2 + 0.5, y0: 3 + Math.random() * 2, v: 0.5 + Math.random() * 0.6, s: Math.random() * 6 }; c.visible = false; scene.add(c); conf.push(c); }
    return { conf };
  }

  // ---------- the story: 7 scenes, each a different action, place and angle ----------
  const place = (a, x, z, ry = 0) => { a.g.position.set(x, 0, z); a.g.rotation.y = ry; a.walk = null; a.g.visible = true; };
  const walk = (a, to, dur, ry) => { a.walk = { from: a.g.position.clone(), to: new T.Vector3(to[0], 0, to[1]), t: 0, dur, ry }; a.play("Walking"); };
  const SEAT = [-1.55, -0.38], SEAT2 = [-0.95, -0.38];
  const vaultTxt = () => {
    const L = window.JD_LIVE || {}, f = (v) => "$" + Number(v || 0).toFixed(2), tot = (L.cash || 0) + (L.rhea || 0) + (L.pendle || 0) || 1;
    const split = L.total ? [["Pendle", f(L.pendle), L.pendle / tot, L.pendleR || "fixed", "#18C3B0"], ["Rhea", f(L.rhea), L.rhea / tot, L.rheaR || "lending", "#2F6FE4"], ["Cash", f(L.cash), L.cash / tot, "ready to pay", "#9aa1ab"]]
      : [["Pendle", "", 0.45, "fixed", "#18C3B0"], ["Rhea", "", 0.35, "lending", "#2F6FE4"], ["Cash", "", 0.2, "ready to pay", "#9aa1ab"]];
    return { apy: L.apy || "~10%", apyN: L.apyN || 0.1, vault: L.vault || "live", split };
  };
  const SCENES = [
    { // 1 the dream: sofa, push-in, thought bubble, the Tokyo poster behind
      dur: 6.5, cam: [[0.6, 1.5, 3.8], [-1.5, 1.05, -0.6], [-0.7, 1.3, 2.2], [-1.5, 1.1, -0.6]],
      enter: () => { place(actors.adam, ...SEAT, 0); actors.adam.play("SittingIdle", { fade: 0 }); actors.adam.phone.visible = false; actors.sami.g.visible = false; phoneHide(); },
      beats: [[0.5, () => caption("Meet Adam.")], [1.8, () => think("adam", "Tokyo, next summer… with my friends? ✈️")], [4.2, () => say("adam", "$3,000. Too much for me alone…")]],
    },
    { // 2 the idea: he stands, phone in hand; the app appears big beside him
      dur: 7, cam: [[2.6, 1.55, 2.9], [0.55, 1.15, 0], [1.9, 1.5, 2.4], [0.45, 1.2, 0]],
      enter: () => { place(actors.adam, -0.3, 0.3, 0.55); actors.adam.play("Idle"); actors.adam.phone.visible = false; actors.sami.g.visible = false; phoneShow("new", [0.75, 1.25, 0.55], { rot: -0.45 }); },
      beats: [[0.3, () => caption("Unless they save for it together.")], [2.8, () => say("adam", "A locked goal. Same rules for everyone.")], [5.0, () => caption("One group pocket. One link to share.")]],
    },
    { // 3 Sami arrives with the invite, accepts the rules, waves
      pf: ["sami", "phone"], dur: 7.5, cam: [[1.8, 1.6, 4.6], [1.2, 1.05, 0.3], [1.3, 1.55, 3.8], [1.1, 1.1, 0.3]],
      enter: () => { place(actors.adam, -0.3, 0.3, 0.55); actors.adam.play("Idle"); actors.adam.phone.visible = false; const s = actors.sami; place(s, 4.6, 1.4, -Math.PI / 2); s.phone.visible = false; walk(s, [1.4, 0.55], 3.4, -0.5); phoneShow("join", [2.35, 1.25, 0.9], { rot: -0.6 }); },
      beats: [[0.3, () => caption("Sami gets the link.")], [3.6, () => { actors.sami.play("Waving", { once: true }); actors.sami.phone.visible = false; say("sami", "Rules accepted. I'm in!"); }], [5.6, () => caption("Joining is free. Money comes later.")]],
    },
    { // 4 money from any chain: low angle, both on their phones, the jar of the app fills
      dur: 8, cam: [[-0.3, 1.05, 4.2], [0.55, 1.25, 0.0], [0.3, 1.1, 3.8], [0.55, 1.3, 0.0]],
      enter: () => { const a = actors.adam, s = actors.sami; place(a, -0.25, 0.35, 0.35); a.play("Idle"); a.phone.visible = false; place(s, 1.35, 0.5, -0.35); s.play("Idle", { at: 1.3 }); s.phone.visible = false; phoneShow("chains", [0.55, 1.25, 0.45], { rot: 0, from: 0.12, to: 0.62, span: SPAN4 });
        const FROM = [[-1.5, 2.0, 0.6], [2.4, 2.0, 0.6], [-1.6, 0.6, 0.8], [2.5, 0.6, 0.8], [-0.2, 2.15, 0.4], [1.4, 2.15, 0.4]];
        CHAINS.forEach(([sym, , tok, col], i) => coin(sym, col, tok, FROM[i], phoneAt, ARRIVE[i] - 1.25, 1.25, 0.34)); },
      leave: clearFlights,
      beats: [[0.3, () => caption("Each one adds money. From any chain, any token.")], [3.0, () => say("sami", "SOL from Solana. Arrived in seconds.")], [5.2, () => say("adam", "ETH, BTC, USDT… same pocket.")]],
    },
    { // 5 it earns: they relax on the sofa, high camera, the app shows the live yield
      pf: ["phone", "vault"], dur: 8, cam: [[-2.3, 2.4, 3.9], [-0.15, 1.0, 0.0], [-1.9, 2.2, 3.6], [-0.15, 1.05, 0.0]],
      enter: () => { const a = actors.adam, s = actors.sami; place(a, ...SEAT, 0); a.phone.visible = false; a.play("SittingThumbsUp", { once: true }); place(s, ...SEAT2, 0); s.phone.visible = false; s.play("SittingIdle"); const V = vaultTxt(); phoneShow("earn", [-0.35, 1.2, 0.55], { rot: -0.4, span: 5, ...V }); vaultShow({ ...V, at: [0.95, 0.42, 0.55], ry: -0.8 });
        for (let i = 0; i < 6; i++) coin("USDC", "#2775CA", "", [-0.35, 1.2, 0.55], () => VAULT3 ? VAULT3.g.position.clone().add(new T.Vector3(0, 0.5, 0)) : phoneAt(), 0.5 + i * 0.45, 1.1, 0.22); },
      leave: () => { clearFlights(); vaultHide(); },
      beats: [[0.3, () => caption("While they wait, the pocket earns.")], [2.6, () => caption("It works in the Joulity vault: real strategies, live on NEAR.")], [5.2, () => say("adam", "Even waiting, it grows.")]],
    },
    { // 6 goal reached: standing, clapping, confetti, orbiting camera
      pf: ["ring"], dur: 7.5, cam: [[-0.2, 1.1, 5.3], [0.35, 1.3, -0.3], [0.5, 1.2, 4.7], [0.45, 1.3, -0.3]],
      enter: () => { const a = actors.adam, s = actors.sami; place(a, -0.45, 0.35, 0.25); a.play("Clapping"); a.phone.visible = false; place(s, 0.5, 0.35, -0.25); s.play("Clapping"); s.phone.visible = false; phoneShow("goal", [1.75, 1.3, 0.1], { rot: -0.3, span: 5 }); celebShow(); },
      beats: [[0.3, () => caption("Goal reached. Tokyo, together.")], [2.4, () => say("adam", "We did it!")], [4.2, () => say("sami", "Pack your bags 🎉")]],
      leave: () => { confetti(false); celebHide(); },
    },
    { // 7 the end: they wave, camera pulls back, the call to action
      dur: 6, cam: [[0.2, 1.5, 3.4], [0, 1.15, 0], [0.2, 2.1, 6.8], [0, 1.2, 0]],
      enter: () => { const a = actors.adam, s = actors.sami; place(a, -0.5, 0.3, 0.2); a.play("Waving", { once: true }); a.phone.visible = false; place(s, 0.55, 0.3, -0.2); s.play("Waving", { once: true, speed: 0.93 }); s.phone.visible = false; phoneHide(); },
      beats: [[1.2, () => card("cta")]],
    },
  ];
  let si = -1, st = 0, fired = 0, conf = false, snap = true;
  function confetti(on) { conf = on; SET.conf.forEach((c) => (c.visible = on && !reduce)); }

  // ---------- overlay: comic captions and speech bubbles (DOM) ----------
  let bubbles = [];
  function clearUI() { ui.caption.classList.remove("on"); ui.cards.innerHTML = ""; bubbles.forEach((b) => b.el.remove()); bubbles = []; }
  function caption(text) { ui.caption.textContent = text; ui.caption.classList.remove("on"); void ui.caption.offsetWidth; ui.caption.classList.add("on"); }
  function bubble(key, text, kind) { bubbles.forEach((b) => b.el.classList.remove("on")); const old = bubbles; setTimeout(() => old.forEach((b) => b.el.remove()), 300); bubbles = []; const d = document.createElement("div"); d.className = "bub " + kind; d.innerHTML = `<b>${CAST[key].name}</b><span></span>`; d.querySelector("span").textContent = text; ui.layer.appendChild(d); requestAnimationFrame(() => d.classList.add("on")); bubbles.push({ key, el: d }); }
  const say = (k, t) => { if (actors[k]) actors[k].talkAt = st; return bubble(k, t, "say"); }, think = (k, t) => bubble(k, t, "think");
  function card(kind, o = {}) { window.FilmCards?.(ui.cards, kind, o); }
  const v = new T.Vector3(), v2 = new T.Vector3();
  function phoneRect(w, h) { // screen-space box of the 3D phone
    const xs = [], ys = []; for (const [cx, cy] of [[-0.22, -0.44], [0.22, -0.44], [-0.22, 0.44], [0.22, 0.44]]) { v2.set(cx, cy, 0).applyMatrix4(P3.g.matrixWorld).project(cam); xs.push(((v2.x + 1) / 2) * w); ys.push(((1 - v2.y) / 2) * h); }
    return [Math.min(...xs) - 8, Math.min(...ys) - 8, Math.max(...xs) + 8, Math.max(...ys) + 8];
  }
  function placeBubbles() {
    const w = el.clientWidth, h = el.clientHeight;
    for (const b of bubbles) {
      const a = actors[b.key]; if (!a?.head) continue;
      a.head.getWorldPosition(v); v.y += 0.3; v.project(cam);
      let x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
      const bw = b.el.offsetWidth || 220, bh = b.el.offsetHeight || 60;
      const capB = ui.caption.classList.contains("on") ? ui.caption.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 12 : 80;
      y = Math.max(bh + capB, y);
      let sx = -0.2; // bubble normally to the right of the head
      if (P3 && P3.g.visible && P3.show > 0.3) { // flip to the left side when it would cover the 3D phone
        const pr = phoneRect(w, h); if (pr && x - 0.2 * bw < pr[2] && x + 0.8 * bw > pr[0] && y - bh < pr[3] && y > pr[1]) sx = x - bw - 10 > 8 ? -1.02 : -0.2;
      }
      x = Math.max(12 - sx * bw, Math.min(w - (1 + sx) * bw - 12, x));
      b.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(${sx * 100}%, -100%)`;
    }
  }

  // ---------- control ----------
  function go(i) {
    i = Math.max(0, Math.min(SCENES.length - 1, i)); if (i === si || !ready) return;
    SCENES[si]?.leave?.(); si = i; st = 0; fired = 0; snap = true; clearUI();
    INSTANT = true; for (const a of Object.values(actors)) a.cur = null; SCENES[si].enter(); INSTANT = false; for (const a of Object.values(actors)) a.mixer.update(0); onScene?.(si, SCENES.length);
  }
  const lerpV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const camPos = new T.Vector3(), camTgt = new T.Vector3();
  // Mixamo clips are retargeted rotation-only, so on our characters the clapping hands miss each other:
  // turn each upper arm so its hand moves toward the middle by the clip's smallest gap (hands meet at the clap).
  const w1 = new T.Vector3(), w2 = new T.Vector3(), w3 = new T.Vector3(), mid = new T.Vector3(), qa = new T.Quaternion(), qb = new T.Quaternion(), qc = new T.Quaternion();
  function aim(arm, hand, target) {
    arm.getWorldPosition(w1); hand.getWorldPosition(w2);
    const d0 = w2.sub(w1).normalize(), d1 = w3.copy(target).sub(w1).normalize();
    qa.setFromUnitVectors(d0, d1); arm.getWorldQuaternion(qb); arm.parent.getWorldQuaternion(qc);
    arm.quaternion.copy(qc.invert().multiply(qa.multiply(qb))); arm.updateMatrixWorld(true);
  }
  // standing idle: both arms hang relaxed at the sides (upper arm down, forearm slightly forward)
  function armsDown(a, gs = 0, gk = 0) {
    for (const [arm, hand, sx] of [[a.larm, a.lhand, 1], [a.rarm, a.rhand, -1]]) {
      const g = sx === gs ? gk : 0;
      if (!arm || !hand) continue; const fore = arm.children.find((c) => /ForeArm/.test(c.name)); if (!fore) continue;
      const S = arm.getWorldPosition(new T.Vector3()), up = S.distanceTo(fore.getWorldPosition(new T.Vector3()));
      aim(arm, fore, S.clone().add(new T.Vector3(sx * (0.07 + 0.08 * g), -up * (1 - 0.25 * g), -0.01 + 0.12 * g).applyQuaternion(a.g.quaternion)));
      const E = fore.getWorldPosition(new T.Vector3()), lo = E.distanceTo(hand.getWorldPosition(new T.Vector3()));
      aim(fore, hand, E.clone().add(new T.Vector3(sx * (0.02 + 0.55 * lo * g), -lo * (0.97 - 0.9 * g), lo * (0.22 + 0.55 * g)).applyQuaternion(a.g.quaternion)));
    }
  }
  // standing idle that feels alive: soft sway, looks at the big phone and back to us, presents it while talking, nods
  const lv = new T.Vector3(), lq = new T.Quaternion();
  function idleLife(a, dt) {
    if (!a.sp1) { a.sp1 = a.o.getObjectByName("mixamorigSpine1"); a.sp0 = a.o.getObjectByName("mixamorigSpine"); a.lookK = 0; }
    const ic = a.clips.Idle;
    if (ic) for (const b of [a.sp0, a.sp1, a.head, a.larm, a.rarm, a.larm && a.larm.children.find((c) => /ForeArm/.test(c.name)), a.rarm && a.rarm.children.find((c) => /ForeArm/.test(c.name))]) {
      if (!b) continue; const tr = ic.tracks.find((x) => x.name === b.name + ".quaternion"); if (tr) b.quaternion.fromArray(tr.values, 0);
    }
    a.o.updateMatrixWorld(true);
    const t = st + (a.key === "sami" ? 1.7 : 0), talk = a.talkAt != null ? st - a.talkAt : 99;
    const gk = talk >= 0 && talk < 2.6 ? Math.sin(Math.min(1, talk / 2.6) * Math.PI) ** 0.6 : 0;
    // where is the big phone, in the actor's own frame (+x = his left)
    let side = 0, yaw = 0;
    if (P3 && P3.kind && P3.g.visible) { a.head.getWorldPosition(lv); lv.subVectors(P3.g.position, lv); lq.copy(a.g.quaternion).invert(); lv.applyQuaternion(lq); side = lv.x > 0 ? 1 : -1; yaw = Math.max(-0.75, Math.min(0.75, Math.atan2(lv.x, lv.z))); }
    const wantLook = side && (gk > 0.2 || Math.sin(t * 0.55) > 0.15) ? 1 : 0; a.lookK += (wantLook - a.lookK) * Math.min(1, dt * 3);
    armsDown(a, side, gk);
    if (a.sp0) a.sp0.rotateZ(Math.sin(t * 0.7) * 0.025);
    if (a.sp1) { a.sp1.rotateY(Math.sin(t * 0.45) * 0.05 + yaw * 0.15 * a.lookK); a.sp1.rotateX(0.03 * Math.sin(t * 1.3)); }
    a.head.rotateY(yaw * 0.55 * a.lookK + Math.sin(t * 0.8) * 0.04);
    a.head.rotateX(Math.sin(t * 1.1) * 0.03 + (talk >= 0 && talk < 2.2 ? Math.sin(talk * 7) * 0.06 * gk : 0) + 0.06 * a.lookK);
    a.o.updateMatrixWorld(true);
  }
  function clapFix(a) {
    if (!a.larm || !a.rarm) return;
    const L = a.lhand.getWorldPosition(new T.Vector3()), Rh = a.rhand.getWorldPosition(new T.Vector3());
    
    if (a.clapMin == null) {   // the clip's smallest hand gap on this character, sampled once
      const act = a.acts.Clapping, t0 = act.time, dur = act.getClip().duration; let m = 9;
      for (let t = 0; t < dur; t += 1 / 30) { act.time = t; a.mixer.update(0); a.o.updateMatrixWorld(true); m = Math.min(m, a.lhand.getWorldPosition(w1).distanceTo(a.rhand.getWorldPosition(w2))); }
      act.time = t0; a.mixer.update(0); a.o.updateMatrixWorld(true); a.clapMin = m; window.__clap = (window.__clap || []).concat([[a.key, m.toFixed(3)]]);
      L.copy(a.lhand.getWorldPosition(w1)); Rh.copy(a.rhand.getWorldPosition(w2)); mid.copy(L).add(Rh).multiplyScalar(0.5);
    }
    const gap = L.distanceTo(Rh);
    const pull = Math.max(0, Math.min(gap / 2 - 0.035, a.clapMin / 2 - 0.035));
    if (pull <= 0) return;
    const dir = Rh.clone().sub(L).normalize();
    aim(a.larm, a.lhand, L.addScaledVector(dir, pull)); aim(a.rarm, a.rhand, Rh.addScaledVector(dir, -pull));
  }
  function closeHands(a, want) {
    if (!a.larm || !a.rarm) return;
    const L = a.lhand.getWorldPosition(new T.Vector3()), Rh = a.rhand.getWorldPosition(new T.Vector3()), gap = L.distanceTo(Rh);
    if (gap <= want) return; const pull = (gap - want) / 2, dir = Rh.clone().sub(L).normalize();
    aim(a.larm, a.lhand, L.addScaledVector(dir, pull)); aim(a.rarm, a.rhand, Rh.addScaledVector(dir, -pull));
  }
  // the phone sits in the left hand, pulled a little toward the right hand, screen turned to the face
  function holdPhone(a) {
    const L = a.lhand.getWorldPosition(w1), Rh = a.rhand.getWorldPosition(w2);
    a.phone.position.copy(L).lerp(Rh, a.cur === "Tablet" || a.cur === "Texting" ? 0.5 : 0); a.phone.position.y += a.cur === "Texting" ? 0.075 : 0.03;
    if (a.cur === "Texting") a.phone.position.add(new T.Vector3(0, 0, 0.035).applyQuaternion(a.g.quaternion));
    a.head.getWorldPosition(w3); w3.add(new T.Vector3(0, 0, 0.45).applyQuaternion(a.g.quaternion)); a.phone.lookAt(w3);
    const mine = P3 && P3.kind && P3.holder === a, gm = a.glass.material;
    if (mine && gm.map !== P3.tx) { gm.map = P3.tx; gm.color.set(0xffffff); gm.toneMapped = false; gm.needsUpdate = true; }
    if (!mine && gm.map) { gm.map = null; gm.color.set(0xbff0e2); gm.needsUpdate = true; }
  }
  const fpA = new T.Vector3(), fpB = new T.Vector3(), fpR = new T.Vector3(), fpU = new T.Vector3(0, 1, 0);
  function fitPortrait(p, q) {
    const pts = [], pf = SCENES[si]?.pf, use = (k) => !pf || pf.includes(k);
    for (const a of Object.values(actors)) if (a.g.visible && use(a.key)) { const P = a.walk ? a.walk.to : a.g.position; pts.push([P.x - 0.35, 0.1, P.z], [P.x + 0.35, 1.85, P.z]); }
    if (P3 && P3.kind && use("phone")) { const P = P3.target; pts.push([P.x - 0.26, P.y - 0.47, P.z], [P.x + 0.26, P.y + 0.47, P.z]); }
    if (CEL && use("ring")) { const P = CEL.g.position; pts.push([P.x - 1.25, P.y - 1.2, P.z], [P.x + 1.25, P.y + 1.6, P.z]); }
    if (VAULT3 && use("vault")) { const P = VAULT3.g.position; pts.push([P.x - 0.75, P.y - 0.05, P.z], [P.x + 0.75, P.y + 1.45, P.z]); }
    if (!pts.length) return;
    const c = pts.reduce((s, v) => [s[0] + v[0] / pts.length, s[1] + v[1] / pts.length, s[2] + v[2] / pts.length], [0, 0, 0]);
    fpA.set(...p).sub(fpB.set(...q)).normalize(); fpR.crossVectors(fpU, fpA).normalize(); const up = new T.Vector3().crossVectors(fpA, fpR);
    let hw = 0, hh = 0; for (const v of pts) { const d = new T.Vector3(v[0] - c[0], v[1] - c[1], v[2] - c[2]); hw = Math.max(hw, Math.abs(d.dot(fpR))); hh = Math.max(hh, Math.abs(d.dot(up))); }
    const vf = (cam.fov * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * cam.aspect);
    const dist = Math.max((hw + 0.08) / Math.tan(hf), (hh + 0.45) / Math.tan(vf));
    c[1] += 0.18; // headroom for the caption at the top
    for (let i = 0; i < 3; i++) { q[i] = c[i]; p[i] = c[i] + [fpA.x, fpA.y, fpA.z][i] * dist; }
  }
  let elapsed = 0;
  function tick(rdt) {
    const dt = Math.min(0.1, rdt); elapsed += dt; const t = elapsed;
    if (ready && si >= 0) {
      const S = SCENES[si]; st += Math.min(rdt, 0.6);
      const k = ease(Math.min(1, st / S.dur));
      const p = lerpV(S.cam[0], S.cam[2], k), q = lerpV(S.cam[1], S.cam[3], k);
      if (cam.aspect < 0.9) fitPortrait(p, q);
      if (snap) { camPos.set(...p); camTgt.set(...q); snap = false; } else { camPos.lerp(v.set(...p), 0.1); camTgt.lerp(v.set(...q), 0.1); }
      cam.position.copy(camPos); cam.lookAt(camTgt);
      while (fired < S.beats.length && st >= S.beats[fired][0]) S.beats[fired++][1]();
      for (const a of Object.values(actors)) {
        if (a.walk) { a.walk.t += Math.min(rdt, 0.6); const u = Math.min(1, a.walk.t / a.walk.dur); a.g.position.lerpVectors(a.walk.from, a.walk.to, u); const d = a.walk.to.clone().sub(a.walk.from); a.g.rotation.y = Math.atan2(d.x, d.z); if (u >= 1) { a.g.rotation.y = a.walk.ry ?? a.g.rotation.y; a.walk = null; a.play("Waving", { once: true }); } }
        a.mixer.update(dt); a.o.updateMatrixWorld(true);
        if (a.cur === "Clapping") clapFix(a);
        if (a.cur === "Texting") closeHands(a, 0.11);
        if (a.cur === "Idle") idleLife(a, dt);
        if (a.phone.visible) holdPhone(a);
      }
      // the 3D phone: glides to its spot, floats, faces the camera a little, redraws its screen
      if (P3) {
        const on = !!P3.kind; P3.show += ((on ? 1 : 0) - P3.show) * Math.min(1, dt * 4);
        if (P3.emerge && P3.holder) { P3.g.position.copy(P3.holder.phone.position); P3.emerge = false; }
        P3.g.visible = P3.show > 0.02; P3.g.scale.setScalar(P3.holder ? 0.12 + 0.88 * P3.show : 0.6 + 0.4 * P3.show);
        P3.g.position.lerp(P3.target, Math.min(1, dt * 3)); P3.g.position.y += Math.sin(t * 1.4) * 0.0015;
        const look = Math.atan2(cam.position.x - P3.g.position.x, cam.position.z - P3.g.position.z);
        P3.g.rotation.y += ((look + P3.rot * 0.35) - P3.g.rotation.y) * Math.min(1, dt * 3); P3.g.rotation.x = Math.sin(t * 0.9) * 0.03;
        if (on) drawScreen(P3.kind, Math.min(1, (st - P3.t0) / (P3.o.span || 3.5)), P3.o);
        const h = P3.holder, zl = !!(on && h && h.phone.visible && h.g.visible); P3.zoom.visible = zl;
        if (zl) { P3.g.updateMatrixWorld(true); h.phone.updateMatrixWorld(true); const za = P3.zoom.geometry.attributes.position; let n = 0;
          for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const A = h.phone.localToWorld(w1.set(sx * 0.037, sy * 0.077, 0.005)), B = P3.g.localToWorld(w2.set(sx * 0.2, sy * 0.415, 0.01)); za.setXYZ(n++, A.x, A.y, A.z); za.setXYZ(n++, B.x, B.y, B.z); }
          za.needsUpdate = true; P3.zoom.material.opacity = 0.35 * P3.show; }
      }
      flyTick(); vaultTick(); celebTick();
      if (conf) SET.conf.forEach((c) => { const u = c.userData, tt = (t * u.v + u.s) % 3.5; c.position.set(u.x + Math.sin(t + u.s) * 0.2, u.y0 - tt * 1.2, u.z); c.rotation.set(t * 3 + u.s, t * 2, 0); });
    }
    R.render(scene, cam); placeBubbles();
  }
  function frame() { if (!running) return; raf = requestAnimationFrame(frame); tick(clock.getDelta()); }

  async function init(container, overlay, cb) {
    el = container; ui = overlay; onScene = cb;
    R = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: REC }); R.setPixelRatio(REC ? 1 : Math.min(devicePixelRatio || 1, 1.75));
    R.outputEncoding = T.sRGBEncoding; R.toneMapping = T.ACESFilmicToneMapping; R.toneMappingExposure = 1.05; R.shadowMap.enabled = true; R.shadowMap.type = T.PCFSoftShadowMap;
    el.prepend(R.domElement);
    scene = new T.Scene(); cam = new T.PerspectiveCamera(35, 1, 0.05, 100);
    scene.add(new T.HemisphereLight(0xfff6ea, 0xbfae98, 0.75));
    const key = new T.DirectionalLight(0xfff0dc, 1.5); key.position.set(3, 5, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 5; key.shadow.bias = -0.0003;
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 20 }); key.shadow.camera.updateProjectionMatrix(); scene.add(key);
    const rim = new T.DirectionalLight(0xcfe3ff, 0.6); rim.position.set(-4, 3, -3); scene.add(rim);
    SET = buildSet(); makePhone3D();
    clock = new T.Clock();
    const size = () => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; R.setSize(w, h, false); R.domElement.style.width = "100%"; R.domElement.style.height = "100%"; cam.aspect = w / h; cam.fov = w / h < 0.9 ? 52 : 35; cam.updateProjectionMatrix(); };
    new ResizeObserver(size).observe(el); size();
    if (!REC) { running = true; frame(); }
    if (!T.GLTFLoader) await new Promise((ok, no) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    const L = new T.GLTFLoader(), get = (f) => new Promise((ok, no) => L.load(ASSETS + f, ok, (e) => ui.loading && e.total && (ui.loading.textContent = `Loading the story… ${Math.round((e.loaded / e.total) * 100)}%`), no));
    const [anims, a1, a2, tx] = await Promise.all([get("anims.glb?v=4"), get(CAST.adam.file), get(CAST.sami.file), get("texting.glb?v=1").catch(() => null)]);
    SRC = anims.animations;
    // clips exported on their own skeleton carry that skeleton's hip rest (for the hip-height rescale)
    if (tx) { let r = null; tx.scene.traverse((n) => { if (n.name === "mixamorigHips") r = n.position.clone(); }); tx.animations.forEach((c) => { c.userData = { rest: r, scene: tx.scene }; SRC = SRC.concat([c]); }); } let animRest = new T.Vector3(0, 0, -209); anims.scene.traverse((n) => { if (n.name === "mixamorigHips") animRest = n.position.clone(); });
    setupActor("adam", a1, animRest); setupActor("sami", a2, animRest);
    ready = true; ui.loading?.remove(); go(0);
  }
  window.Film = {
    init, next: () => go(si + 1), prev: () => go(si - 1), go, count: () => SCENES.length, index: () => si,
    hands: () => Object.values(actors).map((a) => [a.key, a.cur, ...[a.lhand, a.rhand, a.head].map((b) => b.getWorldPosition(new T.Vector3()).toArray().map((v) => +v.toFixed(3)))]),
    duration: (i) => SCENES[i ?? si]?.dur, step: (dt) => tick(dt), ready: () => ready,
    pause: () => { running = false; cancelAnimationFrame(raf); }, resume: () => { if (!REC && !running) { running = true; clock.getDelta(); frame(); } },
  };
})();

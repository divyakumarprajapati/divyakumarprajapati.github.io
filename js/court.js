/*
 * CourtNG feed: a simulated broadcast-camera view of a court with the
 * overlays CourtNG produces. Detection boxes, pose skeletons, ball tracking,
 * a SAM-style court mask, and a small match engine that calls lines and
 * keeps score. Everything is drawn in world metres and projected through a
 * pinhole camera, so hovering the feed can invert the projection back onto
 * the court plane.
 */
(() => {
  'use strict';

  // One independent simulation per <canvas data-court>.
  function mount(canvas, index) {
    const screen = canvas.closest('[data-screen]');
    const figure = canvas.closest('[data-feed]') || canvas.parentElement;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isStatic = reduceMotion || figure.hasAttribute('data-static');

    const q = (sel) => figure.querySelector(sel);
    const ui = {
      log: q('[data-log]'),
      readout: q('[data-readout]'),
      boot: q('[data-boot]'),
      score: q('[data-score]'),
      games: q('[data-games]'),
      rally: q('[data-rally]'),
      speed: q('[data-speed]'),
      call: q('[data-call]'),
      callSub: q('[data-call-sub]'),
      sportBtns: [...figure.querySelectorAll('[data-sport]')],
    };

    const rootStyle = getComputedStyle(document.documentElement);
    const cssVar = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
    const C = {
      accent: cssVar('--accent', '#d6ff3a'),
      cyan: cssVar('--cyan', '#5fe1ff'),
      coral: cssVar('--coral', '#ff7a5c'),
      mask: cssVar('--mask', '#9b8cff'),
      ink: '#0a0b0c',
      line: 'rgba(238, 242, 232, 0.62)',
    };
    const MONO = '"JetBrains Mono", ui-monospace, monospace';

    /* ---------- small math kit ---------- */
    let seed = 20250819 + index * 7919;
    function rand(a = 0, b = 1) {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return a + (b - a) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
    }
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const hexA = (hex, a) => {
      const n = parseInt(hex.replace('#', ''), 16);
      return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    };

    /* ---------- sports (metres) ---------- */
    const SPORTS = {
      tennis: {
        id: 'tennis', L: 23.77, W: 10.97, inW: 8.23, service: 6.4,
        netH: 0.914, postH: 1.07, postOut: 0.914,
        back: 1.1, hitZ: 1.0, ballR: 0.034,
        shot: [1.2, 1.55], apex: [1.5, 2.3],
        serveZ: 2.55, serveApex: [0.9, 1.25], serveDepth: [3.6, 6.05], serveTime: 0.78,
        tool: 'racket', reach: 0.62, head: 0.45, headR: 0.14, maxV: 6,
      },
      pickleball: {
        id: 'pickleball', L: 13.41, W: 6.1, inW: 6.1, kitchen: 2.13,
        netH: 0.86, postH: 0.914, postOut: 0.3,
        back: 0.5, hitZ: 0.8, ballR: 0.037,
        shot: [1.35, 1.8], apex: [1.1, 1.6],
        serveZ: 0.75, serveApex: [1.3, 1.7], serveDepth: [3.3, 6.2], serveTime: 1,
        tool: 'paddle', reach: 0.55, head: 0.28, headR: 0.11, maxV: 4.5,
      },
    };

    function courtLines(s) {
      const hl = s.L / 2, hw = s.W / 2, sw = s.inW / 2;
      const out = [
        [[-hw, -hl], [hw, -hl]], [[-hw, hl], [hw, hl]],
        [[-hw, -hl], [-hw, hl]], [[hw, -hl], [hw, hl]],
      ];
      if (s.id === 'tennis') {
        const sl = s.service;
        out.push(
          [[-sw, -hl], [-sw, hl]], [[sw, -hl], [sw, hl]],
          [[-sw, -sl], [sw, -sl]], [[-sw, sl], [sw, sl]],
          [[0, -sl], [0, sl]], [[0, -hl], [0, -hl + 0.15]], [[0, hl], [0, hl - 0.15]],
        );
      } else {
        const k = s.kitchen;
        out.push([[-hw, -k], [hw, -k]], [[-hw, k], [hw, k]], [[0, -hl], [0, -k]], [[0, k], [0, hl]]);
      }
      return out;
    }

    function courtKeypoints(s) {
      const hl = s.L / 2, hw = s.W / 2, sw = s.inW / 2;
      const pts = [];
      for (const sy of [-1, 1]) {
        pts.push([-hw, sy * hl], [hw, sy * hl]);
        if (s.id === 'tennis') {
          pts.push([-sw, sy * hl], [sw, sy * hl], [-sw, sy * s.service], [sw, sy * s.service], [0, sy * s.service]);
        } else {
          pts.push([-hw, sy * s.kitchen], [hw, sy * s.kitchen], [0, sy * s.kitchen], [0, sy * hl]);
        }
      }
      return pts;
    }

    let sport = SPORTS.tennis;
    let lines = courtLines(sport);
    let keypoints = courtKeypoints(sport);

    /* ---------- camera ---------- */
    let W = 1, H = 1, dpr = 1;
    const cam = { C: [0, 0, 1], f: [0, 1, 0], r: [1, 0, 0], u: [0, 0, 1], s: 1, ox: 0, oy: 0 };

    function projRaw(P) {
      const v = sub(P, cam.C);
      const z = dot(v, cam.f);
      return [dot(v, cam.r) / z, -dot(v, cam.u) / z, z];
    }
    function proj(P) {
      const p = projRaw(P);
      return [p[0] * cam.s + cam.ox, p[1] * cam.s + cam.oy, p[2]];
    }
    // world length in metres -> pixels at a given camera depth
    const px = (metres, depth) => (metres * cam.s) / depth;

    // screen point -> point on the court plane (z = 0)
    function unproject(sx, sy) {
      const a = (sx - cam.ox) / cam.s;
      const b = (sy - cam.oy) / cam.s;
      const d = [0, 1, 2].map((i) => cam.f[i] + cam.r[i] * a - cam.u[i] * b);
      if (d[2] > -1e-4) return null;
      const t = -cam.C[2] / d[2];
      return [cam.C[0] + d[0] * t, cam.C[1] + d[1] * t];
    }

    function setupCamera() {
      const s = sport, hl = s.L / 2;
      cam.C = [0, -hl - s.L * 0.6, s.L * 0.5];
      cam.f = norm(sub([0, s.L * 0.04, 0], cam.C));
      cam.r = norm(cross(cam.f, [0, 0, 1]));
      cam.u = cross(cam.r, cam.f);
      cam.s = 1; cam.ox = 0; cam.oy = 0;

      const m = s.postOut + 0.7, far = hl + s.back + 0.6;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const x of [-s.W / 2 - m, s.W / 2 + m]) {
        for (const y of [-far, far]) {
          for (const z of [0, 2.1]) {
            const p = projRaw([x, y, z]);
            x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
            y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
          }
        }
      }
      const [ft, fr, fb, fl] = (figure.dataset.pad || '0.13 0.05 0.04 0.05').split(/\s+/).map(Number);
      const pl = W * fl, pr = W * fr, pt = H * ft, pb = H * fb;
      cam.s = Math.min((W - pl - pr) / (x1 - x0), (H - pt - pb) / (y1 - y0));
      cam.ox = pl + (W - pl - pr - (x1 - x0) * cam.s) / 2 - x0 * cam.s;
      cam.oy = pt + (H - pt - pb - (y1 - y0) * cam.s) / 2 - y0 * cam.s;
    }

    /* ---------- match state ---------- */
    const sim = {};

    function makePlayer(i) {
      const s = sport, face = i === 0 ? 1 : -1;
      const y = -face * (s.L / 2 + s.back);
      return {
        i, face, x: 0, y, tx: 0, ty: y, vx: 0, vy: 0,
        phase: rand(0, 6), swingT: -9, conf: rand(0.94, 0.98), toolConf: rand(0.86, 0.93),
      };
    }

    function resetMatch() {
      sim.t = 0;
      sim.players = [makePlayer(0), makePlayer(1)];
      sim.ball = { p: [0, 0, 1], alpha: 1 };
      sim.ballConf = 0.97;
      sim.shot = null;
      sim.trail = [];
      sim.points = [0, 0];
      sim.games = [0, 0];
      sim.server = 0;
      sim.rally = 0;
      sim.bounces = [];
      sim.fx = [];
      sim.mask = null;
      sim.maskAt = 0.5;
      sim.confT = 0;
      readyServe(0.9);
      sim.players.forEach((p) => { p.x = p.tx; p.y = p.ty; });
    }

    // walk both players to their serve / return spots
    function readyServe(delay) {
      const s = sport, hl = s.L / 2;
      const total = sim.points[0] + sim.points[1];
      const deuce = total % 2 === 0;
      const srv = sim.players[sim.server];
      const rcv = sim.players[1 - sim.server];
      const offset = s.id === 'tennis' ? 0.9 : s.W / 4;
      srv.tx = (deuce ? 1 : -1) * offset * srv.face;
      srv.ty = -srv.face * (hl + 0.25);
      rcv.tx = -Math.sign(srv.tx) * (s.inW / 2) * 0.7;
      rcv.ty = -rcv.face * (hl + s.back * 0.7);
      sim.phase = 'ready';
      sim.nextAt = sim.t + delay;
      srv.swingT = sim.nextAt;
      rcv.swingT = -9;
      sim.shot = null;
      sim.trail.length = 0;
      sim.ball.alpha = 1;
      sim.rally = 0;
    }

    function startShot(h, serve) {
      const s = sport, hl = s.L / 2, sw = s.inW / 2;
      const hitter = sim.players[h], recv = sim.players[1 - h];
      const dir = hitter.face;
      const from = sim.ball.p.slice();
      const srvSign = Math.sign(hitter.x) || 1;
      let bx, by, returnable = true;

      if (serve) {
        const boxW = s.id === 'tennis' ? sw : s.W / 2;
        bx = -srvSign * rand(0.4, boxW * 0.85);
        by = dir * rand(s.serveDepth[0], s.serveDepth[1]);
        if (rand() < 0.1) {
          by = dir * ((s.id === 'tennis' ? s.service : hl) + rand(0.1, 0.55));
          returnable = false;
        }
      } else {
        const out = rand() < clamp(0.05 + sim.rally * 0.03, 0, 0.32);
        const close = !out && rand() < 0.3;
        if (out) {
          returnable = false;
          if (rand() < 0.62) { by = dir * (hl + rand(0.08, 0.9)); bx = rand(-sw * 0.8, sw * 0.8); }
          else { by = dir * rand(hl * 0.35, hl * 0.9); bx = (rand() < 0.5 ? -1 : 1) * (sw + rand(0.08, 0.7)); }
        } else if (close) {
          if (rand() < 0.6) { by = dir * (hl - rand(0.02, 0.2)); bx = rand(-sw * 0.85, sw * 0.85); }
          else { by = dir * rand(hl * 0.35, hl * 0.9); bx = (rand() < 0.5 ? -1 : 1) * (sw - rand(0.02, 0.2)); }
        } else {
          by = dir * rand(hl * 0.36, hl * 0.9);
          bx = rand(-sw * 0.85, sw * 0.85);
        }
        if (returnable && rand() < 0.08) returnable = false; // an outright winner
      }

      // where the receiver will meet it
      const dx = bx - from[0], dy = by - from[1];
      const contactY = -recv.face * (hl + s.back * 0.4);
      let to;
      if (returnable) {
        const k = (contactY - by) / dy;
        to = [clamp(bx + dx * k, -(s.W / 2 + 1.4), s.W / 2 + 1.4), contactY, s.hitZ + rand(-0.1, 0.15)];
      } else {
        to = [bx + dx * 0.5, by + dy * 0.5, 0.5];
      }

      const T = rand(s.shot[0], s.shot[1]) * (serve ? s.serveTime : 1);
      const d1 = Math.hypot(dx, dy), d2 = Math.hypot(to[0] - bx, to[1] - by);
      const tb = T * clamp(d1 / (d1 + d2 * 1.6), 0.55, 0.8);

      // arc high enough to clear the net
      let apex1 = serve ? rand(s.serveApex[0], s.serveApex[1]) : rand(s.apex[0], s.apex[1]);
      const u0 = -from[1] / dy;
      if (u0 > 0 && u0 < 1) {
        const need = s.netH + 0.22;
        const zAt = from[2] * (1 - u0) + 4 * apex1 * u0 * (1 - u0);
        if (zAt < need) apex1 = (need - from[2] * (1 - u0)) / (4 * u0 * (1 - u0));
      }

      sim.shot = {
        h, serve, from, bx, by, to, srvSign, returnable,
        t0: sim.t, tb: sim.t + tb, tt: sim.t + T,
        apex1, apex2: rand(0.7, 1.2) * (s.id === 'tennis' ? 1 : 0.7),
        bounced: false, ended: false,
      };

      const reach = s.reach * recv.face;
      if (returnable) {
        recv.tx = to[0] - reach;
        recv.ty = to[1] - recv.face * 0.35;
        recv.swingT = sim.shot.tt;
      } else {
        recv.tx = lerp(recv.x, to[0] - reach, 0.45);
        recv.swingT = -9;
      }
      hitter.tx = rand(-0.6, 0.6);
      hitter.ty = -hitter.face * (hl + s.back);

      sim.rally += 1;
      const kmh = Math.round((d1 / tb) * 3.6);
      setText(ui.speed, 'speed', String(kmh));
      setText(ui.rally, 'rally', String(sim.rally));
      log(serve ? 'SERVE' : 'HIT', `P${h + 1} · ${kmh} km/h`);
    }

    function ballAt(sh, t) {
      if (t <= sh.tb) {
        const u = (t - sh.t0) / (sh.tb - sh.t0);
        return [lerp(sh.from[0], sh.bx, u), lerp(sh.from[1], sh.by, u), sh.from[2] * (1 - u) + 4 * sh.apex1 * u * (1 - u)];
      }
      const u = (t - sh.tb) / (sh.tt - sh.tb);
      return [lerp(sh.bx, sh.to[0], u), lerp(sh.by, sh.to[1], u), Math.max(0, sh.to[2] * u + 4 * sh.apex2 * u * (1 - u))];
    }

    function onBounce(sh) {
      sh.bounced = true;
      const s = sport, hl = s.L / 2, sw = s.inW / 2;
      const dir = sim.players[sh.h].face;
      const ax = Math.abs(sh.bx), ay = sh.by * dir;
      let inside, margin, why;

      if (sh.serve) {
        const depth = s.id === 'tennis' ? s.service : hl;
        const minD = s.id === 'tennis' ? 0 : s.kitchen;
        const boxW = s.id === 'tennis' ? sw : s.W / 2;
        const rightBox = Math.sign(sh.bx) !== sh.srvSign;
        inside = ay > minD && ay <= depth && ax <= boxW && rightBox;
        margin = Math.min(depth - ay, boxW - ax);
        why = ay > depth ? 'long' : 'wide';
      } else {
        inside = ay > 0 && ay <= hl && ax <= sw;
        margin = Math.min(hl - ay, sw - ax);
        why = ay > hl ? 'long' : 'wide';
      }

      const m = Math.abs(margin).toFixed(2);
      const detail = inside ? `${m} m inside` : `${m} m ${why}`;
      const close = Math.abs(margin) < 0.25;

      sim.bounces.push({ x: sh.bx, y: sh.by, inside });
      if (sim.bounces.length > 16) sim.bounces.shift();
      sim.fx.push({ kind: 'ring', x: sh.bx, y: sh.by, t0: sim.t, inside });
      sim.fx.push({ kind: 'call', x: sh.bx, y: sh.by, t0: sim.t, inside, text: inside ? 'IN' : sh.serve ? 'FAULT' : 'OUT', sub: detail });

      if (ui.call) {
        ui.call.textContent = inside ? 'In' : sh.serve ? 'Fault' : 'Out';
        ui.call.classList.toggle('is-in', inside);
        ui.call.classList.toggle('is-out', !inside);
      }
      setText(ui.callSub, 'callSub', detail);

      log(inside ? 'IN' : sh.serve ? 'FAULT' : 'OUT', `${close ? 'close call · ' : ''}${detail}`, inside ? 'in' : 'out');

      if (!inside) {
        sh.returnable = false;
        pointTo(1 - sh.h);
      }
    }

    function scoreText() {
      const [a, b] = sim.points;
      if (sport.id !== 'tennis') return `${a} : ${b}`;
      const names = ['0', '15', '30', '40'];
      if (a >= 3 && b >= 3) return a === b ? '40 : 40' : a > b ? 'AD : 40' : '40 : AD';
      return `${names[a]} : ${names[b]}`;
    }

    function renderScore() {
      setText(ui.score, 'score', scoreText());
      setText(ui.games, 'games', `Games ${sim.games[0]} : ${sim.games[1]}${sport.id === 'tennis' ? '' : ' · to 11'}`);
    }

    function pointTo(w) {
      const p = sim.points, o = 1 - w;
      let game = false;
      if (sport.id === 'tennis') {
        if (p[w] >= 3 && p[w] - p[o] >= 1) game = true;
        else p[w] += 1;
      } else {
        p[w] += 1;
        if (p[w] >= 11 && p[w] - p[o] >= 2) game = true;
        sim.server = w; // rally scoring: the rally winner serves
      }
      if (game) {
        sim.games[w] += 1;
        p[0] = 0; p[1] = 0;
        if (sport.id === 'tennis') sim.server = 1 - sim.server;
        log('GAME', `P${w + 1} · games ${sim.games[0]} : ${sim.games[1]}`, 'in');
      } else {
        log('POINT', `P${w + 1} · ${scoreText()}`);
      }
      renderScore();
      sim.phase = 'dead';
      sim.deadAt = sim.t;
    }

    /* ---------- simulation step ---------- */
    function step(dt) {
      sim.t += dt;
      const t = sim.t, s = sport;

      for (const p of sim.players) {
        const ax = clamp((p.tx - p.x) * 5, -s.maxV, s.maxV);
        const ay = clamp((p.ty - p.y) * 5, -s.maxV, s.maxV);
        const k = Math.min(1, dt * 7);
        p.vx += (ax - p.vx) * k;
        p.vy += (ay - p.vy) * k;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.phase += Math.hypot(p.vx, p.vy) * dt * 3.8;
      }

      if (t > sim.confT) {
        sim.confT = t + 0.35;
        for (const p of sim.players) {
          p.conf = clamp(p.conf + rand(-0.015, 0.015), 0.9, 0.99);
          p.toolConf = clamp(p.toolConf + rand(-0.02, 0.02), 0.82, 0.96);
        }
        sim.ballConf = clamp(sim.ballConf + rand(-0.02, 0.02), 0.88, 0.99);
      }

      if (t >= sim.maskAt) {
        sim.mask = { t0: t, logged: false };
        sim.maskAt = t + 11;
      }
      if (sim.mask && !sim.mask.logged && t - sim.mask.t0 > 1.15) {
        sim.mask.logged = true;
        log('SAM 3', `court mask · IoU ${rand(0.965, 0.99).toFixed(3)}`, 'sam');
      }

      if (sim.phase === 'ready') {
        const srv = sim.players[sim.server];
        const lead = t - (sim.nextAt - 0.6);
        let z = s.id === 'tennis' ? 1.05 : 0.72;
        if (s.id === 'tennis' && lead > 0) z = lerp(1.05, s.serveZ, Math.sin(clamp(lead / 0.6, 0, 1) * Math.PI / 2));
        sim.ball.p = [srv.x - 0.28 * srv.face, srv.y + 0.14 * srv.face, z];
        if (t >= sim.nextAt) {
          sim.phase = 'rally';
          startShot(sim.server, true);
        }
        return;
      }

      const sh = sim.shot;
      if (sh) {
        sim.ball.p = ballAt(sh, t);
        sim.trail.push(sim.ball.p.slice());
        if (sim.trail.length > 24) sim.trail.shift();
        if (!sh.bounced && t >= sh.tb) onBounce(sh);
      }

      if (sim.phase === 'rally' && sh) {
        if (sh.returnable && t >= sh.tt) startShot(1 - sh.h, false);
        else if (!sh.returnable && sh.bounced && !sh.ended && t >= sh.tt) {
          sh.ended = true;
          log('WINNER', `P${sh.h + 1} · unreturned`, 'in');
          pointTo(sh.h);
        }
      } else if (sim.phase === 'dead') {
        sim.ball.alpha = clamp(1 - (t - sim.deadAt) / 1.1, 0, 1);
        if (t - sim.deadAt > 1.5) readyServe(1.3);
      }
    }

    /* ---------- drawing ---------- */
    function path(points, close = true) {
      ctx.beginPath();
      points.forEach((P, i) => {
        const p = proj(P);
        if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      });
      if (close) ctx.closePath();
    }

    function groundCircle(x, y, r) {
      ctx.beginPath();
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const p = proj([x + Math.cos(a) * r, y + Math.sin(a) * r, 0]);
        if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      }
    }

    function tag(x, y, text, color, small) {
      ctx.font = `600 ${small ? 9 : 10}px ${MONO}`;
      const tw = ctx.measureText(text).width + 8, th = small ? 12 : 14;
      const tx = clamp(x, 2, W - tw - 2), ty = clamp(y, th + 2, H - 2);
      ctx.fillStyle = color;
      ctx.fillRect(tx, ty - th, tw, th);
      ctx.fillStyle = C.ink;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tx + 4, ty - th / 2 + 0.5);
    }

    function callout(x, y, big, small, color) {
      ctx.font = `700 12px ${MONO}`;
      const bw = ctx.measureText(big).width + 12;
      ctx.font = `500 10px ${MONO}`;
      const sw = ctx.measureText(small).width + 10;
      const h = 18, w = bw + sw;
      const tx = clamp(x - w / 2, 2, W - w - 2), ty = clamp(y - h, 2, H - h - 2);
      ctx.fillStyle = color;
      ctx.fillRect(tx, ty, bw, h);
      ctx.fillStyle = 'rgba(8, 10, 11, 0.9)';
      ctx.fillRect(tx + bw, ty, sw, h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
      ctx.textBaseline = 'middle';
      ctx.font = `700 12px ${MONO}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(big, tx + 6, ty + h / 2 + 0.5);
      ctx.font = `500 10px ${MONO}`;
      ctx.fillStyle = '#e8ebe2';
      ctx.fillText(small, tx + bw + 5, ty + h / 2 + 0.5);
    }

    function drawSurface() {
      const s = sport, hl = s.L / 2, hw = s.W / 2;
      const ro = s.id === 'tennis' ? [3.4, 5.6] : [1.9, 2.9];
      path([[-hw - ro[0], -hl - ro[1], 0], [hw + ro[0], -hl - ro[1], 0], [hw + ro[0], hl + ro[1], 0], [-hw - ro[0], hl + ro[1], 0]]);
      ctx.fillStyle = 'rgba(52, 96, 104, 0.13)';
      ctx.fill();
      path([[-hw, -hl, 0], [hw, -hl, 0], [hw, hl, 0], [-hw, hl, 0]]);
      const g = ctx.createLinearGradient(0, proj([0, hl, 0])[1], 0, proj([0, -hl, 0])[1]);
      g.addColorStop(0, 'rgba(70, 132, 142, 0.14)');
      g.addColorStop(1, 'rgba(70, 132, 142, 0.26)');
      ctx.fillStyle = g;
      ctx.fill();
    }

    function drawLines() {
      ctx.lineWidth = 1.35;
      ctx.lineCap = 'round';
      ctx.strokeStyle = C.line;
      ctx.beginPath();
      for (const [a, b] of lines) {
        const p = proj([a[0], a[1], 0]), q2 = proj([b[0], b[1], 0]);
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q2[0], q2[1]);
      }
      ctx.stroke();
    }

    function drawShotMap() {
      for (const b of sim.bounces) {
        const p = proj([b.x, b.y, 0]);
        ctx.fillStyle = hexA(b.inside ? C.accent : C.coral, 0.35);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawMask() {
      if (!sim.mask) return;
      const e = sim.t - sim.mask.t0;
      const sweep = 1.1, hold = 0.9, fade = 1.3;
      if (e > sweep + hold + fade) return;
      const s = sport, hl = s.L / 2, hw = s.W / 2;
      const k = clamp(e / sweep, 0, 1);
      const ys = lerp(-hl, hl, ease(k));
      const a = e < sweep + hold ? 1 : 1 - (e - sweep - hold) / fade;

      ctx.save();
      ctx.globalAlpha = a;
      path([[-hw, -hl, 0], [hw, -hl, 0], [hw, ys, 0], [-hw, ys, 0]]);
      ctx.fillStyle = hexA(C.mask, 0.2);
      ctx.fill();
      ctx.strokeStyle = hexA(C.mask, 0.9);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (k < 1) {
        const p = proj([-hw - 0.8, ys, 0]), q2 = proj([hw + 0.8, ys, 0]);
        ctx.strokeStyle = C.mask;
        ctx.lineWidth = 2;
        ctx.shadowColor = C.mask;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q2[0], q2[1]);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        const p = proj([-hw, hl, 0]);
        tag(p[0], p[1] - 4, 'sam3 · court 0.99', C.mask);
      }
      ctx.restore();
    }

    function drawKeypoints() {
      const pulse = sim.mask ? clamp(1 - Math.abs(sim.t - sim.mask.t0 - 1.1) / 0.8, 0, 1) : 0;
      ctx.lineWidth = 1;
      for (const k of keypoints) {
        const p = proj([k[0], k[1], 0]);
        const r = 2.1 + pulse * 1.5;
        ctx.fillStyle = C.accent;
        ctx.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
        ctx.strokeStyle = 'rgba(10, 11, 12, 0.9)';
        ctx.strokeRect(p[0] - r, p[1] - r, r * 2, r * 2);
      }
    }

    function drawNet() {
      const s = sport, hw = s.W / 2 + s.postOut, n = 26;
      const top = [], bot = [];
      for (let i = 0; i <= n; i++) {
        const x = lerp(-hw, hw, i / n), k = Math.abs(x) / hw;
        top.push(proj([x, 0, s.netH + (s.postH - s.netH) * k * k]));
        bot.push(proj([x, 0, 0.03]));
      }
      ctx.beginPath();
      top.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      for (let i = n; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(220, 228, 216, 0.08)';
      ctx.fill();

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(220, 228, 216, 0.1)';
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { ctx.moveTo(top[i][0], top[i][1]); ctx.lineTo(bot[i][0], bot[i][1]); }
      ctx.stroke();

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(245, 247, 240, 0.9)';
      ctx.beginPath();
      top.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.stroke();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(205, 210, 200, 0.85)';
      for (const x of [-hw, hw]) {
        const a = proj([x, 0, 0]), b = proj([x, 0, s.postH + 0.03]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
    }

    // swing phase: -1 full backswing, 0 contact, +1 follow-through
    function swingOf(p, t) {
      const d = t - p.swingT;
      if (d < -0.4) return -0.15;
      if (d < -0.12) return lerp(-0.15, -1, ease((d + 0.4) / 0.28));
      if (d < 0.12) return lerp(-1, 1, (d + 0.12) / 0.24);
      if (d < 0.6) return lerp(1, -0.15, ease((d - 0.12) / 0.48));
      return -0.15;
    }

    const BONES = [
      ['lsh', 'rsh'], ['lsh', 'lhip'], ['rsh', 'rhip'], ['lhip', 'rhip'],
      ['lsh', 'lel'], ['lel', 'lwr'], ['rsh', 'rel'], ['rel', 'rwr'],
      ['lhip', 'lkn'], ['lkn', 'lan'], ['rhip', 'rkn'], ['rkn', 'ran'], ['neck', 'head'],
    ];
    const JOINTS = ['lsh', 'rsh', 'lel', 'rel', 'lwr', 'rwr', 'lhip', 'rhip', 'lkn', 'rkn', 'lan', 'ran'];

    function skeleton(p, t) {
      const s = sport;
      const mv = clamp(Math.hypot(p.vx, p.vy) / 3, 0, 1);
      const sw = swingOf(p, t);
      const hip = 0.9 - 0.05 * mv - (Math.abs(sw) > 0.5 ? 0.04 : 0);
      const sh = hip + 0.52;
      const a = sw * 0.75;
      const ca = Math.cos(a), sa = Math.sin(a);

      const K = {
        lsh: [-0.2 * ca, -0.2 * sa, sh],
        rsh: [0.2 * ca, 0.2 * sa, sh],
        neck: [0, 0, sh + 0.05],
        head: [0, 0.02, sh + 0.25],
        lhip: [-0.13, 0, hip],
        rhip: [0.13, 0, hip],
      };
      const back = [0.5, -0.5, hip + 0.25], hit = [s.reach, 0.36, hip + 0.1], thru = [-0.2, 0.34, sh + 0.12];
      K.rwr = sw < 0 ? mix3(hit, back, -sw) : mix3(hit, thru, sw);
      K.rel = [(K.rsh[0] + K.rwr[0]) / 2 + 0.1, (K.rsh[1] + K.rwr[1]) / 2 - 0.06, (K.rsh[2] + K.rwr[2]) / 2 - 0.1];
      K.lwr = [-0.32, 0.28 - 0.18 * sw, hip + 0.38 + 0.1 * sw];
      K.lel = [(K.lsh[0] + K.lwr[0]) / 2 - 0.1, (K.lsh[1] + K.lwr[1]) / 2, (K.lsh[2] + K.lwr[2]) / 2 - 0.08];

      const g = Math.sin(p.phase), g2 = Math.cos(p.phase);
      K.lan = [-0.22 - 0.1 * g * mv, 0.07 * g2 * mv, 0.03 + 0.11 * Math.max(0, g) * mv];
      K.ran = [0.22 + 0.1 * g * mv, -0.07 * g2 * mv, 0.03 + 0.11 * Math.max(0, -g) * mv];
      K.lkn = [(K.lhip[0] + K.lan[0]) / 2 - 0.03, 0.1, (hip + K.lan[2]) / 2 + 0.02];
      K.rkn = [(K.rhip[0] + K.ran[0]) / 2 + 0.03, 0.1, (hip + K.ran[2]) / 2 + 0.02];

      const out = {};
      for (const k in K) {
        const [lx, ly, lz] = K[k];
        out[k] = [p.x + lx * p.face, p.y + ly * p.face, lz];
      }
      const d = norm(sub(out.rwr, out.rel));
      out.tool = [out.rwr[0] + d[0] * s.head, out.rwr[1] + d[1] * s.head, out.rwr[2] + d[2] * s.head];
      return out;
    }

    function drawPlayer(p) {
      const s = sport;
      const K = skeleton(p, sim.t);
      const P = {};
      for (const k in K) P[k] = proj(K[k]);
      const foot = proj([p.x, p.y, 0]);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.beginPath();
      ctx.ellipse(foot[0], foot[1], px(0.45, foot[2]), px(0.45, foot[2]) * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = hexA(C.cyan, 0.95);
      ctx.lineWidth = clamp(px(0.05, foot[2]), 1.2, 2.6);
      ctx.beginPath();
      for (const [a, b] of BONES) { ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); }
      ctx.stroke();

      const headR = Math.max(2.5, px(0.11, P.head[2]));
      ctx.beginPath();
      ctx.arc(P.head[0], P.head[1], headR, 0, Math.PI * 2);
      ctx.fillStyle = C.ink;
      ctx.fill();
      ctx.stroke();

      const jr = clamp(px(0.035, foot[2]), 1.3, 2.6);
      ctx.lineWidth = 1.1;
      for (const k of JOINTS) {
        ctx.beginPath();
        ctx.arc(P[k][0], P[k][1], jr, 0, Math.PI * 2);
        ctx.fillStyle = C.ink;
        ctx.fill();
        ctx.stroke();
      }

      // racket / paddle
      const g = P.rwr, tl = P.tool;
      const r = Math.max(3, px(s.headR, tl[2]));
      const ang = Math.atan2(tl[1] - g[1], tl[0] - g[0]);
      ctx.strokeStyle = C.coral;
      ctx.lineWidth = clamp(px(0.03, g[2]), 1, 2);
      ctx.beginPath();
      ctx.moveTo(g[0], g[1]);
      ctx.lineTo(tl[0] - Math.cos(ang) * r, tl[1] - Math.sin(ang) * r);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(tl[0], tl[1], r * 1.15, r * 0.8, ang, 0, Math.PI * 2);
      if (s.id === 'pickleball') { ctx.fillStyle = hexA(C.coral, 0.45); ctx.fill(); }
      ctx.stroke();
      const bw = Math.max(12, r * 3);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(tl[0] - bw / 2, tl[1] - bw / 2, bw, bw);
      ctx.setLineDash([]);
      if (bw > 17) tag(tl[0] - bw / 2, tl[1] - bw / 2, `${s.tool} ${p.toolConf.toFixed(2)}`, C.coral, true);

      // person box
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const k in P) {
        if (k === 'tool') continue;
        x0 = Math.min(x0, P[k][0]); x1 = Math.max(x1, P[k][0]);
        y0 = Math.min(y0, P[k][1]); y1 = Math.max(y1, P[k][1]);
      }
      y0 -= headR;
      const pad = 5;
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2);
      tag(x0 - pad, y0 - pad, `player_${p.i + 1} ${p.conf.toFixed(2)}`, C.cyan);
    }

    function drawBall() {
      const b = sim.ball;
      if (b.alpha <= 0) return;
      const s = sport, sh = sim.shot;
      ctx.save();
      ctx.globalAlpha = b.alpha;

      const tr = sim.trail;
      for (let i = 1; i < tr.length; i++) {
        const a = proj(tr[i - 1]), c = proj(tr[i]);
        ctx.strokeStyle = hexA(C.accent, (i / tr.length) * 0.75);
        ctx.lineWidth = 0.8 + (i / tr.length) * 1.8;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.stroke();
      }

      if (sh && !sh.bounced && sim.phase === 'rally') {
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = hexA(C.accent, 0.45);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i <= 18; i++) {
          const p = proj(ballAt(sh, lerp(sim.t, sh.tb, i / 18)));
          if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        const L = proj([sh.bx, sh.by, 0]);
        ctx.strokeStyle = hexA(C.accent, 0.7);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(L[0] - 4, L[1] - 3); ctx.lineTo(L[0] + 4, L[1] + 3);
        ctx.moveTo(L[0] + 4, L[1] - 3); ctx.lineTo(L[0] - 4, L[1] + 3);
        ctx.stroke();
      }

      const p = proj(b.p), gnd = proj([b.p[0], b.p[1], 0]);
      const r = Math.max(2.6, px(s.ballR, p[2]) * 1.6);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * clamp(1 - b.p[2] / 4, 0.2, 1)})`;
      ctx.beginPath();
      ctx.ellipse(gnd[0], gnd[1], r * 1.3, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowColor = C.accent;
      ctx.shadowBlur = 14;
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      const bs = Math.max(16, r * 6);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(p[0] - bs / 2, p[1] - bs / 2, bs, bs);
      tag(p[0] - bs / 2, p[1] - bs / 2, `ball ${sim.ballConf.toFixed(2)}`, C.accent);
      ctx.restore();
    }

    function drawFx() {
      sim.fx = sim.fx.filter((f) => sim.t - f.t0 < 1.7);
      for (const f of sim.fx) {
        const e = sim.t - f.t0;
        const col = f.inside ? C.accent : C.coral;
        if (f.kind === 'ring') {
          const k = clamp(e / 0.75, 0, 1);
          ctx.strokeStyle = hexA(col, 1 - k);
          ctx.lineWidth = 1.6;
          groundCircle(f.x, f.y, 0.08 + k * 0.75);
          ctx.stroke();
        } else {
          const a = e < 1.25 ? 1 : 1 - (e - 1.25) / 0.45;
          const p = proj([f.x, f.y, 0]);
          ctx.save();
          ctx.globalAlpha = clamp(a, 0, 1);
          ctx.strokeStyle = col;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(p[0], p[1] - 24);
          ctx.stroke();
          callout(p[0], p[1] - 24, f.text, f.sub, col);
          ctx.restore();
        }
      }
    }

    /* ---------- hover: invert the projection ---------- */
    const hover = { on: false, sx: 0, sy: 0 };

    function zoneAt(x, y) {
      const s = sport, ax = Math.abs(x), ay = Math.abs(y);
      if (ay > s.L / 2 || ax > s.W / 2) return ['out', 'Out'];
      if (s.id === 'tennis') {
        if (ax > s.inW / 2) return ['alley', 'Doubles alley'];
        if (ay <= s.service) return ['in', 'Service box'];
        return ['in', 'In'];
      }
      return ay <= s.kitchen ? ['in', 'Kitchen'] : ['in', 'In'];
    }

    const fmt = (v) => {
      const r = Math.round(v * 100) / 100;
      return `${r < 0 ? '-' : '+'}${Math.abs(r).toFixed(2)}`;
    };

    function updateReadout() {
      if (!ui.readout) return;
      const g = unproject(hover.sx, hover.sy);
      if (!g) { ui.readout.textContent = 'above the horizon'; return; }
      const [cls, label] = zoneAt(g[0], g[1]);
      ui.readout.innerHTML = `x ${fmt(g[0])} m · y ${fmt(g[1])} m · <b class="${cls === 'out' ? 'out' : ''}">${label}</b>`;
    }

    function drawHover() {
      if (!hover.on) return;
      const g = unproject(hover.sx, hover.sy);
      if (!g) return;
      const s = sport;
      const [cls] = zoneAt(g[0], g[1]);
      const col = cls === 'out' ? C.coral : C.accent;

      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = hexA(col, 0.4);
      ctx.lineWidth = 1;
      const a = proj([g[0], -s.L / 2, 0]), b = proj([g[0], s.L / 2, 0]);
      const c = proj([-s.W / 2, g[1], 0]), d = proj([s.W / 2, g[1], 0]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.moveTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = col;
      ctx.lineWidth = 1.3;
      groundCircle(g[0], g[1], 0.35);
      ctx.stroke();
      const p = proj([g[0], g[1], 0]);
      ctx.beginPath();
      ctx.moveTo(p[0] - 10, p[1]); ctx.lineTo(p[0] - 3, p[1]);
      ctx.moveTo(p[0] + 3, p[1]); ctx.lineTo(p[0] + 10, p[1]);
      ctx.moveTo(p[0], p[1] - 10); ctx.lineTo(p[0], p[1] - 3);
      ctx.moveTo(p[0], p[1] + 3); ctx.lineTo(p[0], p[1] + 10);
      ctx.stroke();
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawSurface();
      drawShotMap();
      drawLines();
      drawMask();
      drawKeypoints();

      // painter's order: farthest from the camera first
      const items = [
        { y: sim.players[0].y, fn: () => drawPlayer(sim.players[0]) },
        { y: sim.players[1].y, fn: () => drawPlayer(sim.players[1]) },
        { y: 0, fn: drawNet },
        { y: sim.ball.p[1], fn: drawBall },
      ];
      items.sort((a, b) => b.y - a.y).forEach((it) => it.fn());

      drawFx();
      drawHover();
    }

    /* ---------- HUD text ---------- */
    const shown = {};
    function setText(el, key, val) {
      if (el && shown[key] !== val) { shown[key] = val; el.textContent = val; }
    }

    function stamp(t) {
      const m = Math.floor(t / 60), s = t - m * 60;
      return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
    }

    function log(ev, text, kind = '') {
      if (!ui.log) return;
      const li = document.createElement('li');
      li.innerHTML = `<span class="t">${stamp(sim.t)}</span><span class="e${kind ? ` e--${kind}` : ''}">${ev}</span><span>${text}</span>`;
      ui.log.appendChild(li);
      while (ui.log.children.length > 5) ui.log.firstElementChild.remove();
    }

    /* ---------- lifecycle ---------- */
    let raf = 0, last = 0, visible = true, started = false;

    function frame(now) {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000 || 1 / 60);
      last = now;
      if (figure.dataset.idle === '1') {
        if (visible && !document.hidden) raf = requestAnimationFrame(frame);
        return;
      }
      step(dt);
      draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    }
    function play() {
      if (raf || !started || isStatic || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    // a representative still for reduced motion and screenshots
    function warm(seconds = 4.35) {
      for (let t = 0; t < seconds; t += 1 / 60) step(1 / 60);
    }

    function resize() {
      const r = screen.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      setupCamera();
      if (!raf) draw();
    }

    function switchSport(id) {
      if (sport.id === id) return;
      ui.sportBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sport === id)));
      sport = SPORTS[id];
      lines = courtLines(sport);
      keypoints = courtKeypoints(sport);
      setupCamera();
      resetMatch();
      if (ui.log) ui.log.innerHTML = '';
      log('MODEL', `${id} weights loaded · court re-calibrated`, 'sys');
      setText(ui.speed, 'speed', '0');
      setText(ui.rally, 'rally', '0');
      if (ui.call) {
        ui.call.textContent = 'Ready';
        ui.call.classList.remove('is-in', 'is-out');
      }
      setText(ui.callSub, 'callSub', 'waiting for bounce');
      renderScore();
      if (isStatic) { warm(); draw(); }
    }

    function boot() {
      const steps = [
        ['courtng', 'pipeline v0.3'],
        ['load', 'yolo · tennis + pickleball'],
        ['load', 'sam 3 · court segmentation'],
        ['calibrate', 'court lines'],
        ['start', 'match orchestration engine'],
      ];
      const begin = () => {
        started = true;
        renderScore();
        log('ONLINE', 'engine ready · 2 players tracked', 'sys');
        play();
      };
      if (!isStatic && !ui.boot) {
        begin();
        return;
      }
      if (isStatic) {
        if (ui.boot) ui.boot.remove();
        renderScore();
        log('ONLINE', 'engine ready · 2 players tracked', 'sys');
        warm();
        draw();
        return;
      }
      steps.forEach(([k, v], i) => {
        setTimeout(() => {
          const p = document.createElement('p');
          p.innerHTML = `<span>&gt; ${k}</span><span>${v}</span><span class="ok">ok</span>`;
          ui.boot.appendChild(p);
        }, 420 + i * 190);
      });
      setTimeout(() => {
        ui.boot.classList.add('is-done');
        begin();
      }, 420 + steps.length * 190 + 380);
    }

    resetMatch();
    resize();

    new ResizeObserver(resize).observe(screen);
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) play(); else pause();
    }, { threshold: 0.02 }).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));

    screen.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      hover.on = true;
      hover.sx = e.clientX - r.left;
      hover.sy = e.clientY - r.top;
      updateReadout();
      if (!raf) draw();
    });
    screen.addEventListener('pointerleave', () => {
      hover.on = false;
      if (ui.readout) ui.readout.textContent = '';
      if (!raf) draw();
    });
    ui.sportBtns.forEach((btn) => btn.addEventListener('click', () => switchSport(btn.dataset.sport)));

    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => { resize(); boot(); });
  }

  document.querySelectorAll('[data-court]').forEach(mount);
})();

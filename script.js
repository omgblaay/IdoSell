(() => {
  const SLIDE_MS = 3000;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Hero slider ---------- */

  const hero = document.getElementById("hero");
  const slides = [...hero.querySelectorAll(".hero__slide")];
  const bars = [...hero.querySelectorAll(".hero__bar")];
  let current = 0;
  let timer = null;

  function show(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach((s, i) => s.classList.toggle("is-active", i === current));
    bars.forEach((b, i) => {
      b.classList.toggle("is-active", i === current);
      b.classList.toggle("is-done", i < current);
    });
    restartProgress();
    scheduleNext();
  }

  function restartProgress() {
    const active = bars[current];
    const span = active.querySelector("span");
    span.style.animation = "none";
    void span.offsetWidth;
    span.style.animation = "";
  }

  function scheduleNext() {
    clearTimeout(timer);
    if (!reduceMotion) timer = setTimeout(() => show(current + 1), SLIDE_MS);
  }

  hero.querySelector(".hero__arrow--prev").addEventListener("click", () => show(current - 1));
  hero.querySelector(".hero__arrow--next").addEventListener("click", () => show(current + 1));
  bars.forEach((bar, i) => bar.addEventListener("click", () => show(i)));

  scheduleNext();

  /* Lamps: float toward the cursor (each at its own depth) and switch on when clicked. */
  const lamps = [...hero.querySelectorAll(".lamp")].map((el, i) => ({
    el,
    depth: [1.0, 0.7, 1.35][i] ?? 1,
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
  }));

  lamps.forEach((lamp) => {
    lamp.el.addEventListener("click", () => {
      const on = lamp.el.getAttribute("aria-pressed") !== "true";
      lamp.el.setAttribute("aria-pressed", String(on));
      lamp.el.setAttribute("aria-label", on ? "Wyłącz lampę" : "Włącz lampę");
    });
  });

  if (!reduceMotion) {
    let pointer = null;

    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      pointer = {
        x: ((e.clientX - r.left) / r.width - 0.5) * 2,
        y: ((e.clientY - r.top) / r.height - 0.5) * 2,
      };
    });

    hero.addEventListener("pointerleave", () => {
      pointer = null;
    });

    function animateLamps() {
      lamps.forEach((lamp) => {
        const amp = 26 * lamp.depth;
        lamp.tx = pointer ? pointer.x * amp : 0;
        lamp.ty = pointer ? pointer.y * amp * 0.6 : 0;
        lamp.x += (lamp.tx - lamp.x) * 0.06;
        lamp.y += (lamp.ty - lamp.y) * 0.06;
        const tilt = lamp.x * 0.08;
        lamp.el.style.transform = `translate(${lamp.x.toFixed(2)}px, ${lamp.y.toFixed(2)}px) rotate(${tilt.toFixed(2)}deg)`;
      });
      requestAnimationFrame(animateLamps);
    }
    requestAnimationFrame(animateLamps);
  }

  /* ---------- Shader section (WebGL) ---------- */

  const LOOP_SECONDS = 12;

  const canvas = document.querySelector(".shader__canvas");
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });

  if (gl) {
    const vertSrc = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;

    const fragSrc = `
      precision highp float;
      uniform vec2 u_res;
      uniform float u_phase;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 34.45);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x),
          f.y
        );
      }

      // Each soft shadow crosses the frame once. It fades outside the edges,
      // making the loop continuous without a repeating stripe texture.
      float passingShadow(float diagonal, float phase, float offset, float width) {
        float travel = fract(phase + offset);
        float edge = smoothstep(0.0, 0.12, travel)
                   * (1.0 - smoothstep(0.88, 1.0, travel));
        float centre = 1.35 - 1.80 * travel;
        float d = (diagonal - centre) / width;
        return edge * exp(-d * d);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_res;
        float phase = u_phase / 6.2831853;
        vec2 orbit = vec2(cos(u_phase), sin(u_phase));

        // Broad amber light occupies the bottom half and rolls softly upward.
        vec2 left = (uv - vec2(0.55 + orbit.x * 0.28, -0.06)) / vec2(0.58, 0.67);
        vec2 right = (uv - vec2(0.82 + orbit.y * 0.12, -0.09)) / vec2(0.55, 0.69);
        float pools = 0.88 * exp(-dot(left, left) * 1.1)
                    + 0.98 * exp(-dot(right, right) * 1.1);

        vec2 p = vec2(uv.x * 2.1 - uv.y * 0.8, uv.y * 2.0);
        float cloud = 0.65 * noise(p + orbit * 0.30)
                    + 0.35 * noise(p * 1.7 - orbit * 0.22);
        float bend = (cloud - 0.5) * 0.15
                   + 0.025 * sin(uv.y * 8.0 + u_phase);
        float diagonal = uv.x - uv.y * 0.58 + bend;
        float width = 0.18 + 0.06 * uv.y;
        float shadowA = passingShadow(diagonal, phase, 0.0, width);
        float shadowB = passingShadow(diagonal, phase, 0.30, width * 0.88);

        float rise = 1.0 - smoothstep(0.13, 0.79, uv.y + bend * 0.32);
        float illumination = rise * (0.17 + pools * (0.62 + cloud * 0.22));
        illumination *= (1.0 - 0.84 * shadowA) * (1.0 - 0.72 * shadowB);
        illumination = max(illumination, 0.0);

        vec3 black = vec3(0.055, 0.055, 0.057);
        vec3 amber = vec3(0.43, 0.315, 0.075);
        vec3 yellow = vec3(0.97, 0.735, 0.13);
        vec3 col = mix(black, amber, smoothstep(0.0, 0.90, illumination));
        col = mix(col, yellow, smoothstep(0.25, 1.25, illumination));

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    }

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);

    if (vs && fs) {
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(prog));
        return;
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const uRes = gl.getUniformLocation(prog, "u_res");
      const uPhase = gl.getUniformLocation(prog, "u_phase");

      /* The soft field does not need full display resolution or 60 redraws per second. */
      const SCALE = 0.5;
      function resize() {
        const r = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.floor(r.width * SCALE));
        canvas.height = Math.max(1, Math.floor(r.height * SCALE));
        gl.viewport(0, 0, canvas.width, canvas.height);
      }
      resize();
      window.addEventListener("resize", resize);

      const start = performance.now();
      let visible = true;
      let lastDraw = -Infinity;
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      }).observe(canvas);

      function frame(now) {
        if (visible && now - lastDraw >= 1000 / 30) {
          lastDraw = now;
          const t = reduceMotion ? 0 : (now - start) / 1000;
          gl.uniform2f(uRes, canvas.width, canvas.height);
          gl.uniform1f(uPhase, ((t % LOOP_SECONDS) / LOOP_SECONDS) * Math.PI * 2);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        if (!reduceMotion) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
  }
})();

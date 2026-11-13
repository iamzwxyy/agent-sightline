(() => {
  const canvas = document.getElementById('context-field');
  if (!canvas) return;
  const hero = canvas.closest('.hero');
  const toggle = document.getElementById('motion-toggle');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return;

  const vertexSource = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      uv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision highp float;
    varying vec2 uv;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float time;
    uniform float perspective;

    float grain(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      float aspect = resolution.x / resolution.y;
      vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
      p += pointer * vec2(0.018, 0.008);
      vec3 background = vec3(0.039, 0.047, 0.055);
      vec3 light = mix(vec3(0.95, 0.46, 0.24), vec3(0.47, 0.62, 1.0), perspective * 0.5);
      float travel = sin(time * 0.16) * 0.75;
      vec3 color = background;
      float haze = exp(-pow((p.y - 0.27) * 5.5, 2.0) - pow(p.x * 0.75, 2.0));
      color += vec3(0.14, 0.09, 0.068) * haze * 0.36;

      // Layered contours share the selected client's light.
      for (int i = 0; i < 46; i++) {
        float layer = float(i) / 45.0;
        float depth = 0.62 + layer * 0.58;
        float x = p.x / depth;
        float wave = sin(x * 1.55 + layer * 1.9 + time * 0.07) * 0.115;
        wave += sin(x * 3.4 - layer * 1.1 - time * 0.045) * 0.024;
        float y = 0.30 - layer * 0.17 + wave;
        float distanceToLayer = abs(p.y - y);
        float lineWidth = 0.0006 + 0.7 / resolution.y;
        float line = exp(-distanceToLayer / lineWidth);
        float bloom = exp(-distanceToLayer * 100.0) * 0.075;
        float illumination = 0.16 + exp(-pow((x - travel) * 1.9, 2.0)) * 0.85;
        float edge = pow(1.0 - layer, 3.0);
        vec3 tint = mix(light * 0.48, vec3(0.97, 0.88, 0.70), edge);
        tint = mix(tint, vec3(0.55, 0.66, 0.84), pow(layer, 4.0) * 0.6);
        color += tint * (line + bloom) * illumination * (0.55 + edge * 0.45);
      }

      // A moving light reveals the intersections between neighboring layers.
      float beamX = sin(time * 0.16) * 0.75;
      float beamY = 0.30 + sin(beamX * 1.55 + time * 0.07) * 0.115;
      beamY += sin(beamX * 3.4 - time * 0.045) * 0.024;
      vec2 delta = p - vec2(beamX * 0.62, beamY);
      float core = exp(-length(delta * vec2(0.9, 3.0)) * 100.0);
      float halo = exp(-length(delta * vec2(1.0, 1.7)) * 15.0);
      color += vec3(1.0, 0.90, 0.72) * core * 1.2 + light * halo * 0.25;
      color *= 0.88 + 0.12 * sin(uv.x * 3.14159);
      color += (grain(gl_FragCoord.xy) - 0.5) * 0.022;
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('The motion shader could not compile.');
    }
    return shader;
  }

  let program;
  try {
    program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('The motion shader could not link.');
  } catch {
    if (program) gl.deleteProgram(program);
    return;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['resolution', 'pointer', 'time', 'perspective'].map(name => [name, gl.getUniformLocation(program, name)]));
  let elapsed = 8;
  let frame = 0;
  let previous = 0;
  let visible = true;
  let paused = preference.matches;
  let perspective = 0;
  let targetPerspective = 0;
  let pointer = [0, 0];
  let targetPointer = [0, 0];
  let contextLost = false;

  function draw() {
    if (contextLost) return;
    perspective += (targetPerspective - perspective) * 0.04;
    pointer = pointer.map((value, index) => value + (targetPointer[index] - value) * 0.04);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.pointer, ...pointer);
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform1f(uniforms.perspective, perspective);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function animate(timestamp) {
    frame = window.requestAnimationFrame(animate);
    if (timestamp - previous < 32) return;
    elapsed += Math.min(timestamp - previous, 64) / 1000;
    previous = timestamp;
    draw();
  }
  function updateMotion() {
    window.cancelAnimationFrame(frame);
    hero.dataset.motion = paused ? 'paused' : 'playing';
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation');
    toggle.querySelector('.motion-label').textContent = paused ? 'Play motion' : 'Pause motion';
    toggle.querySelector('.motion-symbol').textContent = paused ? '▷' : 'Ⅱ';
    if (!paused && visible && !document.hidden && !contextLost) {
      previous = window.performance.now(); frame = window.requestAnimationFrame(animate);
    }
  }
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.round(hero.clientWidth * ratio);
    canvas.height = Math.round(hero.clientHeight * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }
  new window.ResizeObserver(resize).observe(hero);
  new window.IntersectionObserver(entries => { visible = entries[0].isIntersecting; updateMotion(); }).observe(hero);
  hero.addEventListener('pointermove', event => {
    const bounds = hero.getBoundingClientRect();
    targetPointer = [(event.clientX - bounds.left) / bounds.width - 0.5, 0.5 - (event.clientY - bounds.top) / bounds.height];
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { targetPointer = [0, 0]; });
  document.addEventListener('sightline:client-change', event => {
    targetPerspective = { codex: 0, claude: 1, copilot: 2 }[event.detail.client] ?? 0;
    if (paused) { perspective = targetPerspective; draw(); }
  });
  toggle.onclick = () => { paused = !paused; updateMotion(); };
  preference.addEventListener('change', () => { paused = preference.matches; updateMotion(); });
  document.addEventListener('visibilitychange', updateMotion);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; window.cancelAnimationFrame(frame); hero.dataset.renderer = 'static'; toggle.hidden = true;
  });
  resize();
  hero.dataset.renderer = 'webgl';
  toggle.hidden = false;
  updateMotion();
})();

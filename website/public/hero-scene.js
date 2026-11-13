import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, GLSL3, Mesh, OrthographicCamera, RawShaderMaterial, Scene, Vector2, WebGLRenderer } from 'three';

// Each ribbon represents a configuration layer in the opening's optical section.
const screenVertex = `
    in vec3 position;
    out vec2 uv;
    void main() {
      uv = position.xy * 0.5 + 0.5;
      gl_Position = vec4(position, 1.0);
    }
  `;

const screenFragment = `
    precision highp float;
    out vec4 outputColor;
    in vec2 uv;
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
      vec3 light = mix(vec3(0.43, 0.68, 0.90), vec3(0.64, 0.86, 0.94), perspective * 0.5);
      float haze = exp(-pow((p.y - 0.27) * 5.5, 2.0) - pow(p.x * 0.75, 2.0));
      vec3 color = vec3(0.025, 0.047, 0.072) + vec3(0.06, 0.14, 0.23) * haze * 0.36;
      float beamX = sin(time * 0.16) * 0.75;
      float beamY = 0.30 + sin(beamX * 1.55 + time * 0.07) * 0.115;
      beamY += sin(beamX * 3.4 - time * 0.045) * 0.024;
      vec2 delta = p - vec2(beamX * 0.62, beamY);
      float core = exp(-length(delta * vec2(0.9, 3.0)) * 100.0);
      float halo = exp(-length(delta * vec2(1.0, 1.7)) * 15.0);
      color += vec3(0.85, 0.94, 1.0) * core * 1.2 + light * halo * 0.25;
      color *= 0.88 + 0.12 * sin(uv.x * 3.14159);
      color += (grain(gl_FragCoord.xy) - 0.5) * 0.022;
      outputColor = vec4(color, 1.0);
    }
  `;

const contourVertex = `
    precision highp float;
    in vec3 position;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform float time;
    uniform float perspective;
    out float offset;
    out vec3 tint;
    void main() {
      float layer = position.y;
      float depth = 0.62 + layer * 0.58;
      float x = ((position.x - 0.5) * resolution.x / resolution.y + pointer.x * 0.018) / depth;
      float y = 0.30 - layer * 0.17 + sin(x * 1.55 + layer * 1.9 + time * 0.07) * 0.115;
      y += sin(x * 3.4 - layer * 1.1 - time * 0.045) * 0.024;
      offset = position.z * 0.018;
      float illumination = 0.16 + exp(-pow((x - sin(time * 0.16) * 0.75) * 1.9, 2.0)) * 0.85;
      float edge = pow(1.0 - layer, 3.0);
      vec3 light = mix(vec3(0.43, 0.68, 0.90), vec3(0.64, 0.86, 0.94), perspective * 0.5);
      tint = mix(light * 0.48, vec3(0.80, 0.91, 1.0), edge);
      tint = mix(tint, vec3(0.55, 0.66, 0.84), pow(layer, 4.0) * 0.6);
      tint *= illumination * (0.55 + edge * 0.45);
      gl_Position = vec4(position.x * 2.0 - 1.0, (y - pointer.y * 0.008 + offset) * 2.0 - 1.0, 0.0, 1.0);
    }
  `;

const contourFragment = `
    precision highp float;
    out vec4 outputColor;
    uniform vec2 resolution;
    in float offset;
    in vec3 tint;
    void main() {
      float distanceToLayer = abs(offset);
      float line = exp(-distanceToLayer / (0.0006 + 0.7 / resolution.y));
      float bloom = exp(-distanceToLayer * 100.0) * 0.075;
      bloom *= 1.0 - smoothstep(0.012, 0.018, distanceToLayer);
      outputColor = vec4(tint * (line + bloom), 1.0);
    }
  `;

export function createContextField(canvas, hero) {
  const renderer = new WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: 'low-power' });
  renderer.debug.onShaderError = () => { throw new Error('The context field shader could not compile.'); };
  const scene = new Scene();
  const camera = new OrthographicCamera();
  const uniforms = {
    resolution: { value: new Vector2(1, 1) },
    pointer: { value: new Vector2() },
    time: { value: 8 },
    perspective: { value: 0 },
  };
  const targetPointer = new Vector2();
  let targetPerspective = 0;
  let disposed = false;
  const screen = new BufferGeometry();
  screen.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0], 3));
  const vertices = [];
  for (let layer = 0; layer < 46; layer++) {
    for (let segment = 0; segment < 128; segment++) {
      const left = segment / 128;
      const right = (segment + 1) / 128;
      const depth = layer / 45;
      vertices.push(left, depth, -1, right, depth, -1, left, depth, 1, left, depth, 1, right, depth, -1, right, depth, 1);
    }
  }
  const contours = new BufferGeometry();
  contours.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  const backgroundMaterial = new RawShaderMaterial({ glslVersion: GLSL3, uniforms, vertexShader: screenVertex, fragmentShader: screenFragment, depthTest: false, depthWrite: false });
  const contourMaterial = new RawShaderMaterial({ glslVersion: GLSL3, uniforms, vertexShader: contourVertex, fragmentShader: contourFragment, transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false });
  const background = new Mesh(screen, backgroundMaterial);
  const ribbons = new Mesh(contours, contourMaterial);
  background.frustumCulled = false;
  ribbons.frustumCulled = false;
  ribbons.renderOrder = 1;
  scene.add(background, ribbons);

  function render(delta = 0) {
    if (disposed) return;
    uniforms.time.value += Math.min(delta, 0.064);
    const blend = 1 - Math.exp(-delta * 4);
    uniforms.pointer.value.lerp(targetPointer, blend);
    uniforms.perspective.value += (targetPerspective - uniforms.perspective.value) * blend;
    renderer.render(scene, camera);
  }
  function resize() {
    const width = hero.clientWidth;
    const height = hero.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(1_200_000 / (width * height)));
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    uniforms.resolution.value.set(canvas.width, canvas.height);
    render();
  }
  function dispose() {
    disposed = true;
    screen.dispose();
    contours.dispose();
    backgroundMaterial.dispose();
    contourMaterial.dispose();
    renderer.dispose();
  }
  try { resize(); } catch (error) { dispose(); throw error; }
  return {
    render,
    resize,
    dispose,
    point(x, y) { targetPointer.set(x, y); },
    select(client) {
      targetPerspective = { codex: 0, claude: 1, copilot: 2 }[client] ?? 0;
      uniforms.perspective.value = targetPerspective;
      render();
    },
  };
}

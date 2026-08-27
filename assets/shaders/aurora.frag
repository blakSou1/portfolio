precision highp float;
uniform float u_time;
uniform vec2 u_resolution;

// Aurora — живой фрагментный шейдер (GLSL, WebGL1)
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.25;
  vec3 col = vec3(0.02, 0.03, 0.08);

  for (float i = 0.0; i < 3.0; i++) {
    float band = 0.25 + i * 0.18;
    float wave = sin(uv.x * 3.0 + t + i) * 0.08
               + sin(uv.x * 7.0 - t * 1.3 + i * 2.0) * 0.04;
    float d = abs(uv.y - band - wave);
    float glow = exp(-d * 22.0);
    vec3 c = mix(vec3(0.1, 0.9, 0.7), vec3(0.6, 0.3, 1.0), i / 2.0);
    col += c * glow * 0.9;
  }

  // звёзды
  float s = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
  col += step(0.998, s) * vec3(0.8);

  gl_FragColor = vec4(col, 1.0);
}

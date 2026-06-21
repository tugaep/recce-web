import React, { useEffect, useRef } from "react";
import {
  Vector2,
  Scene,
  OrthographicCamera,
  WebGLRenderer,
  Vector3,
  ShaderMaterial,
  PlaneGeometry,
  Mesh,
  Clock,
} from "three";

interface WavePosition {
  x: number;
  y: number;
  rotate: number;
}

interface FloatingLinesProps {
  linesGradient?: string[];
  enabledWaves?: string[]; // Array containing 'top', 'middle', 'bottom'
  lineCount?: number | number[]; // e.g. [6] or 6
  lineDistance?: number | number[]; // e.g. [5] or 5
  topWavePosition?: Partial<WavePosition>;
  middleWavePosition?: Partial<WavePosition>;
  bottomWavePosition?: Partial<WavePosition>;
  animationSpeed?: number;
  interactive?: boolean;
  bendRadius?: number;
  bendStrength?: number;
  mouseDamping?: number;
  parallax?: boolean;
  parallaxStrength?: number;
  mixBlendMode?: React.CSSProperties["mixBlendMode"];
}

const vertexShader = `
precision highp float;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec3  iResolution;
uniform float animationSpeed;

uniform bool enableTop;
uniform bool enableMiddle;
uniform bool enableBottom;

uniform int topLineCount;
uniform int middleLineCount;
uniform int bottomLineCount;

uniform float topLineDistance;
uniform float middleLineDistance;
uniform float bottomLineDistance;

uniform vec3 topWavePosition;
uniform vec3 middleWavePosition;
uniform vec3 bottomWavePosition;

uniform vec2 iMouse;
uniform bool interactive;
uniform float bendRadius;
uniform float bendStrength;
uniform float bendInfluence;

uniform bool parallax;
uniform float parallaxStrength;
uniform vec2 parallaxOffset;

uniform vec3 lineGradient[8];
uniform int lineGradientCount;

const vec3 BLACK = vec3(0.0);
const vec3 PINK  = vec3(233.0, 71.0, 245.0) / 255.0;
const vec3 BLUE  = vec3(47.0,  75.0, 162.0) / 255.0;

mat2 rotate(float r) {
  return mat2(cos(r), sin(r), -sin(r), cos(r));
}

vec3 background_color(vec2 uv) {
  vec3 col = vec3(0.0);

  float y = sin(uv.x - 0.2) * 0.3 - 0.1;
  float m = uv.y - y;

  col += mix(BLUE, BLACK, smoothstep(0.0, 1.0, abs(m)));
  col += mix(PINK, BLACK, smoothstep(0.0, 1.0, abs(m - 0.8)));
  return col * 0.5;
}

vec3 getLineColor(float t, vec3 baseColor) {
  if (lineGradientCount <= 0) {
    return baseColor;
  }

  vec3 gradientColor;
  
  if (lineGradientCount == 1) {
    gradientColor = lineGradient[0];
  } else {
    float clampedT = clamp(t, 0.0, 0.9999);
    float scaled = clampedT * float(lineGradientCount - 1);
    int idx = int(floor(scaled));
    float f = fract(scaled);
    int idx2 = min(idx + 1, lineGradientCount - 1);

    vec3 c1 = lineGradient[idx];
    vec3 c2 = lineGradient[idx2];
    
    gradientColor = mix(c1, c2, f);
  }
  
  return gradientColor * 0.5;
}

float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv, bool shouldBend) {
  float time = iTime * animationSpeed;

  float x_offset   = offset;
  float x_movement = time * 0.1;
  float amp        = sin(offset + time * 0.2) * 0.3;
  float y          = sin(uv.x + x_offset + x_movement) * amp;

  if (shouldBend) {
    vec2 d = screenUv - mouseUv;
    float influence = exp(-dot(d, d) * bendRadius); // radial falloff around cursor
    float bendOffset = (mouseUv.y - screenUv.y) * influence * bendStrength * bendInfluence;
    y += bendOffset;
  }

  float m = uv.y - y;
  return 0.0175 / max(abs(m) + 0.01, 1e-3) + 0.01;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 baseUv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  baseUv.y *= -1.0;
  
  if (parallax) {
    baseUv += parallaxOffset;
  }

  vec3 col = vec3(0.0);

  vec3 b = lineGradientCount > 0 ? vec3(0.0) : background_color(baseUv);

  vec2 mouseUv = vec2(0.0);
  if (interactive) {
    mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y;
    mouseUv.y *= -1.0;
  }
  
  if (enableBottom) {
    for (int i = 0; i < bottomLineCount; ++i) {
      float fi = float(i);
      float t = fi / max(float(bottomLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      
      float angle = bottomWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      col += lineCol * wave(
        ruv + vec2(bottomLineDistance * fi + bottomWavePosition.x, bottomWavePosition.y),
        1.5 + 0.2 * fi,
        baseUv,
        mouseUv,
        interactive
      ) * 0.2;
    }
  }

  if (enableMiddle) {
    for (int i = 0; i < middleLineCount; ++i) {
      float fi = float(i);
      float t = fi / max(float(middleLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      
      float angle = middleWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      col += lineCol * wave(
        ruv + vec2(middleLineDistance * fi + middleWavePosition.x, middleWavePosition.y),
        2.0 + 0.15 * fi,
        baseUv,
        mouseUv,
        interactive
      );
    }
  }

  if (enableTop) {
    for (int i = 0; i < topLineCount; ++i) {
      float fi = float(i);
      float t = fi / max(float(topLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      
      float angle = topWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      ruv.x *= -1.0;
      col += lineCol * wave(
        ruv + vec2(topLineDistance * fi + topWavePosition.x, topWavePosition.y),
        1.0 + 0.2 * fi,
        baseUv,
        mouseUv,
        interactive
      ) * 0.1;
    }
  }

  fragColor = vec4(col, 1.0);
}

void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;

const MAX_GRADIENT_COLORS = 8;

function hexToRgbVector(hex: string): Vector3 {
  let cleaned = hex.trim();
  if (cleaned.startsWith("#")) {
    cleaned = cleaned.slice(1);
  }
  let r = 255, g = 255, b = 255;
  if (cleaned.length === 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else if (cleaned.length === 6) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  }
  return new Vector3(r / 255, g / 255, b / 255);
}

const FloatingLines: React.FC<FloatingLinesProps> = ({
  linesGradient,
  enabledWaves = ["top", "middle", "bottom"],
  lineCount = [6],
  lineDistance = [5],
  topWavePosition,
  middleWavePosition,
  bottomWavePosition = { x: 2, y: -0.7, rotate: -1 },
  animationSpeed = 1,
  interactive = true,
  bendRadius = 5,
  bendStrength = -0.5,
  mouseDamping = 0.05,
  parallax = true,
  parallaxStrength = 0.2,
  mixBlendMode = "screen",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerPos = useRef(new Vector2(-1000, -1000));
  const lerpedPointerPos = useRef(new Vector2(-1000, -1000));
  const bendInfluence = useRef(0);
  const targetBendInfluence = useRef(0);
  const parallaxOffset = useRef(new Vector2(0, 0));
  const lerpedParallaxOffset = useRef(new Vector2(0, 0));

  const getLineCount = (waveType: string) => {
    if (typeof lineCount === "number") return lineCount;
    if (!enabledWaves.includes(waveType)) return 0;
    const idx = enabledWaves.indexOf(waveType);
    return lineCount[idx] ?? 6;
  };

  const getLineDistance = (waveType: string) => {
    if (typeof lineDistance === "number") return lineDistance;
    if (!enabledWaves.includes(waveType)) return 0.01;
    const idx = enabledWaves.indexOf(waveType);
    return (lineDistance[idx] ?? 0.1) * 0.01;
  };

  const q = enabledWaves.includes("top") ? getLineCount("top") : 0;
  const Q = enabledWaves.includes("middle") ? getLineCount("middle") : 0;
  const Z = enabledWaves.includes("bottom") ? getLineCount("bottom") : 0;

  const topLineDistanceVal = enabledWaves.includes("top") ? getLineDistance("top") : 0.01;
  const middleLineDistanceVal = enabledWaves.includes("middle") ? getLineDistance("middle") : 0.01;
  const bottomLineDistanceVal = enabledWaves.includes("bottom") ? getLineDistance("bottom") : 0.01;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isAlive = true;
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new Vector3(1, 1, 1) },
      animationSpeed: { value: animationSpeed },
      enableTop: { value: enabledWaves.includes("top") },
      enableMiddle: { value: enabledWaves.includes("middle") },
      enableBottom: { value: enabledWaves.includes("bottom") },
      topLineCount: { value: q },
      middleLineCount: { value: Q },
      bottomLineCount: { value: Z },
      topLineDistance: { value: topLineDistanceVal },
      middleLineDistance: { value: middleLineDistanceVal },
      bottomLineDistance: { value: bottomLineDistanceVal },
      topWavePosition: {
        value: new Vector3(
          topWavePosition?.x ?? 10,
          topWavePosition?.y ?? 0.5,
          topWavePosition?.rotate ?? -0.4
        )
      },
      middleWavePosition: {
        value: new Vector3(
          middleWavePosition?.x ?? 5,
          middleWavePosition?.y ?? 0,
          middleWavePosition?.rotate ?? 0.2
        )
      },
      bottomWavePosition: {
        value: new Vector3(
          bottomWavePosition?.x ?? 2,
          bottomWavePosition?.y ?? -0.7,
          bottomWavePosition?.rotate ?? 0.4
        )
      },
      iMouse: { value: new Vector2(-1000, -1000) },
      interactive: { value: interactive },
      bendRadius: { value: bendRadius },
      bendStrength: { value: bendStrength },
      bendInfluence: { value: 0 },
      parallax: { value: parallax },
      parallaxStrength: { value: parallaxStrength },
      parallaxOffset: { value: new Vector2(0, 0) },
      lineGradient: {
        value: Array.from({ length: MAX_GRADIENT_COLORS }, () => new Vector3(1, 1, 1))
      },
      lineGradientCount: { value: 0 }
    };

    if (linesGradient && linesGradient.length > 0) {
      const gradientColors = linesGradient.slice(0, MAX_GRADIENT_COLORS);
      uniforms.lineGradientCount.value = gradientColors.length;
      gradientColors.forEach((colorHex, idx) => {
        const colorVec = hexToRgbVector(colorHex);
        uniforms.lineGradient.value[idx].copy(colorVec);
      });
    }

    const material = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader
    });

    const geometry = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    const clock = new Clock();

    const resize = () => {
      if (!isAlive) return;
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      const canvasWidth = renderer.domElement.width;
      const canvasHeight = renderer.domElement.height;
      uniforms.iResolution.value.set(canvasWidth, canvasHeight, 1);
    };
    resize();

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => { if (isAlive) resize(); })
      : null;
    resizeObserver?.observe(container);

    const onPointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const pixelRatio = renderer.getPixelRatio();
      pointerPos.current.set(x * pixelRatio, (rect.height - y) * pixelRatio);
      targetBendInfluence.current = 1;

      if (parallax) {
        const halfWidth = rect.width / 2;
        const halfHeight = rect.height / 2;
        const px = (x - halfWidth) / rect.width;
        const py = -(y - halfHeight) / rect.height;
        parallaxOffset.current.set(px * parallaxStrength, py * parallaxStrength);
      }
    };

    const onPointerLeave = () => {
      targetBendInfluence.current = 0;
    };

    if (interactive) {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerleave", onPointerLeave);
    }

    let animationFrameId = 0;
    const animate = () => {
      if (!isAlive) return;
      uniforms.iTime.value = clock.getElapsedTime();

      if (interactive) {
        lerpedPointerPos.current.lerp(pointerPos.current, mouseDamping);
        uniforms.iMouse.value.copy(lerpedPointerPos.current);
        bendInfluence.current += (targetBendInfluence.current - bendInfluence.current) * mouseDamping;
        uniforms.bendInfluence.value = bendInfluence.current;
      }

      if (parallax) {
        lerpedParallaxOffset.current.lerp(parallaxOffset.current, mouseDamping);
        uniforms.parallaxOffset.value.copy(lerpedParallaxOffset.current);
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      isAlive = false;
      cancelAnimationFrame(animationFrameId);
      resizeObserver?.disconnect();
      if (interactive) {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerleave", onPointerLeave);
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [
    linesGradient,
    enabledWaves,
    lineCount,
    lineDistance,
    topWavePosition,
    middleWavePosition,
    bottomWavePosition,
    animationSpeed,
    interactive,
    bendRadius,
    bendStrength,
    mouseDamping,
    parallax,
    parallaxStrength
  ]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      style={{ mixBlendMode }}
    />
  );
};

export default FloatingLines;

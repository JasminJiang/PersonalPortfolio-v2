import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Group, Mesh, MeshBasicMaterial, Texture } from "three";
import { AdditiveBlending, DoubleSide, LinearFilter, MathUtils, SRGBColorSpace, TextureLoader } from "three";
import type { CarouselProject } from "./ProjectCarousel";
import {
  type CarouselNavigationCommand,
  nextWheelMotionTarget,
  subscribeCarouselWheelMotion,
} from "./carouselMotion";
import { coverTextureCrop } from "./carouselTexture";

const FULL_TURN = Math.PI * 2;
const CAROUSEL_RADIUS = 30;
const WHEEL_FOLLOW_DAMPING = 5;
const TEXTURE_WINDOW_RADIUS = 3;
const ACTIVE_SETTLE_DELAY_MS = 180;
const TEXTURE_SETTLE_DELAY_MS = 260;
const TEXTURE_CACHE_SIZE = 10;
const PANEL_WIDTH = 8;
const PANEL_HEIGHT = 4.5;

interface Props {
  projects: CarouselProject[];
  slotCount: number;
  navigationCommand: CarouselNavigationCommand;
  openingIndex: number | null;
  reducedMotion: boolean;
  compactTextures: boolean;
  onSelect: (index: number) => void;
  onActive: (index: number) => void;
  onReady: () => void;
  onTextureReady: () => void;
  onContextLost: () => void;
}

interface TexturePoolEntry {
  source: string;
  texture: Texture | null;
  status: "idle" | "loading" | "ready" | "error";
  listeners: Set<() => void>;
  lastUsed: number;
}

interface CarouselTexturePool {
  get: (source: string) => Texture | null;
  subscribe: (source: string, listener: () => void) => () => void;
  trim: (protectedSources: Set<string>) => void;
  setTextureInitializer: (initializer?: (texture: Texture) => void) => void;
  dispose: () => void;
}

function applyCoverCrop(texture: Texture) {
  const image = texture.image as {
    height?: number;
    naturalHeight?: number;
    naturalWidth?: number;
    width?: number;
  } | undefined;
  const imageWidth = image?.naturalWidth ?? image?.width ?? 0;
  const imageHeight = image?.naturalHeight ?? image?.height ?? 0;
  const crop = coverTextureCrop(imageWidth, imageHeight, PANEL_WIDTH, PANEL_HEIGHT);
  texture.repeat.set(crop.repeatX, crop.repeatY);
  texture.offset.set(crop.offsetX, crop.offsetY);
  texture.updateMatrix();
}

function createCarouselTexturePool(maxEntries: number): CarouselTexturePool {
  const entries = new Map<string, TexturePoolEntry>();
  const loader = new TextureLoader();
  loader.setCrossOrigin("anonymous");
  let disposed = false;
  let protectedSources = new Set<string>();
  let textureInitializer: ((texture: Texture) => void) | undefined;

  const emit = (entry: TexturePoolEntry) => entry.listeners.forEach((listener) => listener());

  const evict = () => {
    if (entries.size <= maxEntries) return;
    const candidates = [...entries.values()]
      .filter((entry) => entry.listeners.size === 0 && !protectedSources.has(entry.source) && entry.status !== "loading")
      .sort((left, right) => left.lastUsed - right.lastUsed);

    while (entries.size > maxEntries) {
      const entry = candidates.shift();
      if (!entry) break;
      entry.texture?.dispose();
      entries.delete(entry.source);
    }
  };

  const beginLoad = (entry: TexturePoolEntry) => {
    if (disposed || entry.status === "loading" || entry.status === "ready") return;
    entry.status = "loading";
    const retryUrl = new URL(entry.source);
    retryUrl.searchParams.set("texture-retry", "1");
    const sources = [entry.source, retryUrl.toString()];

    const loadSource = (sourceIndex: number) => {
      const source = sources[sourceIndex];
      if (!source) return;
      loader.load(source, (texture) => {
        if (disposed || entries.get(entry.source) !== entry) {
          texture.dispose();
          return;
        }
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.generateMipmaps = false;
        applyCoverCrop(texture);
        entry.texture = texture;
        entry.status = "ready";
        entry.lastUsed = performance.now();
        textureInitializer?.(texture);
        emit(entry);
        evict();
      }, undefined, () => {
        if (disposed || entries.get(entry.source) !== entry) return;
        if (sourceIndex + 1 < sources.length) {
          loadSource(sourceIndex + 1);
          return;
        }
        entry.status = "error";
        emit(entry);
        evict();
      });
    };

    loadSource(0);
  };

  const ensureEntry = (source: string) => {
    const existing = entries.get(source);
    if (existing) return existing;
    const entry: TexturePoolEntry = {
      source,
      texture: null,
      status: "idle",
      listeners: new Set(),
      lastUsed: performance.now(),
    };
    entries.set(source, entry);
    return entry;
  };

  return {
    get(source) {
      const entry = entries.get(source);
      if (!entry) return null;
      entry.lastUsed = performance.now();
      return entry.texture;
    },
    subscribe(source, listener) {
      const entry = ensureEntry(source);
      entry.lastUsed = performance.now();
      entry.listeners.add(listener);
      beginLoad(entry);
      return () => {
        entry.listeners.delete(listener);
        entry.lastUsed = performance.now();
        evict();
      };
    },
    trim(nextProtectedSources) {
      protectedSources = nextProtectedSources;
      evict();
    },
    setTextureInitializer(initializer) {
      textureInitializer = initializer;
      if (initializer) {
        entries.forEach((entry) => {
          if (entry.texture) initializer(entry.texture);
        });
      }
    },
    dispose() {
      disposed = true;
      textureInitializer = undefined;
      entries.forEach((entry) => entry.texture?.dispose());
      entries.clear();
    },
  };
}

function useCarouselTexture(pool: CarouselTexturePool, source?: string) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    if (!source) return;
    return pool.subscribe(source, refresh);
  }, [pool, source]);

  return source ? pool.get(source) : null;
}

function circularIndexDistance(left: number, right: number, length: number) {
  if (length <= 1) return 0;
  const direct = Math.abs(left - right);
  return Math.min(direct, length - direct);
}

function rotationForIndex(index: number, slotCount: number) {
  return Math.PI + (index / Math.max(slotCount, 1)) * FULL_TURN;
}

const CarouselPanel = memo(function CarouselPanel({
  index,
  slotCount,
  opening,
  dimmed,
  coverSrc,
  texturePool,
  reducedMotion,
  onSelect,
  onTextureReady,
  onHoverChange,
}: {
  index: number;
  slotCount: number;
  opening: boolean;
  dimmed: boolean;
  coverSrc?: string;
  texturePool: CarouselTexturePool;
  reducedMotion: boolean;
  onSelect: (index: number) => void;
  onTextureReady: (index: number) => void;
  onHoverChange: (hovered: boolean) => void;
}) {
  const panel = useRef<Mesh>(null);
  const surface = useRef<MeshBasicMaterial>(null);
  const innerGlow = useRef<MeshBasicMaterial>(null);
  const outerGlow = useRef<MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const invalidate = useThree((state) => state.invalidate);
  const texture = useCarouselTexture(texturePool, coverSrc);
  const angle = -((index / slotCount) * FULL_TURN);
  const x = Math.sin(angle) * CAROUSEL_RADIUS;
  const z = Math.cos(angle) * CAROUSEL_RADIUS;

  useEffect(() => {
    invalidate();
  }, [coverSrc, invalidate, reducedMotion, texture]);

  useEffect(() => () => onHoverChange(false), [onHoverChange]);

  useEffect(() => {
    if (texture) onTextureReady(index);
  }, [index, onTextureReady, texture]);

  useFrame((_, delta) => {
    if (!panel.current || !surface.current) return;
    const scale = opening ? 2.9 : hovered && !dimmed ? 1.035 : 1;
    const targetOpacity = dimmed ? 0 : 1;
    const innerGlowOpacity = hovered && !opening && !dimmed ? 0.24 : 0;
    const outerGlowOpacity = hovered && !opening && !dimmed ? 0.12 : 0;
    if (reducedMotion) {
      panel.current.scale.set(scale, scale, 1);
      surface.current.opacity = targetOpacity;
      if (innerGlow.current) innerGlow.current.opacity = 0;
      if (outerGlow.current) outerGlow.current.opacity = 0;
      return;
    }
    panel.current.scale.x = MathUtils.damp(panel.current.scale.x, scale, 7, delta);
    panel.current.scale.y = MathUtils.damp(panel.current.scale.y, scale, 7, delta);
    surface.current.opacity = MathUtils.damp(surface.current.opacity, targetOpacity, 8, delta);
    if (innerGlow.current) {
      innerGlow.current.opacity = MathUtils.damp(innerGlow.current.opacity, innerGlowOpacity, 8, delta);
    }
    if (outerGlow.current) {
      outerGlow.current.opacity = MathUtils.damp(outerGlow.current.opacity, outerGlowOpacity, 7, delta);
    }
    if (
      Math.abs(panel.current.scale.x - scale) > 0.0005
      || Math.abs(surface.current.opacity - targetOpacity) > 0.0005
      || Math.abs((innerGlow.current?.opacity ?? 0) - innerGlowOpacity) > 0.0005
      || Math.abs((outerGlow.current?.opacity ?? 0) - outerGlowOpacity) > 0.0005
    ) {
      invalidate();
    }
  });

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(index);
  };

  if (!texture) return null;

  return (
    <group position={[x, 0, z]} rotation={[0, angle + Math.PI, 0]}>
      <mesh position={[0, 0, -0.12]}>
        <planeGeometry args={[9.4, 5.8]} />
        <meshBasicMaterial
          ref={outerGlow}
          color="#bcd8ff"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>

      <mesh position={[0, 0, -0.06]}>
        <planeGeometry args={[8.8, 5.2]} />
        <meshBasicMaterial
          ref={innerGlow}
          color="#ffffff"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>

      <mesh
        ref={panel}
        onClick={handleSelect}
        onPointerOver={(event) => {
          event.stopPropagation();
          setHovered(true);
          onHoverChange(true);
          invalidate();
        }}
        onPointerOut={() => {
          setHovered(false);
          onHoverChange(false);
          invalidate();
        }}
      >
        <planeGeometry args={[PANEL_WIDTH, PANEL_HEIGHT, 24, 1]} />
        <meshBasicMaterial
          ref={surface}
          color="#ffffff"
          map={texture}
          transparent
          depthWrite={false}
          side={DoubleSide}
        />

      </mesh>
    </group>
  );
});

function CarouselRing({
  projects,
  slotCount,
  navigationCommand,
  openingIndex,
  reducedMotion,
  compactTextures,
  texturePool,
  onSelect,
  onActive,
  onTextureReady,
  onHoverChange,
}: Omit<Props, "onReady" | "onContextLost"> & {
  texturePool: CarouselTexturePool;
  onHoverChange: (hovered: boolean) => void;
}) {
  const initialIndex = projects.length > 0
    ? (navigationCommand.index + projects.length) % projects.length
    : 0;
  const [initialRotation] = useState(() => rotationForIndex(initialIndex, slotCount));
  const ring = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const motionTarget = useRef(initialRotation);
  const lastInputDirection = useRef(0);
  const commandMotionActive = useRef(false);
  const handledCommandId = useRef(navigationCommand.id);
  const visualActiveIndex = useRef(initialIndex);
  const reportedActiveIndex = useRef(initialIndex);
  const activeSettleTimer = useRef<number | undefined>(undefined);
  const textureCenterRef = useRef(initialIndex);
  const pendingTextureCenter = useRef(initialIndex);
  const textureSettleTimer = useRef<number | undefined>(undefined);
  const [textureCenter, setTextureCenter] = useState(initialIndex);

  const commitTextureCenter = useCallback((index: number) => {
    if (textureCenterRef.current === index) return;
    textureCenterRef.current = index;
    setTextureCenter(index);
  }, []);

  const scheduleTextureCenter = useCallback((index = pendingTextureCenter.current) => {
    pendingTextureCenter.current = index;
    if (textureSettleTimer.current !== undefined) window.clearTimeout(textureSettleTimer.current);
    textureSettleTimer.current = window.setTimeout(() => {
      commitTextureCenter(pendingTextureCenter.current);
    }, TEXTURE_SETTLE_DELAY_MS);
  }, [commitTextureCenter]);

  const scheduleActiveReport = useCallback(() => {
    if (activeSettleTimer.current !== undefined) window.clearTimeout(activeSettleTimer.current);
    activeSettleTimer.current = window.setTimeout(() => {
      const index = visualActiveIndex.current;
      if (reportedActiveIndex.current === index) return;
      reportedActiveIndex.current = index;
      onActive(index);
    }, ACTIVE_SETTLE_DELAY_MS);
  }, [onActive]);

  const sourceForIndex = useCallback((index: number) => {
    const project = projects[index];
    if (!project) return undefined;
    return compactTextures ? project.compactSrc : project.previewSrc;
  }, [compactTextures, projects]);

  const handleTextureReady = useCallback((index: number) => {
    if (index === visualActiveIndex.current) onTextureReady();
  }, [onTextureReady]);

  const residentSources = useMemo(() => new Set(
    projects.flatMap((project, index) => circularIndexDistance(index, textureCenter, projects.length) <= TEXTURE_WINDOW_RADIUS
      ? [compactTextures ? project.compactSrc : project.previewSrc]
      : []),
  ), [compactTextures, projects, textureCenter]);

  useEffect(() => {
    texturePool.trim(residentSources);
  }, [residentSources, texturePool]);

  useEffect(() => {
    if (handledCommandId.current === navigationCommand.id || projects.length === 0) return;
    handledCommandId.current = navigationCommand.id;
    const index = (navigationCommand.index + projects.length) % projects.length;
    const current = ring.current?.rotation.y ?? motionTarget.current;
    const baseTarget = rotationForIndex(index, slotCount);
    const turns = Math.round((current - baseTarget) / FULL_TURN);
    motionTarget.current = baseTarget + turns * FULL_TURN;
    lastInputDirection.current = 0;
    commandMotionActive.current = true;
    visualActiveIndex.current = index;
    reportedActiveIndex.current = index;
    if (activeSettleTimer.current !== undefined) window.clearTimeout(activeSettleTimer.current);
    pendingTextureCenter.current = index;
    commitTextureCenter(index);
    if (reducedMotion && ring.current) ring.current.rotation.y = motionTarget.current;
    const source = sourceForIndex(index);
    if (source && texturePool.get(source)) onTextureReady();
    invalidate();
  }, [commitTextureCenter, invalidate, navigationCommand.id, navigationCommand.index, onTextureReady, projects.length, reducedMotion, slotCount, sourceForIndex, texturePool]);

  useEffect(() => {
    return subscribeCarouselWheelMotion((detail) => {
      if (reducedMotion || openingIndex !== null || document.hidden) return;
      if (!detail || !Number.isFinite(detail.delta)) return;
      const current = ring.current?.rotation.y ?? motionTarget.current;
      const nextMotion = nextWheelMotionTarget({
        current,
        target: motionTarget.current,
        delta: detail.delta,
        step: FULL_TURN / Math.max(slotCount, 1),
        lastDirection: lastInputDirection.current,
      });
      motionTarget.current = nextMotion.target;
      lastInputDirection.current = nextMotion.direction;
      commandMotionActive.current = false;
      scheduleActiveReport();
      scheduleTextureCenter();
      invalidate();
    });
  }, [invalidate, openingIndex, reducedMotion, scheduleActiveReport, scheduleTextureCenter, slotCount]);

  useEffect(() => () => {
    if (activeSettleTimer.current !== undefined) window.clearTimeout(activeSettleTimer.current);
    if (textureSettleTimer.current !== undefined) window.clearTimeout(textureSettleTimer.current);
  }, []);

  useFrame((_, delta) => {
    if (!ring.current) return;
    const current = ring.current.rotation.y;
    const nextTarget = motionTarget.current;
    if (reducedMotion) {
      ring.current.rotation.y = nextTarget;
    } else {
      ring.current.rotation.y = MathUtils.damp(current, nextTarget, WHEEL_FOLLOW_DAMPING, delta);
    }

    if (commandMotionActive.current) {
      if (Math.abs(ring.current.rotation.y - nextTarget) <= 0.002) {
        commandMotionActive.current = false;
      }
    } else if (openingIndex === null && projects.length > 0) {
      const step = FULL_TURN / Math.max(slotCount, 1);
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      projects.forEach((_, index) => {
        const baseRotation = Math.PI + index * step;
        const turns = Math.round((ring.current!.rotation.y - baseRotation) / FULL_TURN);
        const distance = Math.abs(ring.current!.rotation.y - (baseRotation + turns * FULL_TURN));
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      if (nearestIndex !== visualActiveIndex.current) {
        visualActiveIndex.current = nearestIndex;
        scheduleActiveReport();
        scheduleTextureCenter(nearestIndex);
        const source = sourceForIndex(nearestIndex);
        if (source && texturePool.get(source)) onTextureReady();
      }
    }
    if (Math.abs(ring.current.rotation.y - nextTarget) > 0.0005) invalidate();
  });

  return (
    <group ref={ring} position={[0, -1.15, 0]} rotation={[0, initialRotation, 0]}>
      {projects.map((project, index) => {
        const textureResident = circularIndexDistance(index, textureCenter, projects.length) <= TEXTURE_WINDOW_RADIUS;
        return (
          <CarouselPanel
            key={project.slug}
            index={index}
            slotCount={slotCount}
            opening={index === openingIndex}
            dimmed={openingIndex !== null && index !== openingIndex}
            coverSrc={textureResident ? (compactTextures ? project.compactSrc : project.previewSrc) : undefined}
            texturePool={texturePool}
            reducedMotion={reducedMotion}
            onSelect={onSelect}
            onTextureReady={handleTextureReady}
            onHoverChange={onHoverChange}
          />
        );
      })}
    </group>
  );
}

function ProjectCarouselScene({
  projects,
  slotCount,
  navigationCommand,
  openingIndex,
  reducedMotion,
  compactTextures,
  onSelect,
  onActive,
  onReady,
  onTextureReady,
  onContextLost,
}: Props) {
  const canvasCamera = useMemo(() => ({ position: [0, 0, 5] as [number, number, number], fov: 36 }), []);
  const texturePool = useMemo(() => createCarouselTexturePool(TEXTURE_CACHE_SIZE), []);
  const [panelHovered, setPanelHovered] = useState(false);

  useEffect(() => () => texturePool.dispose(), [texturePool]);

  return (
    <Canvas
      camera={canvasCamera}
      dpr={[1, 1.5]}
      frameloop="demand"
      style={{ cursor: panelHovered ? "pointer" : "default" }}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        texturePool.setTextureInitializer((texture) => gl.initTexture(texture));
        gl.domElement.addEventListener("webglcontextlost", onContextLost, { once: true });
        onReady();
      }}
    >
      <color attach="background" args={["#ffffff"]} />
      <CarouselRing
        projects={projects}
        slotCount={slotCount}
        navigationCommand={navigationCommand}
        openingIndex={openingIndex}
        reducedMotion={reducedMotion}
        compactTextures={compactTextures}
        texturePool={texturePool}
        onSelect={onSelect}
        onActive={onActive}
        onTextureReady={onTextureReady}
        onHoverChange={setPanelHovered}
      />
    </Canvas>
  );
}

export default memo(ProjectCarouselScene);

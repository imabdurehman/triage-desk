import { useEffect, useRef } from 'react';
import {
  BoxGeometry,
  Clock,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

// Tickets arrive on a belt, pass the sorting gate (the model), and only then get
// a priority colour and turn into their lane. Before the gate every tag is grey:
// nobody knows how urgent a ticket is until it has been triaged.
const LANES = [
  { color: 0xc0392b, x: -2.7, share: 0.14 }, // urgent
  { color: 0xd9731a, x: -0.9, share: 0.28 }, // high
  { color: 0xb8941f, x: 0.9, share: 0.38 }, // medium
  { color: 0x3e8e5e, x: 2.7, share: 0.2 }, // low
];
const START_Z = -9;
const GATE_Z = -2;
const END_Z = 7;
const TICKETS = 18;
const SECONDS_PER_TRIP = 9;

function pickLane() {
  let r = Math.random();
  for (let i = 0; i < LANES.length; i += 1) {
    r -= LANES[i].share;
    if (r < 0) return i;
  }
  return LANES.length - 1;
}

export default function TriageScene() {
  const host = useRef(null);

  useEffect(() => {
    const el = host.current;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    scene.fog = new Fog(0x16202a, 15, 28);
    const camera = new PerspectiveCamera(30, 1, 0.1, 60);
    scene.add(new HemisphereLight(0xe4ebf2, 0x16202a, 1.5));
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(5, 11, 7);
    scene.add(sun);

    const owned = [];
    const own = (resource) => {
      owned.push(resource);
      return resource;
    };
    const standard = (color, extra) =>
      own(new MeshStandardMaterial({ color, roughness: 0.75, ...extra }));

    const belt = new Mesh(own(new BoxGeometry(1.4, 0.05, GATE_Z - START_Z + 1)),
                                standard(0x2b3a48));
    belt.position.set(0, -0.03, (START_Z + GATE_Z) / 2);
    scene.add(belt);

    const laneGeometry = own(new BoxGeometry(1.4, 0.04, END_Z - GATE_Z));
    for (const lane of LANES) {
      const strip = new Mesh(laneGeometry, standard(lane.color, { transparent: true, opacity: 0.32 }));
      strip.position.set(lane.x, -0.03, (GATE_Z + END_Z) / 2 + 1.5);
      scene.add(strip);
    }

    const gateMaterial = standard(0x5b8fc4, { emissive: 0x1c5d99, emissiveIntensity: 0.35 });
    const post = own(new BoxGeometry(0.12, 1.4, 0.12));
    for (const x of [-0.95, 0.95]) {
      const p = new Mesh(post, gateMaterial);
      p.position.set(x, 0.7, GATE_Z);
      scene.add(p);
    }
    const beam = new Mesh(own(new BoxGeometry(2.02, 0.12, 0.12)), gateMaterial);
    beam.position.set(0, 1.4, GATE_Z);
    scene.add(beam);

    const card = own(new BoxGeometry(1.0, 0.07, 0.64));
    const tagShape = own(new BoxGeometry(0.2, 0.078, 0.64));
    const paper = standard(0xf3f5f7, { roughness: 0.55 });
    const untriaged = standard(0x8a96a3);
    const tagColours = LANES.map((lane) => standard(lane.color, { roughness: 0.45 }));

    const tickets = Array.from({ length: TICKETS }, (_, i) => {
      const group = new Group();
      group.add(new Mesh(card, paper));
      const tag = new Mesh(tagShape, untriaged);
      tag.position.x = -0.4;
      group.add(tag);
      scene.add(group);
      return { group, tag, lane: pickLane(), offset: i / TICKETS, previous: 1 };
    });

    const place = (ticket, progress) => {
      const z = START_Z + progress * (END_Z - START_Z);
      const turn = MathUtils.smoothstep(z, GATE_Z, GATE_Z + 3);
      const { x } = LANES[ticket.lane];
      ticket.group.position.set(x * turn, 0.06, z);
      ticket.group.rotation.y = Math.sin(turn * Math.PI) * -Math.sign(x) * 0.35;
      ticket.tag.material = z < GATE_Z ? untriaged : tagColours[ticket.lane];
    };

    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      // Step back on narrow panels so all four lanes stay in frame.
      const distance = Math.max(1, 1.1 / camera.aspect);
      camera.position.set(0, 9.5 * distance, 14 * distance);
      camera.lookAt(0, 0, 0.8);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let frame = 0;
    if (reduceMotion) {
      tickets.forEach((t) => place(t, 0.2 + 0.75 * t.offset));
      resize();
    } else {
      const clock = new Clock();
      const tick = () => {
        const elapsed = clock.getElapsedTime();
        for (const t of tickets) {
          const progress = (elapsed / SECONDS_PER_TRIP + t.offset) % 1;
          if (progress < t.previous) t.lane = pickLane(); // a new ticket enters the belt
          t.previous = progress;
          place(t, progress);
        }
        renderer.render(scene, camera);
        frame = requestAnimationFrame(tick);
      };
      tick();
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      owned.forEach((resource) => resource.dispose());
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={host} className="scene" aria-hidden="true" />;
}
